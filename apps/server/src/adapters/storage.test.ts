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
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
      expect(rows.map((r) => r.name)).toEqual(['0001_storage'])
      await s.close()
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
      // One process writes the log (the chart runs one replica), so a repeated position is that
      // writer's own retry, not a second writer: it is skipped, not an error that blocks the log.
      await s.events.append([e(1, 'i2'), e(1)])
      expect((await s.events.read({ appId: 'app_a' })).map((x) => `${x.itemId}:${x.seq}`)).toEqual(['i1:1', 'i2:1'])
      await s.close()
    })

    it('refuses odd schema names and reports an unreachable database through ping', async () => {
      expect(() => postgresStorage(url!, { schema: 'x; drop table event' })).toThrow(/schema name/)
      const down = postgresStorage('postgres://nobody:pw@127.0.0.1:1/none')
      await expect(down.ping()).rejects.toThrow()
      await down.close()
    })
  })
})
