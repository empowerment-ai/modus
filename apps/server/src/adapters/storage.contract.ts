// The storage contract: what every adapter must do, written once and run against
// each of them (storage.test.ts). A new adapter is done when this suite passes.

import { type AuditEntry, createObject, type Design, newSim } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { afterEach, describe, expect, it } from 'vitest'
import type { LoggedEvent, Storage } from '../ports'
import { Runtime } from '../runtime'

export interface ContractTarget {
  /** A new, empty store. */
  create(): Promise<Storage>
  /** A second adapter over the same data as the last `create()`: a restart. */
  reopen(): Promise<Storage>
  /** Drop whatever `create()` made. */
  cleanup(): Promise<void>
}

function event(appId: string, itemId: string, seq: number, extra: Partial<AuditEntry> = {}): LoggedEvent {
  return { appId, itemId, itemNumber: `${itemId.toUpperCase()}-1`, seq, at: seq * 1.5, kind: 'note', text: `${itemId} #${seq}`, ...extra } as LoggedEvent
}

export function storageContract(name: string, target: ContractTarget) {
  describe(`storage contract: ${name}`, () => {
    const opened: Storage[] = []
    const create = async () => {
      const s = await target.create()
      opened.push(s)
      return s
    }
    const reopen = async () => {
      const s = await target.reopen()
      opened.push(s)
      return s
    }
    afterEach(async () => {
      for (const s of opened.splice(0)) await s.close?.()
      await target.cleanup()
    })

    it('starts empty', async () => {
      const s = await create()
      expect(await s.designs.load()).toBeUndefined()
      expect(await s.state.load('app_x')).toBeUndefined()
      expect(await s.events.read({})).toEqual([])
      await s.ping?.()
    })

    it('saves the design, replaces it, and keeps it across a restart', async () => {
      const s = await create()
      const design: Design = seedDesign()
      await s.designs.save(design)
      expect(await s.designs.load()).toEqual(design)
      const renamed = { ...design, apps: design.apps.map((a, i) => (i === 0 ? { ...a, name: 'Renamed' } : a)) }
      await s.designs.save(renamed)
      expect((await (await reopen()).designs.load())?.apps[0]?.name).toBe('Renamed')
    })

    it('keeps each application’s state separately, replacing on save', async () => {
      const s = await create()
      const a = newSim('app_a', 1)
      const b = newSim('app_b', 2)
      await s.state.save('app_a', a)
      await s.state.save('app_b', b)
      a.clock = 42
      await s.state.save('app_a', a)
      const again = await reopen()
      expect((await again.state.load('app_a'))?.clock).toBe(42)
      expect(await again.state.load('app_b')).toEqual(JSON.parse(JSON.stringify(b)))
      expect(await again.state.load('app_c')).toBeUndefined()
    })

    it('appends events and reads them back in order, with every field', async () => {
      const s = await create()
      await s.events.append([])
      const first = [event('app_a', 'i1', 1, { userId: 'u_maya', fieldIds: ['f_1', 'f_2'], comment: 'ok' }), event('app_a', 'i1', 2)]
      await s.events.append(first)
      await s.events.append([event('app_b', 'i9', 1), event('app_a', 'i2', 1)])
      const all = await (await reopen()).events.read({})
      expect(all).toEqual([...first, event('app_b', 'i9', 1), event('app_a', 'i2', 1)])
    })

    it('takes a batch sent again without logging what already landed twice', async () => {
      const s = await create()
      await s.events.append([event('app_a', 'i1', 1), event('app_a', 'i1', 2)])
      // The acknowledgement was lost; the runtime sends the whole batch again with one more entry.
      await s.events.append([event('app_a', 'i1', 1), event('app_a', 'i1', 2), event('app_a', 'i1', 3)])
      const all = await (await reopen()).events.read({ appId: 'app_a' })
      expect(all.map((e) => e.seq)).toEqual([1, 2, 3])
    })

    it('filters by application and item, and returns the latest `limit`, oldest first', async () => {
      const s = await create()
      const batch: LoggedEvent[] = []
      for (let i = 1; i <= 250; i++) batch.push(event('app_a', i % 2 ? 'odd' : 'even', Math.ceil(i / 2)))
      batch.push(event('app_b', 'odd', 1))
      await s.events.append(batch)

      expect(await s.events.read({ appId: 'app_b' })).toEqual([event('app_b', 'odd', 1)])
      const odd = await s.events.read({ appId: 'app_a', itemId: 'odd' })
      expect(odd.map((e) => e.seq)).toEqual(Array.from({ length: 125 }, (_, i) => i + 1))
      expect(await s.events.read({ itemId: 'odd', limit: 2 })).toEqual([event('app_a', 'odd', 125), event('app_b', 'odd', 1)])
      const latest = await s.events.read({ appId: 'app_a', limit: 3 })
      expect(latest.map((e) => `${e.itemId}:${e.seq}`)).toEqual(['even:124', 'odd:125', 'even:125'])
      expect(await s.events.read({ appId: 'app_a' })).toHaveLength(200)
      expect(await s.events.read({ appId: 'app_a', limit: 0 })).toEqual([])
    })

    it('runs the engine: a restarted runtime finds the item and its history', async () => {
      const first = await Runtime.create({ storage: await create() })
      const number = await first.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'KEEP-1' }, 'u_maya')!.number)
      await first.stop()

      const storage = await reopen()
      const second = await Runtime.create({ storage })
      const found = await second.read('app_invoice', (sim) => Object.values(sim.objects).find((o) => o.number === number))
      expect(found?.data.f_invno).toBe('KEEP-1')
      const logged = await storage.events.read({ appId: 'app_invoice', itemId: found!.id })
      expect(logged.length).toBeGreaterThan(0)
      expect(logged.map((e) => e.seq)).toEqual(logged.map((_, i) => i + 1))
      expect(logged.every((e) => e.itemNumber === number)).toBe(true)
      await second.stop()
    })
  })
}
