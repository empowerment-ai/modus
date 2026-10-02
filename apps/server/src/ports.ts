// Storage ports: everything the server persists goes through these interfaces.
// The in-memory adapter (adapters/memory.ts) ships today; Postgres comes next and
// SQL Server / Oracle follow behind the same contract (see docs/ARCHITECTURE.md).

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
}

export interface Storage {
  designs: DesignStore
  state: StateStore
  events: EventLog
}
