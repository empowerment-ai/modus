// PostgreSQL storage: the published design, each application's live state and the
// append-only event log, through Kysely on a node-postgres pool. Migrations live
// in this file (so they bundle with the server) and run at startup.
//
// This is the first slice of milestone M2: the same three ports as the memory
// adapter, durable and shared. Projection tables, the outbox, timers and per-item
// locking come next (docs/ARCHITECTURE.md).

import type { AuditEntry, Design, Id, SimState } from '@modus-bpm/core'
import { type Generated, Kysely, PostgresDialect, sql } from 'kysely'
import { type Migration, Migrator } from 'kysely/migration'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import type { DesignStore, EventLog, LoggedEvent, Projections, StateStore, Storage } from '../ports'

interface Tables {
  design: { id: number; doc: Design; updated_at: Generated<Date> }
  app_state: { app_id: string; state: SimState | null; version: Generated<string>; ticked_at: Date | null; updated_at: Generated<Date> }
  event: {
    id: Generated<string>
    app_id: string
    item_id: string
    item_number: string
    seq: number
    at: number
    kind: string
    entry: AuditEntry
    recorded_at: Generated<Date>
  }
  item: {
    app_id: string
    item_id: string
    number: string
    title: string
    status: string
    priority: string
    expedited: boolean
    due_at: number | null
    created_at: number
    ended_at: number | null
    version: string
    data: Record<string, unknown>
  }
  work_item: {
    app_id: string
    token_id: string
    item_id: string
    step_id: string
    state: string
    assignee: string | null
    group_id: string | null
    service_id: string | null
    entered_at: number
    due_at: number | null
    priority: string
  }
  outbox: {
    id: Generated<string>
    app_id: string
    item_id: string
    kind: string
    payload: Record<string, unknown>
    created_at: Generated<Date>
    sent_at: Date | null
  }
}

/** Versioned migrations, applied in name order and recorded in `kysely_migration`. Never edit one that has shipped; add the next. */
const migrations: Record<string, Migration> = {
  '0001_storage': {
    async up(db) {
      // One published design per database (one tenant): a single row.
      await db.schema
        .createTable('design')
        .addColumn('id', 'smallint', (c) => c.primaryKey().check(sql`id = 1`))
        .addColumn('doc', 'jsonb', (c) => c.notNull())
        .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute()
      await db.schema
        .createTable('app_state')
        .addColumn('app_id', 'text', (c) => c.primaryKey())
        .addColumn('state', 'jsonb', (c) => c.notNull())
        .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .execute()
      await db.schema
        .createTable('event')
        .addColumn('id', 'bigserial', (c) => c.primaryKey())
        .addColumn('app_id', 'text', (c) => c.notNull())
        .addColumn('item_id', 'text', (c) => c.notNull())
        .addColumn('item_number', 'text', (c) => c.notNull())
        .addColumn('seq', 'integer', (c) => c.notNull())
        // Simulated minutes on the application's clock, as the engine records them.
        .addColumn('at', 'double precision', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('entry', 'jsonb', (c) => c.notNull())
        .addColumn('recorded_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        // Two writers appending the same position in an item's history: one of them loses.
        .addUniqueConstraint('event_item_seq', ['app_id', 'item_id', 'seq'])
        .execute()
      // Latest events of an application (the unique constraint's index serves reads by item).
      await db.schema.createIndex('event_app_id').on('event').columns(['app_id', 'id']).execute()
      await db.schema.createIndex('event_item_number').on('event').columns(['app_id', 'item_number']).execute()
    },
    async down(db) {
      for (const t of ['event', 'app_state', 'design']) await db.schema.dropTable(t).execute()
    },
  },
  '0002_projections': {
    async up(db) {
      await db.schema
        .alterTable('app_state')
        .addColumn('version', 'bigint', (c) => c.notNull().defaultTo(0))
        .addColumn('ticked_at', 'timestamptz')
        .execute()
      // A row is created (version 0, no state) to have something to lock before an application's first commit.
      await db.schema.alterTable('app_state').alterColumn('state', (c) => c.dropNotNull()).execute()
      // Existing rows already hold state: count them as committed once.
      await sql`update app_state set version = 1 where state is not null`.execute(db)
      await db.schema
        .createTable('item')
        .addColumn('app_id', 'text', (c) => c.notNull())
        .addColumn('item_id', 'text', (c) => c.notNull())
        .addColumn('number', 'text', (c) => c.notNull())
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('priority', 'text', (c) => c.notNull())
        .addColumn('expedited', 'boolean', (c) => c.notNull())
        // Simulated minutes, like event.at.
        .addColumn('due_at', 'double precision')
        .addColumn('created_at', 'double precision', (c) => c.notNull())
        .addColumn('ended_at', 'double precision')
        .addColumn('version', 'bigint', (c) => c.notNull())
        .addColumn('data', 'jsonb', (c) => c.notNull())
        .addPrimaryKeyConstraint('item_pk', ['app_id', 'item_id'])
        .execute()
      await db.schema.createIndex('item_number').on('item').columns(['app_id', 'number']).execute()
      await db.schema.createIndex('item_status').on('item').columns(['app_id', 'status']).execute()
      await db.schema
        .createTable('work_item')
        .addColumn('app_id', 'text', (c) => c.notNull())
        .addColumn('token_id', 'text', (c) => c.notNull())
        .addColumn('item_id', 'text', (c) => c.notNull())
        .addColumn('step_id', 'text', (c) => c.notNull())
        .addColumn('state', 'text', (c) => c.notNull())
        .addColumn('assignee', 'text')
        .addColumn('group_id', 'text')
        .addColumn('service_id', 'text')
        .addColumn('entered_at', 'double precision', (c) => c.notNull())
        .addColumn('due_at', 'double precision')
        .addColumn('priority', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('work_item_pk', ['app_id', 'token_id'])
        .execute()
      await db.schema.createIndex('work_item_item').on('work_item').columns(['app_id', 'item_id']).execute()
      await db.schema.createIndex('work_item_assignee').on('work_item').columns(['app_id', 'assignee']).execute()
      await db.schema.createIndex('work_item_step').on('work_item').columns(['app_id', 'step_id', 'state']).execute()
      await db.schema
        .createTable('outbox')
        .addColumn('id', 'bigserial', (c) => c.primaryKey())
        .addColumn('app_id', 'text', (c) => c.notNull())
        .addColumn('item_id', 'text', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('payload', 'jsonb', (c) => c.notNull())
        .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn('sent_at', 'timestamptz')
        .execute()
      // The M4 dispatcher's queue: unsent rows in order.
      await sql`create index outbox_unsent on outbox (id) where sent_at is null`.execute(db)
    },
    async down(db) {
      for (const t of ['outbox', 'work_item', 'item']) await db.schema.dropTable(t).execute()
      await sql`delete from app_state where state is null`.execute(db)
      await db.schema.alterTable('app_state').alterColumn('state', (c) => c.setNotNull()).execute()
      await db.schema.alterTable('app_state').dropColumn('ticked_at').dropColumn('version').execute()
    },
  },
}

// Transactions, projections, LISTEN/NOTIFY and the clock lock land in the next steps of M2.
const notYet = () => new Error('not yet: PostgreSQL transactions and projections are still to come')

/** Rows per INSERT: well under Postgres's 65,535 bind parameters. */
const CHUNK = 1000

export interface PostgresStorage extends Storage {
  /** Apply any migrations this database has not seen yet. */
  migrate(): Promise<void>
  ping(): Promise<void>
  close(): Promise<void>
}

export interface PostgresOptions {
  /** Pool size. */
  max?: number
  /** Keep the tables in this schema (it must exist) instead of the user's default: several installs, or test runs, in one database. */
  schema?: string
}

/** Storage on PostgreSQL. Call `migrate()` before first use and `close()` on shutdown. */
export function postgresStorage(connectionString: string, options: PostgresOptions = {}): PostgresStorage {
  const { schema, max = 10 } = options
  if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Not a plain schema name: ${schema}`)
  const pool = new pg.Pool({ connectionString, max, options: schema ? `-c search_path=${schema}` : undefined })
  // An idle client losing its connection (database restart) must not crash the process; the next query reconnects.
  pool.on('error', () => undefined)
  const db = new Kysely<Tables>({ dialect: new PostgresDialect({ pool }) })
  // node-postgres would turn a JavaScript array into a Postgres array; JSONB needs JSON text.
  const json = <T>(v: T) => JSON.stringify(v) as unknown as T

  const designs: DesignStore = {
    async load() {
      const row = await db.selectFrom('design').select('doc').where('id', '=', 1).executeTakeFirst()
      return row?.doc
    },
    async save(d) {
      await db
        .insertInto('design')
        .values({ id: 1, doc: json(d) })
        .onConflict((oc) => oc.column('id').doUpdateSet({ doc: (eb) => eb.ref('excluded.doc'), updated_at: sql`now()` }))
        .execute()
    },
  }

  const state: StateStore = {
    async load(appId) {
      const row = await db.selectFrom('app_state').select('state').where('app_id', '=', appId).executeTakeFirst()
      return row?.state ?? undefined
    },
    async save(appId, s) {
      // Counts as a commit, as in the memory adapter, so a transaction started before it sees the change.
      await db
        .insertInto('app_state')
        .values({ app_id: appId, state: json(s), version: '1' })
        .onConflict((oc) => oc.column('app_id').doUpdateSet({ state: (eb) => eb.ref('excluded.state'), version: sql`app_state.version + 1`, updated_at: sql`now()` }))
        .execute()
    },
    async get() {
      throw notYet()
    },
  }

  const events: EventLog = {
    async append(batch) {
      if (!batch.length) return
      await db.transaction().execute(async (tx) => {
        for (let i = 0; i < batch.length; i += CHUNK) {
          const chunk = batch.slice(i, i + CHUNK)
          const rows = chunk.map(({ appId, itemId, itemNumber, seq, ...entry }) => ({
            app_id: appId,
            item_id: itemId,
            item_number: itemNumber,
            seq,
            at: entry.at,
            kind: entry.kind,
            entry: json(entry),
          }))
          // A batch sent again after a lost acknowledgement must not fail on what already landed,
          // but only an identical entry counts as already landed: a different one at a taken
          // position is a real conflict, and the whole batch is refused rather than dropped quietly.
          const landed = await tx
            .insertInto('event')
            .values(rows)
            .onConflict((oc) => oc.columns(['app_id', 'item_id', 'seq']).doNothing())
            .returning(['app_id', 'item_id', 'seq'])
            .execute()
          const key = (r: { app_id: string; item_id: string; seq: number }) => `${r.app_id}\u0000${r.item_id}\u0000${r.seq}`
          const inserted = new Set(landed.map(key))
          for (const { appId, itemId, itemNumber, seq, ...entry } of chunk) {
            if (inserted.has(key({ app_id: appId, item_id: itemId, seq }))) continue
            const had = await tx.selectFrom('event').select(['item_number', 'entry']).where('app_id', '=', appId).where('item_id', '=', itemId).where('seq', '=', seq).executeTakeFirst()
            // Compared as stored: JSON drops undefined keys.
            if (!had || had.item_number !== itemNumber || !isDeepStrictEqual(had.entry, JSON.parse(JSON.stringify(entry))))
              throw new Error(`Event log conflict: item ${itemNumber} already has a different entry at position ${seq}.`)
          }
        }
      })
    },
    async positions(appId) {
      const rows = await db.selectFrom('event').select(['item_id', (eb) => eb.fn.max('seq').as('seq')]).where('app_id', '=', appId).groupBy('item_id').execute()
      return new Map(rows.map((r) => [r.item_id as Id, Number(r.seq)]))
    },
    async read({ appId, itemId, limit = 200 }) {
      let q = db.selectFrom('event').select(['app_id', 'item_id', 'item_number', 'seq', 'entry'])
      if (appId) q = q.where('app_id', '=', appId)
      if (itemId) q = q.where('item_id', '=', itemId)
      // The latest `limit`, returned oldest first (as the memory adapter does).
      const rows = await q.orderBy('id', 'desc').limit(Math.max(0, limit)).execute()
      return rows.reverse().map((r): LoggedEvent => ({ ...r.entry, appId: r.app_id as Id, itemId: r.item_id as Id, itemNumber: r.item_number, seq: r.seq }))
    },
  }

  const projections: Projections = {
    item: () => Promise.reject(notYet()),
    workItems: () => Promise.reject(notYet()),
    outbox: () => Promise.reject(notYet()),
    any: () => Promise.reject(notYet()),
  }

  let closed: Promise<void> | undefined
  return {
    name: 'postgres',
    designs,
    state,
    events,
    projections,
    transact: () => Promise.reject(notYet()),
    listen: () => Promise.reject(notYet()),
    tryClock: () => Promise.reject(notYet()),
    releaseClocks: () => Promise.reject(notYet()),
    async migrate() {
      // Name the schema: Kysely otherwise finds a `kysely_migration` table in any schema (another install's, say).
      const { rows } = await sql<{ name: string }>`select current_schema() as name`.execute(db)
      const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations }, migrationTableSchema: rows[0]?.name })
      const { error, results } = await migrator.migrateToLatest()
      const failed = results?.find((r) => r.status === 'Error')
      if (error) throw new Error(`Database migration ${failed?.migrationName ?? ''} failed: ${error instanceof Error ? error.message : String(error)}`)
    },
    async ping() {
      await sql`select 1`.execute(db)
    },
    // Idempotent: a test (or shutdown path) may close a storage that something else closes too.
    close() {
      return (closed ??= db.destroy())
    },
  }
}

/** The connection string with its password masked, for logs. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return '(unparseable URL)'
  }
}
