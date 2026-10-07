import { createObject } from '@modus-bpm/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './adapters/memory'
import { Runtime } from './runtime'

describe('runtime with unreliable storage', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps taking commands while the log is down, and sends the held-back entries once it is back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const storage = memoryStorage()
    const append = storage.events.append
    let down = true
    const errors: string[] = []
    storage.events.append = (batch) => (down ? Promise.reject(new Error('database unreachable')) : append(batch))
    const rt = await Runtime.create({ storage, onError: (_e, during) => errors.push(during) })

    const first = await rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'RETRY-1' }, 'u_maya'))
    expect(first).toBeDefined()
    expect(errors).toEqual(['log'])
    // Backing off: the next command neither waits on nor hammers the log.
    const second = await rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'RETRY-2' }, 'u_maya'))
    expect(second).toBeDefined()
    expect(errors).toEqual(['log'])
    expect(await storage.events.read({})).toEqual([])

    down = false
    vi.setSystemTime(Date.now() + 2000)
    await rt.tick()
    const logged = await storage.events.read({ appId: 'app_invoice' })
    const numbers = new Set(logged.map((e) => e.itemNumber))
    expect(numbers.size).toBe(2)
    for (const n of numbers) {
      const seqs = logged.filter((e) => e.itemNumber === n).map((e) => e.seq)
      expect(seqs).toEqual(seqs.map((_, i) => i + 1))
    }

    await rt.stop()
    const saved = await storage.state.load('app_invoice')
    expect(Object.values(saved!.objects).some((o) => o.data.f_invno === 'RETRY-2')).toBe(true)
  })
})
