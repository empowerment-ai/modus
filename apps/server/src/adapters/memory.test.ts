import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createObject } from '@modus-bpm/core'
import { afterAll, describe, expect, it } from 'vitest'
import { Runtime } from '../runtime'
import { memoryStorage } from './memory'

describe('memory storage with a data directory', () => {
  const dirs: string[] = []
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true })
  })

  it('snapshots design and state so a restart picks up where it left off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modus-data-'))
    dirs.push(dir)
    const first = await Runtime.create({ storage: memoryStorage(dir) })
    const number = await first.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'KEEP-1' }, 'u_maya')!.number)
    await first.stop()

    const files = await readdir(dir)
    expect(files).toEqual(expect.arrayContaining(['design.json', 'state-app_invoice.json', 'events.jsonl']))
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)

    const second = await Runtime.create({ storage: memoryStorage(dir) })
    const found = await second.read('app_invoice', (sim) => Object.values(sim.objects).find((o) => o.number === number))
    expect(found?.data.f_invno).toBe('KEEP-1')
    await second.stop()
  })
})
