import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedItems, copyState, createObject, type Ctx, newSim, projectItem, type SimState } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
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
    expect(files).toEqual(expect.arrayContaining(['design.json', 'state-app_invoice.jsonl', 'events.jsonl']))
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)

    const second = await Runtime.create({ storage: memoryStorage(dir) })
    const found = await second.read('app_invoice', (sim) => Object.values(sim.objects).find((o) => o.number === number))
    expect(found?.data.f_invno).toBe('KEEP-1')
    await second.stop()
  })

  const design = seedDesign()
  const ctx: Ctx = { app: design.apps.find((a) => a.id === 'app_invoice')!, users: design.users, groups: design.groups, services: design.services, live: true }
  /** Commit what `change` does to a copy of `before`, writing only the items it changed, as the runtime does. */
  async function commit(s: ReturnType<typeof memoryStorage>, version: number, before: SimState, change: (sim: SimState) => void) {
    const after = copyState(before)
    change(after)
    const items = changedItems(before, after).map((id) => projectItem(after, ctx, id)!)
    await s.transact('app_invoice', version, () => ({ value: 0, write: { state: after, entries: [], items, outbox: [], tickedAt: version } }))
    return after
  }
  const make = (n: string) => (sim: SimState) => void createObject(sim, ctx, 'w_invoice', { f_invno: n }, 'u_maya')
  const lines = async (dir: string) => (await readFile(join(dir, 'state-app_invoice.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { version: number; full?: true; items: Array<{ id: string }> })

  it('logs each commit as the rest of the state and only the items it changed, and replays the log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modus-data-'))
    dirs.push(dir)
    const s = memoryStorage(dir)
    let sim = await commit(s, 0, newSim('app_invoice', 1), (x) => ['A', 'B', 'C'].forEach((n) => make(n)(x)))
    const [, second] = Object.keys(sim.objects)
    sim = await commit(s, 1, sim, (x) => void (x.objects[second!]!.priority = 'urgent'))
    sim = await commit(s, 2, sim, make('D'))
    const logged = await lines(dir)
    expect(logged.map((l) => [l.version, !!l.full, l.items.length])).toEqual([
      [1, true, 3],
      [2, false, 1],
      [3, false, 1],
    ])
    expect(logged[1]!.items[0]!.id).toBe(second)
    const again = await memoryStorage(dir).state.load('app_invoice')
    expect(again?.version).toBe(3)
    expect(JSON.stringify(again?.state)).toBe(JSON.stringify(sim))
  })

  it('skips a torn last line in the state log: that commit never happened', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modus-data-'))
    dirs.push(dir)
    const s = memoryStorage(dir)
    const sim = await commit(s, 0, newSim('app_invoice', 1), make('A'))
    await commit(s, 1, sim, make('B'))
    const path = join(dir, 'state-app_invoice.jsonl')
    const text = await readFile(path, 'utf8')
    await writeFile(path, text.slice(0, text.length - 20))
    const again = memoryStorage(dir)
    expect(JSON.stringify((await again.state.load('app_invoice'))?.state)).toBe(JSON.stringify(sim))
    // The next commit takes the torn one's place.
    await commit(again, 1, sim, make('C'))
    const after = (await memoryStorage(dir).state.load('app_invoice'))!
    expect(after.version).toBe(2)
    expect(Object.values(after.state.objects).map((o) => o.data.f_invno)).toEqual(['A', 'C'])
  })

  it('rewrites the log as one full line once what was appended outgrows it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modus-data-'))
    dirs.push(dir)
    const s = memoryStorage(dir, { compactBytes: 1 })
    let sim = await commit(s, 0, newSim('app_invoice', 1), make('A'))
    for (let v = 1; v < 30; v++) sim = await commit(s, v, sim, make(`N-${v}`))
    const logged = await lines(dir)
    // The full line is as big as everything since it, give or take a line.
    expect(logged[0]!.full).toBe(true)
    expect(logged.length).toBeLessThan(30)
    expect(logged.filter((l) => l.full)).toHaveLength(1)
    const again = await memoryStorage(dir).state.load('app_invoice')
    expect(again?.version).toBe(30)
    expect(JSON.stringify(again?.state)).toBe(JSON.stringify(sim))
  })

  it('loads a data directory from before the log, and converts it on the first commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'modus-data-'))
    dirs.push(dir)
    const old = copyState(newSim('app_invoice', 1))
    make('OLD')(old)
    await writeFile(join(dir, 'state-app_invoice.json'), JSON.stringify(old))
    await writeFile(join(dir, 'meta-app_invoice.json'), JSON.stringify({ version: 4, tickedAt: 7 }))
    const s = memoryStorage(dir)
    expect(await s.state.load('app_invoice')).toEqual({ version: 4, tickedAt: 7, state: JSON.parse(JSON.stringify(old)) })
    const sim = await commit(s, 4, JSON.parse(JSON.stringify(old)) as SimState, make('NEW'))
    expect((await readdir(dir)).filter((f) => f.startsWith('state-') || f.startsWith('meta-'))).toEqual(['state-app_invoice.jsonl'])
    expect((await lines(dir)).map((l) => [l.version, !!l.full, l.items.length])).toEqual([[5, true, 2]])
    const again = await memoryStorage(dir).state.load('app_invoice')
    expect(JSON.stringify(again?.state)).toBe(JSON.stringify(sim))
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
