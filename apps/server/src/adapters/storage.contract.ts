// The storage contract: what every adapter must do, written once and run against
// each of them (storage.test.ts). A new adapter is done when this suite passes.

import { type AuditEntry, changesBetween, createObject, type Ctx, type Design, newSim, projectItem, type SimState } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoggedEvent, Storage, Write } from '../ports'
import { Runtime } from '../runtime'

export interface ContractTarget {
  /** A new, empty store. */
  create(): Promise<Storage>
  /** A second adapter over the same data as the last `create()`: a restart. */
  reopen(): Promise<Storage>
  /** Drop whatever `create()` made. */
  cleanup(): Promise<void>
  /** Projections and the outbox survive a restart (memory rebuilds them at startup instead). */
  persistsProjections?: boolean
}

function event(appId: string, itemId: string, seq: number, extra: Partial<AuditEntry> = {}): LoggedEvent {
  return { appId, itemId, itemNumber: `${itemId.toUpperCase()}-1`, seq, at: seq * 1.5, kind: 'note', text: `${itemId} #${seq}`, ...extra } as LoggedEvent
}

function ctxOf(design = seedDesign(), appId = 'app_invoice'): Ctx {
  return { app: design.apps.find((a) => a.id === appId)!, users: design.users, groups: design.groups, services: design.services, live: true }
}

/** A command as the runtime will run it: on a copy, committing whatever changed. */
function writeFor(before: SimState, after: SimState, ctx: Ctx, tickedAt = 0): Write {
  const c = changesBetween(before, after)
  return { state: after, entries: c.entries, items: c.itemIds.map((id) => projectItem(after, ctx, id)!), outbox: c.outbox, tickedAt }
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

    it('says the highest position logged for each item of an application', async () => {
      const s = await create()
      await s.events.append([event('app_a', 'i1', 1), event('app_a', 'i1', 2), event('app_a', 'i2', 1), event('app_b', 'i9', 1)])
      expect(await (await reopen()).events.positions('app_a')).toEqual(new Map([['i1', 2], ['i2', 1]]))
      expect(await s.events.positions('app_none')).toEqual(new Map())
    })

    it('refuses a batch that puts a different entry at a position already taken, and writes none of it', async () => {
      const s = await create()
      await s.events.append([event('app_a', 'i1', 1)])
      const other = { ...event('app_a', 'i1', 1), text: 'something else' }
      await expect(s.events.append([event('app_a', 'i2', 1), other])).rejects.toThrow(/conflict/)
      const all = await (await reopen()).events.read({ appId: 'app_a' })
      expect(all).toEqual([event('app_a', 'i1', 1)])
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
    it('commits state, audit entries, projections and outbox together, bumping the version', async () => {
      const s = await create()
      const ctx = ctxOf()
      const before = newSim('app_invoice', 1)
      const r = await s.transact('app_invoice', 0, (stored) => {
        expect(stored).toEqual({ version: 0 })
        const after = structuredClone(before)
        const o = createObject(after, ctx, 'w_invoice', { f_invno: 'T-1' }, 'u_maya')!
        return { value: o, write: writeFor(before, after, ctx, 1000) }
      })
      expect(r).toMatchObject({ version: 1, committed: true })
      const o = r.value
      const projected = async (from: Storage) => {
        expect(await from.projections.item('app_invoice', o.id)).toMatchObject({ number: o.number, status: 'active', title: expect.any(String), data: { f_invno: 'T-1' } })
        expect((await from.projections.workItems('app_invoice', o.id)).map((w) => w.state)).toEqual(['auto'])
        expect((await from.projections.outbox('app_invoice')).map((m) => m.kind)).toEqual(['job.ready'])
      }
      // Projections may live only in memory (the memory adapter rebuilds them at startup), so read them here too.
      await projected(s)
      const again = await reopen()
      if (target.persistsProjections) await projected(again)
      expect(await again.state.get('app_invoice')).toMatchObject({ version: 1, tickedAt: 1000 })
      const logged = await again.events.read({ itemId: o.id })
      expect(logged.map((e) => e.seq)).toEqual(o.history.map((_, i) => i + 1))
    })

    it('writes nothing when the work throws, or returns no write', async () => {
      const s = await create()
      await expect(
        s.transact('app_x', 0, () => {
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')
      expect(await s.transact('app_x', 0, () => ({ value: 7 }))).toEqual({ value: 7, version: 0, committed: false })
      expect(await s.state.get('app_x')).toBeUndefined()
      expect(await s.events.read({})).toEqual([])
      expect(await s.projections.outbox('app_x')).toEqual([])
    })

    it('hands back the stored state only when the caller’s version is stale', async () => {
      const s = await create()
      const sim = newSim('app_a', 1)
      await s.transact('app_a', 0, () => ({ value: 0, write: { state: sim, entries: [], items: [], outbox: [], tickedAt: 5 } }))
      await s.transact('app_a', 1, (stored) => {
        expect(stored).toEqual({ version: 1, tickedAt: 5 })
        return { value: 0 }
      })
      await s.transact('app_a', 0, (stored) => {
        expect(stored.state).toEqual(JSON.parse(JSON.stringify(sim)))
        return { value: 0 }
      })
    })

    it('numbers new entries after what the log already holds for the item', async () => {
      const s = await create()
      const entry = (text: string) => ({ at: 1, kind: 'note', text }) as never
      const commit = (version: number, ...groups: string[][]) =>
        s.transact('app_a', version, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: groups.map((texts) => ({ itemId: 'i1', itemNumber: 'A-1', entries: texts.map(entry) })), items: [], outbox: [], tickedAt: 0 } }))
      await commit(0, ['a', 'b'])
      await commit(1, ['c'])
      // Two groups for one item in one write: numbered one after the other.
      await commit(2, ['d'], ['e'])
      expect((await s.events.read({ itemId: 'i1' })).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:a', '2:b', '3:c', '4:d', '5:e'])
    })

    it('replaces an item’s work-item rows, dropping tokens that left', async () => {
      const s = await create()
      const ctx = ctxOf()
      const sim = newSim('app_invoice', 1)
      const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'T-2' }, 'u_maya')!
      const write = (version: number) => s.transact('app_invoice', version, () => ({ value: 0, write: { state: sim, entries: [], items: [projectItem(sim, ctx, o.id)!], outbox: [], tickedAt: 0 } }))
      await write(0)
      expect(await s.projections.workItems('app_invoice', o.id)).toHaveLength(1)
      o.tokens = []
      o.status = 'cancelled'
      await write(1)
      expect(await s.projections.workItems('app_invoice', o.id)).toEqual([])
      expect((await s.projections.item('app_invoice', o.id))?.status).toBe('cancelled')
      expect(await s.projections.any('app_invoice')).toBe(true)
      expect(await s.projections.any('app_none')).toBe(false)
    })

    it('tells listeners about each commit', async () => {
      const s = await create()
      const heard: unknown[] = []
      const stop = await s.listen((n) => heard.push(n))
      await s.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
      await vi.waitFor(() => expect(heard).toEqual([{ appId: 'app_a', version: 1, itemIds: [] }]))
      await stop()
    })

    it('gives one owner the clock until it lets go', async () => {
      const s = await create()
      expect(await s.tryClock('app_a', 'one')).toBe(true)
      expect(await s.tryClock('app_a', 'one')).toBe(true)
      await s.releaseClocks('one')
      expect(await s.tryClock('app_a', 'two')).toBe(true)
    })
  })
}
