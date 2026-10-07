// Storage ports: everything the server persists goes through these interfaces.
// Two adapters ship: in memory (adapters/memory.ts) and PostgreSQL
// (adapters/postgres.ts). SQL Server / Oracle follow behind the same contract,
// which adapters/storage.contract.ts checks for every adapter (docs/ARCHITECTURE.md).

import type { AuditEntry, Design, Id, SimState } from '@modus-bpm/core'

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
  /** Throws when the backing store cannot be reached (readiness). Absent: always reachable. */
  ping?(): Promise<void>
  /** Release connections on shutdown. */
  close?(): Promise<void>
}
