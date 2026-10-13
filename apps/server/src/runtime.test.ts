import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createObject, newSim } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './adapters/memory'
import { type ChangeNotice, type Storage, StorageBusy } from './ports'
import { Runtime, StorageUnavailable } from './runtime'

const make = (rt: Runtime, n: string, by = 'u_maya') => rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: n }, by))
/** The same store, with this replica's change notices held back until `deliver` (as if they were slow to arrive). */
function slowNotices(storage: Storage) {
  const held: ChangeNotice[] = []
  let hear: (n: ChangeNotice) => void = () => undefined
  const peer: Storage = { ...storage, listen: async (onChange) => ((hear = onChange), async () => undefined) }
  return { peer, held, deliver: (n: ChangeNotice) => hear(n), watch: () => storage.listen((n) => void held.push(n)) }
}
const numbers = (rt: Runtime) => rt.read('app_invoice', (sim) => Object.values(sim.objects).map((o) => o.data.f_invno))

describe('runtime', () => {
  afterEach(() => vi.useRealTimers())

  it('commits each command, and changes nothing in memory when storage refuses it', async () => {
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage })
    await make(rt, 'OK-1')
    expect((await storage.state.load('app_invoice'))?.version).toBe(1)

    const transact = storage.transact
    storage.transact = () => Promise.reject(new Error('database unreachable'))
    await expect(make(rt, 'LOST')).rejects.toBeInstanceOf(StorageUnavailable)
    storage.transact = () => Promise.reject(new StorageBusy('busy'))
    await expect(make(rt, 'BUSY')).rejects.toThrow(/busy/i)
    expect(await numbers(rt)).toEqual(['OK-1'])

    storage.transact = transact
    await make(rt, 'OK-2')
    expect(await numbers(rt)).toEqual(['OK-1', 'OK-2'])
    await rt.stop()
  })

  it('lets an error thrown by the command itself through, unchanged, with nothing written', async () => {
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage })
    await expect(
      rt.run('app_invoice', (sim, ctx) => {
        createObject(sim, ctx, 'w_invoice', { f_invno: 'HALF' }, 'u_maya')
        throw new TypeError('bad')
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(await numbers(rt)).toEqual([])
    expect(await storage.state.load('app_invoice')).toBeUndefined()
    await rt.stop()
  })

  it('moves the clock by wall time on every command, from the stored clock time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage, timeScale: 60 })
    await make(rt, 'C-1')
    const at = await rt.read('app_invoice', (sim) => sim.clock)
    vi.setSystemTime(Date.now() + 60_000)
    await make(rt, 'C-2')
    expect(await rt.read('app_invoice', (sim) => sim.clock)).toBeCloseTo(at + 60)
    await rt.stop()
  })

  it('doesn’t move the clock of a state stored before clock times were kept; the commit starts keeping one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // A data directory from before versions: a state file and no meta file (version 1, no clock time).
    const dir = await mkdtemp(join(tmpdir(), 'modus-legacy-'))
    try {
      const legacy = newSim('app_invoice', 1)
      legacy.arrivals = false
      legacy.clock = 500
      await writeFile(join(dir, 'design.json'), JSON.stringify(seedDesign()))
      await writeFile(join(dir, 'state-app_invoice.json'), JSON.stringify(legacy))
      const storage = memoryStorage(dir)
      const before = await storage.state.load('app_invoice')
      expect(before?.version).toBe(1)
      expect(before?.tickedAt).toBeUndefined()
      const rt = await Runtime.create({ storage, timeScale: 60 })
      await make(rt, 'L-1')
      expect(await rt.read('app_invoice', (sim) => sim.clock)).toBe(500)
      expect(await storage.state.load('app_invoice')).toMatchObject({ version: 2, tickedAt: Date.now() })
      vi.setSystemTime(Date.now() + 60_000)
      await make(rt, 'L-2')
      expect(await rt.read('app_invoice', (sim) => sim.clock)).toBeCloseTo(560)
      await rt.stop()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('backfills projections for state stored before they existed', async () => {
    const storage = memoryStorage()
    const first = await Runtime.create({ storage })
    const o = await make(first, 'OLD')
    await first.stop()
    // Simulate a store from before projections: same state, no rows.
    const bare = memoryStorage()
    const state = (await storage.state.load('app_invoice'))!.state!
    await bare.transact('app_invoice', 0, () => ({ value: 0, write: { state, entries: [], items: [], outbox: [], tickedAt: Date.now() } }))
    await bare.designs.save(first.design)
    const second = await Runtime.create({ storage: bare })
    expect(await bare.projections.item('app_invoice', o!.id)).toMatchObject({ number: o!.number })
    await second.stop()
  })

  it('hears another runtime’s commit on the same store, and tells its own subscribers', async () => {
    const storage = memoryStorage()
    const a = await Runtime.create({ storage })
    const b = await Runtime.create({ storage })
    const seen: string[][] = []
    b.subscribe((c) => seen.push(c.itemIds))
    const o = await make(a, 'HEARD')
    await vi.waitFor(() => expect(seen.flat()).toContain(o!.id))
    expect(await numbers(b)).toEqual(['HEARD'])
    // b's next command starts from what a wrote.
    await make(b, 'NEXT')
    expect(await numbers(b)).toEqual(['HEARD', 'NEXT'])
    await a.stop()
    await b.stop()
  })

  it('tells subscribers about another runtime’s items it picks up in a command, even one that fails', async () => {
    const storage = memoryStorage()
    const { peer } = slowNotices(storage)
    const a = await Runtime.create({ storage })
    const b = await Runtime.create({ storage: peer })
    const seen: string[][] = []
    b.subscribe((c) => seen.push(c.itemIds))
    // b hasn't heard of X when it makes Y: the transaction hands it X's state.
    const x = await make(a, 'X')
    const y = await make(b, 'Y')
    expect(seen).toEqual([[x!.id, y!.id].sort()])
    // A command that fails on top of another's change still shows that change.
    const z = await make(a, 'Z')
    await expect(
      b.run('app_invoice', () => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    expect(seen[1]).toEqual([z!.id])
    expect(await numbers(b)).toEqual(['X', 'Y', 'Z'])
    await a.stop()
    await b.stop()
  })

  it('tells subscribers about every item it reloads, across versions it never heard of', async () => {
    const storage = memoryStorage()
    const { peer, held, deliver, watch } = slowNotices(storage)
    await watch()
    const a = await Runtime.create({ storage })
    const b = await Runtime.create({ storage: peer })
    const seen: string[][] = []
    b.subscribe((c) => seen.push(c.itemIds))
    const x = await make(a, 'X')
    const y = await make(a, 'Y')
    await vi.waitFor(() => expect(held).toHaveLength(2))
    // The first notice arrives after storage has moved on: the reload shows both items.
    deliver(held[0]!)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual([x!.id, y!.id].sort())
    // The second is now old news.
    deliver(held[1]!)
    expect(await numbers(b)).toEqual(['X', 'Y'])
    expect(seen).toHaveLength(1)
    await a.stop()
    await b.stop()
  })

  it('doesn’t reload its own commits', async () => {
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage })
    const load = vi.spyOn(storage.state, 'load')
    for (let i = 0; i < 10; i++) await make(rt, `OWN-${i}`)
    expect(await numbers(rt)).toHaveLength(10)
    expect(load).not.toHaveBeenCalled()
    await rt.stop()
  })

  it('keeps the storage error as the cause, and a busy lock’s own message', async () => {
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage })
    const down = new Error('database unreachable')
    storage.transact = () => Promise.reject(down)
    await expect(make(rt, 'LOST')).rejects.toMatchObject({ cause: down })
    const busy = new StorageBusy('Another server is busy with this application.')
    storage.transact = () => Promise.reject(busy)
    await expect(make(rt, 'BUSY')).rejects.toMatchObject({ message: busy.message, cause: busy })
    await rt.stop()
  })

  it('reports a subscriber that throws, and the command still succeeds', async () => {
    const errors: string[] = []
    const rt = await Runtime.create({ storage: memoryStorage(), onError: (_e, during) => errors.push(during) })
    rt.subscribe(() => {
      throw new Error('subscriber bug')
    })
    expect(await make(rt, 'SUB')).toBeDefined()
    expect(errors).toEqual(['subscriber'])
    await rt.stop()
  })

  it('reports a failed reload of another runtime’s change instead of throwing', async () => {
    const storage = memoryStorage()
    const errors: string[] = []
    const a = await Runtime.create({ storage })
    const b = await Runtime.create({ storage, onError: (_e, during) => errors.push(during) })
    storage.state.load = () => Promise.reject(new Error('database unreachable'))
    await make(a, 'UNHEARD')
    await vi.waitFor(() => expect(errors).toContain('listen'))
    await a.stop()
    await b.stop()
  })

  it('keeps ticking the other applications when one fails, and reports it', async () => {
    const storage = memoryStorage()
    const errors: Array<[string, string]> = []
    const rt = await Runtime.create({ storage, onError: (e, during) => errors.push([during, (e as Error).message]) })
    expect(rt.design.apps.length).toBeGreaterThan(1)
    const [first, ...rest] = rt.design.apps
    const tryClock = storage.tryClock
    storage.tryClock = (appId, owner) => (appId === first!.id ? Promise.reject(new Error('lock lost')) : tryClock(appId, owner))
    await rt.tick()
    expect(errors).toEqual([['tick', 'lock lost']])
    for (const app of rest) expect((await storage.state.load(app.id))?.version).toBe(1)
    await rt.stop()
  })

  it('ticks only the applications whose clock it holds, and skips an idle tick', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const storage = memoryStorage()
    const a = await Runtime.create({ storage })
    const b = await Runtime.create({ storage })
    await a.tick()
    await b.tick()
    expect((await storage.state.load('app_invoice'))?.version).toBe(1)
    // Under 30 s with nothing logged: rolled back.
    vi.setSystemTime(Date.now() + 10_000)
    await a.tick()
    expect((await storage.state.load('app_invoice'))?.version).toBe(1)
    vi.setSystemTime(Date.now() + 30_000)
    await a.tick()
    expect((await storage.state.load('app_invoice'))?.version).toBe(2)
    await a.stop()
    // a let go of its clocks: b takes over.
    vi.setSystemTime(Date.now() + 30_000)
    await b.tick()
    expect((await storage.state.load('app_invoice'))?.version).toBe(3)
    await b.stop()
  })

  it('is not ready while it can’t hear other servers’ changes', async () => {
    const storage = memoryStorage()
    let listening = true
    storage.listening = () => listening
    const rt = await Runtime.create({ storage })
    expect(await rt.checkStorage()).toEqual({ storage: 'memory' })
    listening = false
    expect((await rt.checkStorage()).error).toMatch(/not receiving other servers’ changes/)
    await rt.stop()
  })

  it('leaves no timers behind when stopped', async () => {
    vi.useFakeTimers()
    const rt = await Runtime.create({ storage: memoryStorage() })
    rt.start()
    rt.start()
    expect(vi.getTimerCount()).toBe(1)
    await rt.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
