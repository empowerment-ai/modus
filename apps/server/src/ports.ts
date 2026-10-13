// Storage ports: everything the server persists goes through these interfaces.
// Two adapters ship: in memory (adapters/memory.ts) and PostgreSQL
// (adapters/postgres.ts). SQL Server / Oracle follow behind the same contract,
// which adapters/storage.contract.ts checks for every adapter (docs/ARCHITECTURE.md).
//
// Every change to an application goes through `Storage.transact`: state, audit
// entries, projections and outbox commit together under the application's lock.
// The other ports are read-only, except the design, which is saved on publish.

import type { AuditEntry, Design, Id, OutboxMessage, ProjectedItem, SimState } from '@modus-bpm/core'

/** The published design: applications, object types, workflows, people, services, templates. */
export interface DesignStore {
  load(): Promise<Design | undefined>
  save(design: Design): Promise<void>
}

/**
 * Live state of one application: items, their tokens (where each branch is),
 * work items and counters, stored whole and written only by `Storage.transact`.
 * The queryable side (items, work items, outbox) is `Projections`, written in
 * the same transaction.
 */
export interface StateStore {
  /** Version, clock time and state as stored (undefined: never written). */
  load(appId: Id): Promise<Stored | undefined>
}

/** What storage holds for an application when a transaction starts. */
export interface Stored {
  /** 0: nothing stored yet. Bumped by every commit. */
  version: number
  /** Present only when `version` differs from the caller's `known` version (always on `StateStore.load`). */
  state?: SimState
  /** Wall time (epoch ms) the stored clock corresponds to. Absent: never ticked. */
  tickedAt?: number
}

/** Everything one command changed, written together or not at all. */
export interface Write {
  state: SimState
  /** New audit entries per item; storage numbers them after the item's last logged position. */
  entries: Array<{ itemId: Id; itemNumber: string; entries: AuditEntry[] }>
  /** Replace these items' projection rows (and all their work-item rows). */
  items: ProjectedItem[]
  outbox: OutboxMessage[]
  tickedAt: number
}

/** The work done inside a transaction: its result, and what to write (absent: roll back). */
export interface Work<T> {
  value: T
  write?: Write
}

/** Another writer (or this one) committed a change. */
export interface ChangeNotice {
  appId: Id
  version: number
  /** Touched items; absent when there were too many to send. */
  itemIds?: Id[]
}

/** The row lock wasn't granted in time: another replica is busy with this application. */
export class StorageBusy extends Error {}

/** Read side of the projections (M3 worklists and search build on this). */
export interface Projections {
  item(appId: Id, itemId: Id): Promise<ProjectedItem['item'] | undefined>
  workItems(appId: Id, itemId?: Id): Promise<ProjectedItem['workItems']>
  /** Unsent outbox messages (not yet delivered, failed or skipped everywhere), oldest first. */
  outbox(appId: Id): Promise<Array<OutboxMessage & { id: number }>>
  /** True when the application has any projected item (startup backfill checks this). */
  any(appId: Id): Promise<boolean>
}

/** One entry in the append-only event log: the audit trail, the process-mining source, and replay input. Written by `Storage.transact`. */
export interface LoggedEvent extends AuditEntry {
  appId: Id
  itemId: Id
  itemNumber: string
  /** Position in the item's history (unique per item: the SQL backstop for concurrent commands). */
  seq: number
}

export interface EventLog {
  /** The latest `limit` entries (default 200) matching the filter, oldest first. */
  read(filter: { appId?: Id; itemId?: Id; limit?: number }): Promise<LoggedEvent[]>
}

/** One outbox message on its way to one webhook endpoint. */
export interface Delivery {
  outboxId: number
  endpoint: string
  appId: Id
  itemId: Id
  kind: OutboxMessage['kind']
  payload: Record<string, unknown>
  /** When the message was written (epoch ms). */
  createdAt: number
  status: 'pending' | 'delivered' | 'failed'
  /** Attempts recorded since `since`. */
  attempts: number
  /** When its retry schedule started: fan-out, or the last `retry`. The sender gives up 24 h after it. */
  since: number
  /** Due (pending), or claimed until then: the lease `claim` returns, which `record` must present. */
  nextAt: number
  lastStatus?: number
  lastError?: string
  deliveredAt?: number
}

/** What one attempt came to. */
export type Attempt = { status: 'pending'; nextAt: number; lastStatus?: number; lastError?: string } | { status: 'delivered' | 'failed'; lastStatus?: number; lastError?: string }

/**
 * The outbox sender's side of storage (webhooks.ts, sender.ts). Every server runs a sender over
 * the same rows: a claim keeps a delivery to one of them until its lease runs out, so a server
 * that dies mid-send loses it and another retries (at least once). Times are passed in, never read.
 */
export interface Deliveries {
  /** For messages with no deliveries yet (oldest first, up to `limit`), create one per endpoint `route` returns; none: mark the message skipped and sent. Returns how many messages it handled. */
  fanOut(route: (m: { appId: Id; kind: string }) => string[], now: number, limit: number): Promise<number>
  /** Take up to `limit` pending deliveries due at `now` (earliest due first), pushing their nextAt to now + leaseMs so no one else takes them. */
  claim(now: number, leaseMs: number, limit: number): Promise<Delivery[]>
  /**
   * Record an attempt (attempts + 1): delivered, retry at `nextAt`, or failed. Applies only while the delivery is
   * pending and still under the claim that returned `claimedUntil` (its nextAt); otherwise the lease ran out and
   * someone else may hold it, so nothing changes and it returns false. Omitted lastStatus/lastError clear the
   * previous ones. Sets the message's sent_at once none of its deliveries is pending.
   */
  record(outboxId: number, endpoint: string, claimedUntil: number, result: Attempt, now: number): Promise<boolean>
  /** Newest message first, then endpoint; `limit` defaults to 100. */
  list(filter: { status?: Delivery['status']; limit?: number }): Promise<Delivery[]>
  /** Put a message's failed deliveries back to pending, due now, with a fresh schedule (attempts 0, since now; the last answer kept), and clear its sent_at. False when it has none failed. */
  retry(outboxId: number, now: number): Promise<boolean>
  /** Delete messages (and deliveries) sent before now - keepMs, or failed before now - keepFailedMs. Returns how many messages. */
  prune(now: number, keepMs: number, keepFailedMs: number): Promise<number>
}

export interface Storage {
  /** Short name for the startup log and the readiness probe. */
  name: string
  designs: DesignStore
  state: StateStore
  events: EventLog
  projections: Projections
  deliveries: Deliveries
  /**
   * Run `work` holding the application's lock, and commit what it returns in one transaction:
   * state (version + 1), audit entries, projections, outbox, and a change notice to every
   * listener. Throws StorageBusy when the lock isn't granted within
   * the adapter's lock timeout (Postgres: 5 s by default); any other failure
   * rolls everything back and rethrows.
   */
  transact<T>(appId: Id, known: number, work: (stored: Stored) => Work<T> | Promise<Work<T>>): Promise<{ value: T; version: number; committed: boolean }>
  /**
   * Hear every committed change, this process's included. Returns a stop function. Handlers must
   * catch their own errors: the adapter swallows a throw or rejection. `onReconnect` runs after a
   * lost (or never opened) connection comes back: reload anything that may have been missed.
   */
  listen(onChange: (n: ChangeNotice) => void, onReconnect?: () => void): Promise<() => Promise<void>>
  /** Become (or stay) the one ticker for this application's clock. */
  tryClock(appId: Id, owner: string): Promise<boolean>
  /** Give up every clock this owner holds. */
  releaseClocks(owner: string): Promise<void>
  /** False while change notices can't arrive (the listening connection is down). Absent: always listening. */
  listening?(): boolean
  /** Throws when the backing store cannot be reached (readiness). Absent: always reachable. */
  ping?(): Promise<void>
  /** Release connections on shutdown. */
  close?(): Promise<void>
}
