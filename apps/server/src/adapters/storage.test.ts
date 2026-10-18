// The storage contract against every adapter. Memory always runs; PostgreSQL runs
// when TEST_DATABASE_URL points at a database it may create schemas in:
//
//   TEST_DATABASE_URL=postgres://modus:modus-dev-only@127.0.0.1:5432/modus pnpm --filter @modus-bpm/server test:pg
//
// Each Postgres test works in a schema of its own and drops it afterwards, so a
// development database's own tables are never touched.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createObject, newSim, setExpedite } from '@modus-bpm/core'
import { Kysely, PostgresDialect } from 'kysely'
import { Migrator } from 'kysely/migration'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type ChangeNotice, type Storage, StorageBusy } from '../ports'
import { Runtime } from '../runtime'
import { memoryStorage } from './memory'
import { migrations, postgresStorage } from './postgres'
import { storageContract } from './storage.contract'

let dir = ''
let shared: Storage | undefined
storageContract('memory with a data directory', {
  async create() {
    dir = await mkdtemp(join(tmpdir(), 'modus-contract-'))
    return (shared = memoryStorage(dir))
  },
  async reopen() {
    return memoryStorage(dir)
  },
  // One process: a second replica shares the first's memory.
  async peer() {
    return shared!
  },
  async cleanup() {
    await rm(dir, { recursive: true, force: true })
  },
})

const url = process.env.TEST_DATABASE_URL
// `pnpm test` skips Postgres without a database; `pnpm test:pg` insists on one.
if (!url && process.env.npm_lifecycle_event === 'test:pg') throw new Error('test:pg needs TEST_DATABASE_URL (see the top of this file).')

describe.skipIf(!url)('postgres', () => {
  const admin = new pg.Pool({ connectionString: url, max: 2 })
  let schemas = 0
  const fresh = async () => {
    const schema = `modus_test_${process.pid}_${++schemas}`
    await admin.query(`create schema ${schema}`)
    return schema
  }
  const drop = (schema: string) => admin.query(`drop schema if exists ${schema} cascade`)
  afterAll(() => admin.end())

  let schema = ''
  storageContract('postgres', {
    async create() {
      schema = await fresh()
      const s = postgresStorage(url!, { schema, max: 4 })
      await s.migrate()
      return s
    },
    async reopen() {
      const s = postgresStorage(url!, { schema, max: 4 })
      await s.migrate()
      return s
    },
    async peer() {
      return postgresStorage(url!, { schema, max: 4 })
    },
    cleanup: () => drop(schema).then(() => undefined),
    persistsProjections: true,
  })

  describe('postgres specifics', () => {
    let own = ''
    beforeAll(async () => {
      own = await fresh()
    })
    afterAll(() => drop(own))

    it('migrates once, records it, and is a no-op the second time', async () => {
      const s = postgresStorage(url!, { schema: own })
      await s.migrate()
      await s.migrate()
      const { rows } = await admin.query(`select name from ${own}.kysely_migration order by name`)
      expect(rows.map((r) => r.name)).toEqual(['0001_storage', '0002_projections', '0003_outbox_delivery', '0004_state_json'])
      await s.close()
    })

    it('adds version and clock columns, and the projection and outbox tables', async () => {
      const schema = await fresh()
      const s = postgresStorage(url!, { schema })
      await s.migrate()
      const { rows } = await admin.query(`select table_name, column_name from information_schema.columns where table_schema = $1 order by 1, 2`, [schema])
      const cols = rows.map((r) => `${r.table_name}.${r.column_name}`)
      expect(cols).toEqual(expect.arrayContaining(['app_state.version', 'app_state.ticked_at', 'item.data', 'work_item.token_id', 'outbox.sent_at']))
      await s.close()
      await drop(schema)
    })

    it('counts outbox messages written before 0003 as sent, so the first sender never posts the backlog', async () => {
      const schema = await fresh()
      const old = new Kysely<never>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` }) }) })
      const migrated = await new Migrator({ db: old, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema }).migrateTo('0002_projections')
      expect(migrated.error).toBeUndefined()
      await old.destroy()
      // Two that nothing sent under M2, and one already marked sent.
      await admin.query(`insert into ${schema}.outbox (app_id, item_id, kind, payload, sent_at) values ('app_a', 'i1', 'notify', '{}', null), ('app_a', 'i2', 'job.ready', '{}', null), ('app_a', 'i3', 'notify', '{}', '2026-01-01')`)

      const s = postgresStorage(url!, { schema })
      await s.migrate()
      const { rows } = await admin.query(`select item_id, skipped, routed, sent_at is not null as sent from ${schema}.outbox order by id`)
      expect(rows).toEqual([
        { item_id: 'i1', skipped: true, routed: false, sent: true },
        { item_id: 'i2', skipped: true, routed: false, sent: true },
        { item_id: 'i3', skipped: false, routed: false, sent: true },
      ])
      expect(await s.deliveries.fanOut(() => ['ops'], Date.now(), 100)).toBe(0)
      expect(await s.deliveries.list({})).toEqual([])
      expect(await s.projections.outbox('app_a')).toEqual([])
      await s.close()
      await drop(schema)
    })

    it('upgrades a database written before M2: backfills projections, starts the clock, numbers after the stored log', async () => {
      const schema = await fresh()
      // The schema as the release before M2 left it: 0001 only.
      const old = new Kysely<never>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` }) }) })
      const migrated = await new Migrator({ db: old, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema }).migrateTo('0001_storage')
      expect(migrated.error).toBeUndefined()
      await old.destroy()
      // A state with two items, made by a runtime in memory, stored the old way: no version, no clock.
      const mem = await Runtime.create({ storage: memoryStorage() })
      for (const n of ['OLD-1', 'OLD-2']) await mem.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: n }, 'u_maya'))
      const legacy = mem.state('app_invoice')
      await mem.stop()
      const [first] = Object.keys(legacy.objects)
      await admin.query(`insert into ${schema}.design (id, doc) values (1, $1)`, [JSON.stringify(mem.design)])
      await admin.query(`insert into ${schema}.app_state (app_id, state) values ('app_invoice', $1)`, [JSON.stringify(legacy)])
      for (const seq of [1, 2, 3])
        await admin.query(`insert into ${schema}.event (app_id, item_id, item_number, seq, at, kind, entry) values ('app_invoice', $1, 'X', $2, 0, 'created', '{}')`, [first, seq])

      const s = postgresStorage(url!, { schema })
      await s.migrate()
      // 0002 counts a stored state as version 1, with no clock time yet.
      const after = await admin.query(`select version, ticked_at from ${schema}.app_state`)
      expect(after.rows).toEqual([{ version: '1', ticked_at: null }])

      const rt = await Runtime.create({ storage: s })
      // The backfill is the first commit under M2, and starts keeping a clock time.
      const filled = await admin.query(`select version, ticked_at is not null as ticked from ${schema}.app_state`)
      expect(filled.rows).toEqual([{ version: '2', ticked: true }])
      const items = await admin.query(`select count(*)::int as n from ${schema}.item`)
      const work = await admin.query(`select count(*)::int as n from ${schema}.work_item`)
      expect(items.rows[0].n).toBe(2)
      expect(work.rows[0].n).toBeGreaterThan(0)
      // The legacy item's next entry follows what the log already holds for it.
      const r = await rt.run('app_invoice', (sim, ctx) => setExpedite(sim, ctx, first!, 'u_maya', true, 'upgrade test'))
      expect(r.ok).toBe(true)
      const seqs = await admin.query(`select seq from ${schema}.event where item_id = $1 order by seq`, [first])
      expect(seqs.rows.map((x) => x.seq).slice(0, 4)).toEqual([1, 2, 3, 4])
      await rt.stop()
      await s.close()
      await drop(schema)
    })

    it('keeps the state as json, compressed with lz4, and upgrades a jsonb state in place', async () => {
      const schema = await fresh()
      const old = new Kysely<never>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1, options: `-c search_path=${schema}` }) }) })
      const migrated = await new Migrator({ db: old, provider: { getMigrations: async () => migrations }, migrationTableSchema: schema }).migrateTo('0003_outbox_delivery')
      expect(migrated.error).toBeUndefined()
      await old.destroy()
      // A state committed before 0004, as jsonb.
      const mem = await Runtime.create({ storage: memoryStorage() })
      await mem.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'JSONB-1' }, 'u_maya'))
      const before = mem.state('app_invoice')
      await mem.stop()
      await admin.query(`insert into ${schema}.design (id, doc) values (1, $1)`, [JSON.stringify(mem.design)])
      await admin.query(`insert into ${schema}.app_state (app_id, state, version, ticked_at) values ('app_invoice', $1, 1, now())`, [JSON.stringify(before)])

      const s = postgresStorage(url!, { schema })
      await s.migrate()
      const col = await admin.query(
        `select data_type, (select attcompression from pg_attribute where attrelid = '${schema}.app_state'::regclass and attname = 'state') as compression
         from information_schema.columns where table_schema = $1 and table_name = 'app_state' and column_name = 'state'`,
        [schema],
      )
      expect(col.rows).toEqual([{ data_type: 'json', compression: 'l' }])
      expect((await s.state.load('app_invoice'))?.state).toEqual(JSON.parse(JSON.stringify(before)))
      const rt = await Runtime.create({ storage: s })
      await rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'JSON-2' }, 'u_maya'))
      expect(Object.values((await s.state.load('app_invoice'))!.state!.objects).map((o) => o.data.f_invno)).toEqual(['JSONB-1', 'JSON-2'])
      await rt.stop()
      await s.close()
      await drop(schema)
    })

    it('ignores another schema’s migration history', async () => {
      const decoy = await fresh()
      await admin.query(`create table ${decoy}.kysely_migration (name varchar(255) primary key, timestamp varchar(255) not null)`)
      const schema = await fresh()
      const s = postgresStorage(url!, { schema })
      await s.migrate()
      await s.designs.save({ apps: [] } as never)
      expect(await s.designs.load()).toEqual({ apps: [] })
      await s.close()
      await drop(decoy)
      await drop(schema)
    })

    it('fans each message out once when two servers fan out at the same time', async () => {
      const schema = await fresh()
      const a = postgresStorage(url!, { schema, max: 4 })
      await a.migrate()
      const b = postgresStorage(url!, { schema, max: 4 })
      const outbox = Array.from({ length: 200 }, (_, i) => ({ itemId: `i${i}`, kind: 'notify' as const, payload: {} }))
      await a.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [], items: [], outbox, tickedAt: 0 } }))
      // Each routes to its own endpoint, so a message fanned out twice would show two deliveries.
      const drain = async (s: Storage, endpoint: string) => {
        let handled = 0
        for (let n; (n = await s.deliveries.fanOut(() => [endpoint], 0, 7)); ) handled += n
        return handled
      }
      const [x, y] = await Promise.all([drain(a, 'a'), drain(b, 'b')])
      expect(x + y).toBe(200)
      expect(await a.deliveries.fanOut(() => ['a'], 0, 7)).toBe(0)
      const made = await a.deliveries.list({ limit: 1000 })
      expect(new Set(made.map((d) => d.outboxId)).size).toBe(200)
      expect(made).toHaveLength(200)
      const { rows } = await admin.query(`select count(*)::int as n from ${schema}.outbox where skipped or not routed`)
      expect(rows[0].n).toBe(0)
      await a.close()
      await b.close()
      await drop(schema)
    })

    it('lets one connection hold an application’s clock, and frees it when that connection closes', async () => {
      const a = postgresStorage(url!, { schema: own })
      const b = postgresStorage(url!, { schema: own })
      expect(await a.tryClock('app_a', 'a')).toBe(true)
      expect(await a.tryClock('app_a', 'a')).toBe(true)
      expect(await b.tryClock('app_a', 'b')).toBe(false)
      await a.close()
      expect(await b.tryClock('app_a', 'b')).toBe(true)
      await b.close()
    })

    it('delivers a commit on one connection to listeners on another', async () => {
      const a = postgresStorage(url!, { schema: own })
      const b = postgresStorage(url!, { schema: own })
      const heard: ChangeNotice[] = []
      await b.listen((n) => heard.push(n))
      await a.transact('app_n', 0, () => ({ value: 0, write: { state: newSim('app_n', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
      await vi.waitFor(() => expect(heard).toEqual([{ appId: 'app_n', version: 1, itemIds: [] }]))
      await a.close()
      await b.close()
    })

    it('reconnects after losing its connection, dropping its clocks and telling listeners to reload', async () => {
      // A name of its own, so cutting the connection can't touch another test run's.
      const name = `modus_reconnect_${process.pid}`
      const named = new URL(url!)
      named.searchParams.set('application_name', name)
      const a = postgresStorage(named.toString(), { schema: own })
      const b = postgresStorage(url!, { schema: own })
      const heard: ChangeNotice[] = []
      let reloads = 0
      await a.listen(
        (n) => heard.push(n),
        () => reloads++,
      )
      expect(await a.tryClock('app_r', 'a')).toBe(true)
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1', [name])
      await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 5000 })
      expect(await b.tryClock('app_r', 'b')).toBe(true)
      expect(await a.tryClock('app_r', 'a')).toBe(false)
      await b.transact('app_r', 0, () => ({ value: 0, write: { state: newSim('app_r', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
      await vi.waitFor(() => expect(heard).toEqual([{ appId: 'app_r', version: 1, itemIds: [] }]))
      await a.close()
      await b.close()
    })

    it('takes a clock once when two calls race for it', async () => {
      const a = postgresStorage(url!, { schema: own })
      const b = postgresStorage(url!, { schema: own })
      expect(await Promise.all([a.tryClock('app_c', 'a'), a.tryClock('app_c', 'a')])).toEqual([true, true])
      expect(await b.tryClock('app_c', 'b')).toBe(false)
      await a.releaseClocks('a')
      expect(await b.tryClock('app_c', 'b')).toBe(true)
      await a.close()
      await b.close()
    })

    it('listens without a database, holds no clock, and stops retrying on close', async () => {
      const down = postgresStorage('postgres://nobody:pw@127.0.0.1:1/none')
      const stop = await down.listen(() => undefined, () => undefined)
      expect(await down.tryClock('app_d', 'd')).toBe(false)
      // A retry is pending: fails at once instead of opening another connection.
      expect(await down.tryClock('app_d', 'd')).toBe(false)
      await stop()
      await down.close()
    })

    it('keeps one schema’s notices from another schema’s listeners', async () => {
      const other = await fresh()
      const a = postgresStorage(url!, { schema: own })
      const b = postgresStorage(url!, { schema: other })
      await b.migrate()
      const heardA: ChangeNotice[] = []
      const heardB: ChangeNotice[] = []
      await a.listen((n) => heardA.push(n))
      await b.listen((n) => heardB.push(n))
      await a.transact('app_s', 0, () => ({ value: 0, write: { state: newSim('app_s', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
      await b.transact('app_t', 0, () => ({ value: 0, write: { state: newSim('app_t', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
      await vi.waitFor(() => expect(heardB).toEqual([{ appId: 'app_t', version: 1, itemIds: [] }]))
      await vi.waitFor(() => expect(heardA).toEqual([{ appId: 'app_s', version: 1, itemIds: [] }]))
      await a.close()
      await b.close()
      await drop(other)
    })

    it('leaves item ids out of a notice that would not fit in a NOTIFY payload', async () => {
      const s = postgresStorage(url!, { schema: own })
      const heard: ChangeNotice[] = []
      await s.listen((n) => heard.push(n))
      const items = (n: number) =>
        Array.from({ length: n }, (_, i) => {
          const itemId = `i_${i}_${'x'.repeat(200)}`
          return { item: { itemId, number: `B-${i}`, title: 't', status: 'active', priority: 'normal', expedited: false, createdAt: 0, data: {} }, workItems: [] }
        }) as never
      const commit = (version: number, n: number) => s.transact('app_big', version, () => ({ value: 0, write: { state: newSim('app_big', 1), entries: [], items: items(n), outbox: [], tickedAt: 0 } }))
      // 30 ids of ~210 bytes fit; 40 don't (the limit is under 8000 bytes, whatever the count).
      await commit(0, 30)
      await commit(1, 40)
      await vi.waitFor(() => expect(heard).toHaveLength(2))
      expect(heard[0]!.itemIds).toHaveLength(30)
      expect(heard[1]).toEqual({ appId: 'app_big', version: 2 })
      await s.close()
    })

    it('throws StorageBusy when another connection holds the application’s row past the lock timeout', async () => {
      const s = postgresStorage(url!, { schema: own, lockTimeoutMs: 200 })
      const commit = (version: number) => s.transact('app_busy', version, () => ({ value: 0, write: { state: newSim('app_busy', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
      await commit(0)
      const other = new pg.Client({ connectionString: url })
      await other.connect()
      try {
        await other.query('begin')
        await other.query(`select 1 from ${own}.app_state where app_id = 'app_busy' for update`)
        await expect(commit(1)).rejects.toBeInstanceOf(StorageBusy)
      } finally {
        await other.query('commit').catch(() => undefined)
        await other.end()
      }
      expect(await commit(1)).toMatchObject({ version: 2, committed: true })
      await s.close()
    })

    it('refuses a lock timeout that isn’t a positive number', () => {
      for (const lockTimeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => postgresStorage(url!, { lockTimeoutMs })).toThrow(/lock timeout/i)
    })

    it('refuses odd schema names and reports an unreachable database through ping', async () => {
      expect(() => postgresStorage(url!, { schema: 'x; drop table event' })).toThrow(/schema name/)
      const down = postgresStorage('postgres://nobody:pw@127.0.0.1:1/none')
      await expect(down.ping()).rejects.toThrow()
      await down.close()
    })
  })
})
