// Storage ports: everything the server persists goes through these interfaces.
// Two adapters ship: in memory (adapters/memory.ts) and PostgreSQL
// (adapters/postgres.ts). SQL Server / Oracle follow behind the same contract,
// which adapters/storage.contract.ts checks for every adapter (docs/ARCHITECTURE.md).

import type { AuditEntry, Design, Id, OutboxMessage, ProjectedItem, SimState } from '@modus-bpm/core'

/** The published design: applications, object types, workflows, people, services, templates. */
export interface DesignStore {
  load(): Promise<Design | undefined>
  save(design: Design): Promise<void>
}

/**
 * Live state of one application: items, their tokens (where each branch is),
 * work items and counters. In SQL this becomes projection tables (`case`,
 * `work_item`, `object`, `object_field_idx`) updated in the same transaction as
 * the events that changed them.
 */
export interface StateStore {
  load(appId: Id): Promise<SimState | undefined>
  save(appId: Id, state: SimState): Promise<void>
  /** Version, clock time and state as stored (undefined: never written). */
  get(appId: Id): Promise<Stored | undefined>
}

/** What storage holds for an application when a transaction starts. */
export interface Stored {
  /** 0: nothing stored yet. Bumped by every commit. */
  version: number
  /** Present only when `version` differs from the caller's `known` version (or on `get`). */
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
  /** Unsent outbox messages, oldest first. */
  outbox(appId: Id): Promise<Array<OutboxMessage & { id: number }>>
  /** True when the application has any projected item (startup backfill checks this). */
  any(appId: Id): Promise<boolean>
}

/** One entry in the append-only event log: the audit trail, the process-mining source, and replay input. */
export interface LoggedEvent extends AuditEntry {
  appId: Id
  itemId: Id
  itemNumber: string
  /** Position in the item's history (unique per item: the SQL backstop for concurrent commands). */
  seq: number
}

export interface EventLog {
  append(events: LoggedEvent[]): Promise<void>
  read(filter: { appId?: Id; itemId?: Id; limit?: number }): Promise<LoggedEvent[]>
  /** The highest position logged for each item of an application (the runtime numbers new entries after it). */
  positions(appId: Id): Promise<Map<Id, number>>
}

export interface Storage {
  /** Short name for the startup log and the readiness probe. */
  name: string
  designs: DesignStore
  state: StateStore
  events: EventLog
  projections: Projections
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
  /** Throws when the backing store cannot be reached (readiness). Absent: always reachable. */
  ping?(): Promise<void>
  /** Release connections on shutdown. */
  close?(): Promise<void>
}
