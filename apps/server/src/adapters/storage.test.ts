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
import { newSim } from '@modus-bpm/core'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type ChangeNotice, StorageBusy } from '../ports'
import { memoryStorage } from './memory'
import { postgresStorage } from './postgres'
import { storageContract } from './storage.contract'

let dir = ''
storageContract('memory with a data directory', {
  async create() {
    dir = await mkdtemp(join(tmpdir(), 'modus-contract-'))
    return memoryStorage(dir)
  },
  async reopen() {
    return memoryStorage(dir)
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
      expect(rows.map((r) => r.name)).toEqual(['0001_storage', '0002_projections'])
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

    it('keeps the first event at a position in an item’s history and lands the rest of the batch', async () => {
      const s = postgresStorage(url!, { schema: own })
      await s.migrate()
      const e = (seq: number, itemId = 'i1') => ({ appId: 'app_a', itemId, itemNumber: 'A-1', seq, at: 0, kind: 'note', text: 'x' }) as never
      await s.events.append([e(1)])
      // An identical repeat is a retry of what already landed: skipped, not an error that blocks the log.
      await s.events.append([e(1, 'i2'), e(1)])
      expect((await s.events.read({ appId: 'app_a' })).map((x) => `${x.itemId}:${x.seq}`)).toEqual(['i1:1', 'i2:1'])
      await s.close()
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
