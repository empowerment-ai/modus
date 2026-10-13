// The storage contract: what every adapter must do, written once and run against
// each of them (storage.test.ts). A new adapter is done when this suite passes.

import { type AuditEntry, changesBetween, createObject, type Ctx, type Design, newSim, type OutboxMessage, projectItem, type SimState } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Delivery, LoggedEvent, Storage, Write } from '../ports'
import { Runtime } from '../runtime'

export interface ContractTarget {
  /** A new, empty store. */
  create(): Promise<Storage>
  /** A second adapter over the same data as the last `create()`: a restart. */
  reopen(): Promise<Storage>
  /** Another adapter over the same data as the last `create()`, used at the same time: another replica (memory: the same instance). */
  peer(): Promise<Storage>
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

/** Commit `entries` as one write (state: `state`, or an empty one), grouped per item in order. Storage numbers them, so their `seq` must be what it will give. */
function commitEntries(s: Storage, appId: string, version: number, entries: LoggedEvent[], state = newSim(appId, 1)) {
  const groups: Write['entries'] = []
  for (const { appId: _, itemId, itemNumber, seq: __, ...entry } of entries) {
    const last = groups.at(-1)
    if (last?.itemId === itemId) last.entries.push(entry as AuditEntry)
    else groups.push({ itemId, itemNumber, entries: [entry as AuditEntry] })
  }
  return s.transact(appId, version, () => ({ value: 0, write: { state, entries: groups, items: [], outbox: [], tickedAt: 0 } }))
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
    const peer = async () => {
      const s = await target.peer()
      if (!opened.includes(s)) opened.push(s)
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

    it('keeps each application’s state separately, replacing it on each commit', async () => {
      const s = await create()
      const a = newSim('app_a', 1)
      const b = newSim('app_b', 2)
      await commitEntries(s, 'app_a', 0, [], a)
      await commitEntries(s, 'app_b', 0, [], b)
      a.clock = 42
      await commitEntries(s, 'app_a', 1, [], a)
      const again = await reopen()
      expect(await again.state.load('app_a')).toMatchObject({ version: 2, state: { clock: 42 } })
      expect(await again.state.load('app_b')).toEqual({ version: 1, tickedAt: 0, state: JSON.parse(JSON.stringify(b)) })
      expect(await again.state.load('app_c')).toBeUndefined()
    })

    it('logs committed entries and reads them back in order, with every field', async () => {
      const s = await create()
      const first = [event('app_a', 'i1', 1, { userId: 'u_maya', fieldIds: ['f_1', 'f_2'], comment: 'ok' }), event('app_a', 'i1', 2)]
      await commitEntries(s, 'app_a', 0, first)
      await commitEntries(s, 'app_b', 0, [event('app_b', 'i9', 1)])
      await commitEntries(s, 'app_a', 1, [event('app_a', 'i2', 1)])
      const all = await (await reopen()).events.read({})
      expect(all).toEqual([...first, event('app_b', 'i9', 1), event('app_a', 'i2', 1)])
    })

    it('filters by application and item, and returns the latest `limit`, oldest first', async () => {
      const s = await create()
      const batch: LoggedEvent[] = []
      for (let i = 1; i <= 250; i++) batch.push(event('app_a', i % 2 ? 'odd' : 'even', Math.ceil(i / 2)))
      await commitEntries(s, 'app_a', 0, batch)
      await commitEntries(s, 'app_b', 0, [event('app_b', 'odd', 1)])

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
      expect(await again.state.load('app_invoice')).toMatchObject({ version: 1, tickedAt: 1000 })
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
      expect(await s.state.load('app_x')).toBeUndefined()
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
      const commit = (to: Storage, version: number, ...groups: string[][]) =>
        to.transact('app_a', version, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: groups.map((texts) => ({ itemId: 'i1', itemNumber: 'A-1', entries: texts.map(entry) })), items: [], outbox: [], tickedAt: 0 } }))
      await commit(s, 0, ['a', 'b'])
      await commit(s, 1, ['c'])
      // Two groups for one item in one write: numbered one after the other.
      await commit(s, 2, ['d'], ['e'])
      expect((await s.events.read({ itemId: 'i1' })).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:a', '2:b', '3:c', '4:d', '5:e'])
      // After a restart, numbering carries on from what the log holds.
      const again = await reopen()
      await commit(again, 3, ['f'])
      expect((await again.events.read({ itemId: 'i1' })).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:a', '2:b', '3:c', '4:d', '5:e', '6:f'])
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

    it('lists work items by item, then time entered, then token', async () => {
      const s = await create()
      const item = (itemId: string) => ({ itemId, number: itemId, title: itemId, status: 'active' as const, priority: 'normal' as const, expedited: false, createdAt: 0, data: {} })
      const work = (itemId: string, tokenId: string, enteredAt: number) => ({ tokenId, itemId, stepId: 's1', state: 'auto' as const, enteredAt, priority: 'normal' as const })
      // Written out of order: the order comes from the read, not from how rows landed.
      const items = [
        { item: item('i_b'), workItems: [work('i_b', 'tz', 3), work('i_b', 'tm', 1), work('i_b', 'ta', 3)] },
        { item: item('i_a'), workItems: [work('i_a', 'tq', 7)] },
      ] as never
      await s.transact('app_w', 0, () => ({ value: 0, write: { state: newSim('app_w', 1), entries: [], items, outbox: [], tickedAt: 0 } }))
      expect((await s.projections.workItems('app_w')).map((w) => `${w.itemId}/${w.tokenId}`)).toEqual(['i_a/tq', 'i_b/tm', 'i_b/ta', 'i_b/tz'])
      expect((await s.projections.workItems('app_w', 'i_b')).map((w) => w.tokenId)).toEqual(['tm', 'ta', 'tz'])
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

    describe('outbox deliveries', () => {
      const T = Date.UTC(2026, 0, 1)
      const DAY = 24 * 60 * 60_000
      const msg = (itemId: string, kind: OutboxMessage['kind'] = 'notify'): OutboxMessage => ({ itemId, kind, payload: { itemId } })
      /** Commit `messages` to `appId`'s outbox; returns their ids. */
      const write = async (s: Storage, appId: string, messages: OutboxMessage[]) => {
        const version = (await s.state.load(appId))?.version ?? 0
        await s.transact(appId, version, () => ({ value: 0, write: { state: newSim(appId, 1), entries: [], items: [], outbox: messages, tickedAt: 0 } }))
        return (await s.projections.outbox(appId)).slice(-messages.length).map((m) => m.id)
      }
      const toA = () => ['a']
      const keys = (ds: Delivery[]) => ds.map((d) => `${d.outboxId}:${d.endpoint}`)

      it('fans each message out to its endpoints once, and marks a message with none sent', async () => {
        const s = await create()
        const [, routed] = await write(s, 'app_a', [msg('i1', 'job.ready'), msg('i2')])
        const route = (m: { appId: string; kind: string }) => (m.kind === 'notify' ? ['a', 'b'] : [])
        expect(await s.deliveries.fanOut(route, T, 10)).toBe(2)
        const made = await s.deliveries.list({})
        expect(made.map((d) => d.endpoint).sort()).toEqual(['a', 'b'])
        for (const d of made)
          expect(d).toMatchObject({ outboxId: routed, appId: 'app_a', itemId: 'i2', kind: 'notify', payload: { itemId: 'i2' }, createdAt: expect.any(Number), status: 'pending', attempts: 0, nextAt: T })
        expect(Math.abs(made[0]!.createdAt - Date.now())).toBeLessThan(60_000)
        expect((await s.projections.outbox('app_a')).map((m) => m.id)).toEqual([routed])
        expect(await s.deliveries.fanOut(route, T, 10)).toBe(0)
        expect(await s.deliveries.list({})).toHaveLength(2)

        // Oldest first, `limit` at a time.
        const more = await write(s, 'app_b', [msg('i3'), msg('i4'), msg('i5')])
        expect(await s.deliveries.fanOut(toA, T, 2)).toBe(2)
        expect((await s.deliveries.list({})).filter((d) => d.appId === 'app_b').map((d) => d.outboxId)).toEqual(more.slice(0, 2).reverse())
        expect(await s.deliveries.fanOut(toA, T, 2)).toBe(1)
      })

      it('claims due deliveries oldest first, and keeps them from everyone else until the lease runs out', async () => {
        const s = await create()
        const ids = await write(s, 'app_a', [msg('i1'), msg('i2'), msg('i3')])
        await s.deliveries.fanOut(toA, T, 10)
        expect(keys(await s.deliveries.claim(T, 1000, 2))).toEqual([`${ids[0]}:a`, `${ids[1]}:a`])
        expect(keys(await s.deliveries.claim(T, 1000, 10))).toEqual([`${ids[2]}:a`])
        expect(await s.deliveries.claim(T + 999, 1000, 10)).toEqual([])
        const again = await s.deliveries.claim(T + 1000, 1000, 10)
        expect(keys(again)).toEqual(ids.map((id) => `${id}:a`))
        expect(again[0]).toMatchObject({ status: 'pending', attempts: 0, nextAt: T + 2000, itemId: 'i1' })
      })

      it('never hands one delivery to two claimers at once', async () => {
        const s = await create()
        await write(s, 'app_a', Array.from({ length: 20 }, (_, i) => msg(`i${i}`)))
        await s.deliveries.fanOut(toA, T, 100)
        const other = await peer()
        const got: string[] = []
        for (let round = 0; round < 20; round++) {
          const [x, y] = await Promise.all([s.deliveries.claim(T, 60_000, 3), other.deliveries.claim(T, 60_000, 3)])
          if (!x.length && !y.length) break
          got.push(...keys(x), ...keys(y))
        }
        expect(got).toHaveLength(20)
        expect(new Set(got).size).toBe(20)
      })

      it('records a delivery, and counts the message sent once every endpoint is settled', async () => {
        const s = await create()
        const [id] = await write(s, 'app_a', [msg('i1')])
        await s.deliveries.fanOut(() => ['a', 'b'], T, 10)
        await s.deliveries.claim(T, 1000, 10)
        await s.deliveries.record(id!, 'a', { status: 'delivered', lastStatus: 200 }, T + 5)
        expect((await s.deliveries.list({ status: 'delivered' }))[0]).toMatchObject({ outboxId: id, endpoint: 'a', attempts: 1, deliveredAt: T + 5, lastStatus: 200 })
        expect((await s.projections.outbox('app_a')).map((m) => m.id)).toEqual([id])
        await s.deliveries.record(id!, 'b', { status: 'failed', lastStatus: 404, lastError: 'Not Found' }, T + 6)
        expect(await s.projections.outbox('app_a')).toEqual([])
      })

      it('holds a retried delivery until its next attempt, and lists failures with their last answer', async () => {
        const s = await create()
        const [id] = await write(s, 'app_a', [msg('i1')])
        await s.deliveries.fanOut(toA, T, 10)
        await s.deliveries.claim(T, 60_000, 10)
        await s.deliveries.record(id!, 'a', { status: 'pending', nextAt: T + 10_000, lastStatus: 500, lastError: 'Internal Server Error' }, T)
        expect(await s.deliveries.claim(T + 9_999, 60_000, 10)).toEqual([])
        expect(await s.deliveries.claim(T + 10_000, 60_000, 10)).toMatchObject([{ outboxId: id, attempts: 1, lastStatus: 500 }])
        await s.deliveries.record(id!, 'a', { status: 'failed', lastStatus: 400, lastError: 'Bad Request' }, T + 10_001)
        expect(await s.deliveries.list({ status: 'failed' })).toMatchObject([{ outboxId: id, endpoint: 'a', status: 'failed', attempts: 2, lastStatus: 400, lastError: 'Bad Request' }])
        expect(await s.deliveries.list({ status: 'pending' })).toEqual([])
      })

      it('sends a failed message again on retry', async () => {
        const s = await create()
        const [failed, delivered] = await write(s, 'app_a', [msg('i1'), msg('i2')])
        await s.deliveries.fanOut(toA, T, 10)
        await s.deliveries.claim(T, 60_000, 10)
        await s.deliveries.record(failed!, 'a', { status: 'failed', lastStatus: 400 }, T)
        await s.deliveries.record(delivered!, 'a', { status: 'delivered', lastStatus: 200 }, T)
        expect(await s.projections.outbox('app_a')).toEqual([])
        expect(await s.deliveries.retry(failed!, T + 20)).toBe(true)
        expect((await s.projections.outbox('app_a')).map((m) => m.id)).toEqual([failed])
        expect(keys(await s.deliveries.claim(T + 20, 60_000, 10))).toEqual([`${failed}:a`])
        expect(await s.deliveries.retry(delivered!, T + 20)).toBe(false)
        expect(await s.deliveries.retry(failed!, T + 20)).toBe(false)
        expect(await s.deliveries.retry(999_999, T + 20)).toBe(false)
      })

      it('prunes messages sent long enough ago, keeping failed ones longer and pending ones always', async () => {
        const s = await create()
        const [oldSent, oldFailed, recent, pending] = await write(s, 'app_a', [msg('i1'), msg('i2'), msg('i3'), msg('i4'), msg('i5', 'job.ready')])
        // i5 is routed nowhere: skipped and sent at T.
        await s.deliveries.fanOut((m) => (m.kind === 'notify' ? ['a'] : []), T, 10)
        await s.deliveries.claim(T, 60_000, 10)
        await s.deliveries.record(oldSent!, 'a', { status: 'delivered' }, T)
        await s.deliveries.record(oldFailed!, 'a', { status: 'failed', lastStatus: 400 }, T)
        await s.deliveries.record(recent!, 'a', { status: 'delivered' }, T + 9 * DAY)
        expect(await s.deliveries.prune(T + 10 * DAY, 7 * DAY, 30 * DAY)).toBe(2)
        expect((await s.deliveries.list({})).map((d) => d.outboxId).sort((x, y) => x - y)).toEqual([oldFailed, recent, pending])
        expect(await s.deliveries.prune(T + 31 * DAY, 7 * DAY, 30 * DAY)).toBe(2)
        expect((await s.deliveries.list({})).map((d) => d.outboxId)).toEqual([pending])
        expect((await s.projections.outbox('app_a')).map((m) => m.id)).toEqual([pending])
      })
    })

    describe('two replicas', () => {
      it('lose no update across 50 interleaved commands, with unique numbers and gapless logs', async () => {
        const a = await Runtime.create({ storage: await create() })
        const b = await Runtime.create({ storage: await peer() })
        const runs = Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: `R-${i}` }, 'u_maya')!.id))
        const ids = await Promise.all(runs)
        expect(new Set(ids).size).toBe(50)
        const storage = await reopen()
        const stored = (await storage.state.load('app_invoice'))!.state!
        const objs = Object.values(stored.objects)
        expect(objs).toHaveLength(50)
        expect(new Set(objs.map((o) => o.number)).size).toBe(50)
        for (const o of objs) {
          const log = await storage.events.read({ itemId: o.id, limit: 1000 })
          expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1))
        }
        await a.stop()
        await b.stop()
      })

      it('shows one replica’s change to the other’s subscribers', async () => {
        const a = await Runtime.create({ storage: await create() })
        const b = await Runtime.create({ storage: await peer() })
        const seen: string[][] = []
        b.subscribe((c) => seen.push(c.itemIds))
        const id = await a.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'SEEN' }, 'u_maya')!.id)
        await vi.waitFor(() => expect(seen.flat()).toContain(id))
        expect(await b.read('app_invoice', (sim) => !!sim.objects[id])).toBe(true)
        await a.stop()
        await b.stop()
      })

      it('count ten minutes of wall time once, whoever moves the clock', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          const a = await Runtime.create({ storage: await create(), timeScale: 2 })
          const b = await Runtime.create({ storage: await peer(), timeScale: 2 })
          await a.tick()
          const start = await a.read('app_invoice', (s) => s.clock)
          vi.setSystemTime(Date.now() + 5 * 60_000)
          await b.run('app_invoice', () => undefined)
          expect(await b.read('app_invoice', (s) => s.clock)).toBeCloseTo(start + 10)
          // a hears b's commit and takes its clock.
          await vi.waitFor(async () => expect(await a.read('app_invoice', (s) => s.clock)).toBeCloseTo(start + 10))
          vi.setSystemTime(Date.now() + 5 * 60_000)
          await a.tick()
          expect(await a.read('app_invoice', (s) => s.clock)).toBeCloseTo(start + 20)
          await a.stop()
          await b.stop()
        } finally {
          vi.useRealTimers()
        }
      })

      it('moves ticking to the other replica when the ticker stops', async () => {
        const sa = await create()
        const sb = await peer()
        const a = await Runtime.create({ storage: sa })
        const b = await Runtime.create({ storage: sb })
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          await a.tick()
          const ticked = (await sb.state.load('app_invoice'))!.version
          // Past the idle-tick window, so a tick by the clock's holder would commit: b's skips the application.
          vi.setSystemTime(Date.now() + 60_000)
          await b.tick()
          expect((await sb.state.load('app_invoice'))!.version).toBe(ticked)
          // Memory: stopping lets go of the clock. Postgres: closing the connection does (afterEach closes it again, a no-op).
          await a.stop()
          await sa.close?.()
          await b.tick()
          expect((await sb.state.load('app_invoice'))!.version).toBe(ticked + 1)
          await b.stop()
        } finally {
          vi.useRealTimers()
        }
      })
    })
  })
}
