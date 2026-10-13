import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createObject, newSim } from '@modus-bpm/core'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Runtime } from '../runtime'
import { memoryStorage } from './memory'

describe('memory storage', () => {
  it('numbers outbox messages past every id a previous process gave out', async () => {
    const commit = async (s: ReturnType<typeof memoryStorage>, version: number) => {
      await s.transact('app_a', version, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [], items: [], outbox: [{ itemId: 'i1', kind: 'notify', payload: {} }], tickedAt: 0 } }))
      return (await s.projections.outbox('app_a')).at(-1)!.id
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const first = memoryStorage()
      let before = 0
      for (let v = 0; v < 5; v++) before = await commit(first, v)
      // A restart a millisecond later: a new store, which keeps nothing of the old one's outbox.
      vi.setSystemTime(Date.now() + 1)
      const after = await commit(memoryStorage(), 0)
      expect(Number.isSafeInteger(after)).toBe(true)
      expect(after).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })
})

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

  it('survives a torn last line in the event log, keeping the first entry at each position', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modus-data-'))
    dirs.push(dir)
    const line = JSON.stringify({ appId: 'app_a', itemId: 'i1', itemNumber: 'A-1', seq: 1, at: 1, kind: 'note', text: 'kept' })
    // A crash mid-append leaves half a line; a retried append can leave the same entry twice.
    await writeFile(join(dir, 'events.jsonl'), `${line}\n${line}\n{"appId":"app_a","itemId":"i1","se`)
    const s = memoryStorage(dir)
    expect((await s.events.read({})).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:kept'])
    const entry = { at: 2, kind: 'note', text: 'next' } as never
    await s.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [{ itemId: 'i1', itemNumber: 'A-1', entries: [entry] }], items: [], outbox: [], tickedAt: 0 } }))
    expect((await s.events.read({ itemId: 'i1' })).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:kept', '2:next'])
  })

  it('numbers two entry groups for one item in one write without reusing positions', async () => {
    const s = memoryStorage()
    const entry = (text: string) => ({ at: 1, kind: 'note', text }) as never
    const group = (text: string) => ({ itemId: 'i1', itemNumber: 'A-1', entries: [entry(text)] })
    await s.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [group('a'), group('b')], items: [], outbox: [], tickedAt: 0 } }))
    expect((await s.events.read({ itemId: 'i1' })).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:a', '2:b'])
  })

  it('gives each listener its own copy, and a failing listener harms nobody', async () => {
    const s = memoryStorage()
    const heard: unknown[] = []
    await s.listen(async (n) => {
      n.itemIds?.push('mutated')
      throw new Error('listener failed')
    })
    await s.listen((n) => heard.push(n))
    await s.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
    await vi.waitFor(() => expect(heard).toEqual([{ appId: 'app_a', version: 1, itemIds: [] }]))
  })

  it('hands out copies of logged events', async () => {
    const s = memoryStorage()
    const entry = { at: 1, kind: 'note', text: 'x' } as never
    await s.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [{ itemId: 'i1', itemNumber: 'A-1', entries: [entry] }], items: [], outbox: [], tickedAt: 0 } }))
    ;(await s.events.read({}))[0]!.text = 'changed'
    expect((await s.events.read({}))[0]!.text).toBe('x')
  })
})
