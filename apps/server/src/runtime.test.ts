import { createObject } from '@modus-bpm/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './adapters/memory'
import { Runtime, StorageUnavailable } from './runtime'

describe('runtime with unreliable storage', () => {
  afterEach(() => vi.useRealTimers())

  it('refuses changes while audit entries can’t be written, and catches up once storage is back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const storage = memoryStorage()
    const append = storage.events.append
    let down = true
    const errors: string[] = []
    storage.events.append = (batch) => (down ? Promise.reject(new Error('database unreachable')) : append(batch))
    const rt = await Runtime.create({ storage, onError: (_e, during) => errors.push(during) })
    const make = (n: string) => rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: n }, 'u_maya'))

    // The change happens in memory, but the caller hears its audit entries aren't written.
    await expect(make('RETRY-1')).rejects.toBeInstanceOf(StorageUnavailable)
    // Nothing more changes while that is so.
    await expect(make('RETRY-2')).rejects.toThrow(/can’t be recorded/)
    const inMemory = await rt.read('app_invoice', (sim) => Object.values(sim.objects).map((o) => o.data.f_invno))
    expect(inMemory).toContain('RETRY-1')
    expect(inMemory).not.toContain('RETRY-2')
    // The clock backs off instead of retrying every tick.
    const tries = errors.length
    await rt.tick()
    expect(errors.length).toBe(tries)
    expect(await storage.events.read({})).toEqual([])

    down = false
    vi.setSystemTime(Date.now() + 2000)
    await rt.tick()
    const logged = await storage.events.read({ appId: 'app_invoice' })
    expect(new Set(logged.map((e) => e.itemNumber)).size).toBe(1)
    expect(logged.map((e) => e.seq)).toEqual(logged.map((_, i) => i + 1))
    expect(await make('RETRY-3')).toBeDefined()

    await rt.stop()
    const saved = await storage.state.load('app_invoice')
    expect(Object.values(saved!.objects).some((o) => o.data.f_invno === 'RETRY-3')).toBe(true)
  })

  it('restarts after a crash that lost recent state without reusing positions the log holds', async () => {
    const storage = memoryStorage()
    const first = await Runtime.create({ storage })
    const make = (rt: Runtime, n: string, by = 'u_maya') => rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: n }, by))
    await make(first, 'BEFORE')
    const snapshot = await first.read('app_invoice', (sim) => structuredClone(sim))
    const lost = await make(first, 'LOST')
    // Crash: the log has LOST, the last state snapshot doesn't.
    await storage.state.save('app_invoice', snapshot)

    const second = await Runtime.create({ storage })
    const lostEntries = (await storage.events.read({ itemId: lost!.id, limit: 1000 })).length
    // Someone else creates the next item: different entries where the log already has the lost ones.
    const again = await make(second, 'AFTER', 'u_jordan')
    // The restored counters hand out the lost item's id again; its entries go after the logged ones.
    expect(again!.id).toBe(lost!.id)
    const log = await storage.events.read({ itemId: again!.id, limit: 1000 })
    expect(log.length).toBe(lostEntries + again!.history.length)
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1))
    expect(await make(second, 'NEXT')).toBeDefined()
    await second.stop()
  })
})
