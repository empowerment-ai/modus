import { createObject } from '@modus-bpm/core'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from './adapters/memory'
import { Runtime } from './runtime'

describe('runtime with unreliable storage', () => {
  it('sends a failed event batch again and still snapshots the state', async () => {
    const storage = memoryStorage()
    const append = storage.events.append
    let down = true
    storage.events.append = (batch) => (down ? Promise.reject(new Error('database unreachable')) : append(batch))
    const rt = await Runtime.create({ storage })

    await expect(rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'RETRY-1' }, 'u_maya'))).rejects.toThrow(/unreachable/)
    expect(await storage.events.read({})).toEqual([])

    down = false
    await rt.tick()
    const logged = await storage.events.read({ appId: 'app_invoice' })
    expect(logged.length).toBeGreaterThan(0)
    expect(logged.map((e) => e.seq)).toEqual(logged.map((_, i) => i + 1))

    await rt.stop()
    const saved = await storage.state.load('app_invoice')
    expect(Object.values(saved!.objects).some((o) => o.data.f_invno === 'RETRY-1')).toBe(true)
  })
})
