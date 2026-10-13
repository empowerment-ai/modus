import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { memoryStorage } from './adapters/memory'
import { advance, type ExplorerCache } from '@modus-bpm/core'
import { buildServer } from './http'
import { Runtime } from './runtime'

// The published design and the administrator's Monitor, through the API.

let rt: Runtime
let api: FastifyInstance
const explorerCaches = new Map<string, ExplorerCache>()

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  rt = await Runtime.create({ storage: memoryStorage() })
  api = buildServer(rt, { explorerCaches })
})

afterAll(async () => {
  await api.close()
  await rt.stop()
})

const as = (user: string) => ({ 'x-user-id': user })
const ADMIN = 'u_avery'

interface Monitor {
  clock: number
  view: { active: number; created: number; expedited: number; nodes: Record<string, { total: number }>; services: Record<string, unknown>; users: Record<string, { open: number }> }
  expeditedByStep: Record<string, number>
  working: Record<string, { itemId: string; number: string; stepId: string; startedAt?: number; also: number }>
}

/** A new invoice from Maya, matched by the ERP worker and waiting with an AP clerk. */
async function invoiceAtClerk(invno: string) {
  const created = await api.inject({
    method: 'POST',
    url: '/api/apps/app_invoice/items',
    headers: as('u_maya'),
    payload: { workflowId: 'w_invoice', data: { f_invno: invno, f_vendor: 'l_vendors_0', f_lines: [{ id: 'row_1', c_desc: 'Toner', c_qty: 2, c_price: 50 }], f_dept: 'l_org_0', f_cc: 'l_org_1' } },
  })
  expect(created.statusCode).toBe(201)
  const polled = (await api.inject({ method: 'POST', url: '/api/jobs/poll', payload: { serviceId: 'svc_erp', workerId: 'erp-test', max: 10 } })).json() as { jobs: Array<{ id: string }> }
  for (const j of polled.jobs) await api.inject({ method: 'POST', url: `/api/jobs/${encodeURIComponent(j.id)}/complete`, payload: { outputs: { matched: true } } })
  const item = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${created.json().value.id}`, headers: as('u_maya') })).json() as { id: string; number: string; branches: Array<{ workItemId: string; stepId: string; assignee?: string }> }
  const at = item.branches.find((b) => b.stepId === 'n_clerk')!
  expect(at.assignee).toBeTruthy()
  return { item, workItemId: at.workItemId, clerk: at.assignee! }
}

describe('GET /api/design', () => {
  it('returns the published design to any named user', async () => {
    expect((await api.inject({ method: 'GET', url: '/api/design' })).statusCode).toBe(401)
    // Connection details stay on the server, even where the design has them all.
    const svc = rt.design.services[0]!
    const saved = { ...svc }
    Object.assign(svc, { secretRef: 'erp-api-key', auth: 'api-key', owner: 'ERP team' })
    const res = await api.inject({ method: 'GET', url: '/api/design', headers: as('u_maya') }).finally(() => {
      for (const k of ['secretRef', 'auth', 'owner'] as const) delete svc[k]
      Object.assign(svc, saved)
    })
    expect(res.statusCode).toBe(200)
    const design = res.json() as { apps: unknown[]; users: unknown[]; services: Array<Record<string, unknown>> }
    expect(design.apps.length).toBe(rt.design.apps.length)
    expect(design.users.length).toBe(rt.design.users.length)
    expect(svc.endpoint).toBeTruthy()
    expect(design.services.map((s) => s.id)).toEqual(rt.design.services.map((s) => s.id))
    for (const s of design.services) for (const k of ['endpoint', 'secretRef', 'auth', 'owner']) expect(s).not.toHaveProperty(k)
    expect(design.services[0]).toMatchObject({ name: expect.any(String), operations: expect.any(Array) })
  })
})

describe('GET /api/apps/:app/monitor', () => {
  const url = '/api/apps/app_invoice/monitor'

  it('is for administrators only', async () => {
    expect((await api.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect((await api.inject({ method: 'GET', url, headers: as('u_maya') })).statusCode).toBe(403)
    expect((await api.inject({ method: 'GET', url: '/api/apps/nope/monitor', headers: as(ADMIN) })).statusCode).toBe(404)
  })

  it('returns the view the studio computes: KPIs, steps, services and people', async () => {
    await invoiceAtClerk('MON-1')
    const res = await api.inject({ method: 'GET', url, headers: as(ADMIN) })
    expect(res.statusCode).toBe(200)
    const m = res.json() as Monitor
    expect(m.clock).toEqual(expect.any(Number))
    expect(m.view).toMatchObject({ clock: m.clock, active: expect.any(Number), completed: expect.any(Number), overdue: expect.any(Number), expedited: expect.any(Number) })
    expect(m.view.active).toBeGreaterThan(0)
    expect(m.view.nodes.n_clerk!.total).toBeGreaterThan(0)
    expect(m.view.services.svc_erp).toMatchObject({ calls: expect.any(Number) })
    expect(m.view.users.u_maya).toMatchObject({ open: expect.any(Number) })
  })

  it('counts expedited items per step and says who is working on what', async () => {
    const { item, workItemId, clerk } = await invoiceAtClerk('MON-2')
    expect((await api.inject({ method: 'POST', url: `/api/apps/app_invoice/items/${item.number}/expedite`, headers: as('u_maya'), payload: { on: true, reason: 'Discount ends Friday' } })).statusCode).toBe(200)
    expect((await api.inject({ method: 'POST', url: `/api/apps/app_invoice/work/${encodeURIComponent(workItemId)}/start`, headers: as(clerk) })).statusCode).toBe(200)

    const m = (await api.inject({ method: 'GET', url, headers: as(ADMIN) })).json() as Monitor
    expect(m.view.expedited).toBeGreaterThanOrEqual(1)
    expect(m.expeditedByStep.n_clerk).toBeGreaterThanOrEqual(1)
    expect(m.working[clerk]).toMatchObject({ itemId: item.id, number: item.number, stepId: 'n_clerk', startedAt: expect.any(Number), also: expect.any(Number) })
  })
})

describe('GET /api/apps/:app/monitor/series, /feed, /items', () => {
  const base = '/api/apps/app_invoice/monitor'
  const get = (path: string, user = ADMIN) => api.inject({ method: 'GET', url: `${base}${path}`, headers: as(user) })

  it('are for administrators only, validate their query, and 404 an unknown app', async () => {
    for (const path of ['/series', '/feed', '/items']) {
      expect((await api.inject({ method: 'GET', url: `${base}${path}` })).statusCode).toBe(401)
      expect((await get(path, 'u_maya')).statusCode).toBe(403)
      expect((await api.inject({ method: 'GET', url: `/api/apps/nope/monitor${path}`, headers: as(ADMIN) })).statusCode).toBe(404)
      expect((await get(path)).statusCode).toBe(200)
    }
    for (const bad of ['/series?since=soon', '/series?since=', '/feed?limit=0', '/feed?limit=301', '/items?limit=201', '/items?status=lost', '/items?cursor=nonsense', `/items?cursor=${Buffer.from('[1,2]').toString('base64url')}`]) expect((await get(bad)).statusCode, bad).toBe(400)
  })

  it('series: work in flight over time, incrementally', async () => {
    await invoiceAtClerk('SER-1')
    await rt.run('app_invoice', (sim, ctx) => advance(sim, ctx, 60))
    const all = (await get('/series')).json() as { points: Array<{ t: number; wip: number; done: number }> }
    expect(all.points.length).toBeGreaterThan(1)
    expect(all.points.at(-1)).toMatchObject({ t: expect.any(Number), wip: expect.any(Number), done: expect.any(Number) })
    const since = all.points.at(-2)!.t
    const later = (await get(`/series?since=${since}`)).json() as typeof all
    expect(later.points).toEqual(all.points.filter((p) => p.t > since))
    expect(later.points.length).toBeGreaterThan(0)
    expect(((await get(`/series?since=${all.points.at(-1)!.t}`)).json() as typeof all).points).toEqual([])
  })

  it('feed: newest first, limited', async () => {
    await invoiceAtClerk('FEED-1')
    const { entries } = (await get('/feed')).json() as { entries: Array<{ at: number; number: string; kind: string; text: string }> }
    expect(entries.length).toBeGreaterThan(2)
    expect(entries.length).toBeLessThanOrEqual(100)
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1]!.at).toBeGreaterThanOrEqual(entries[i]!.at)
    expect(entries[0]).toEqual(await rt.read('app_invoice', (sim) => sim.feed[0]))
    expect(((await get('/feed?limit=2')).json() as { entries: unknown[] }).entries).toEqual(entries.slice(0, 2))
  })

  interface Row { id: string; number: string; typeId: string; title: string; summary: Record<string, string>; status: string; state: string; stepId?: string; step?: string; more: number; assignee?: string; createdAt: number; age: number }
  interface Page { items: Row[]; total: number; next?: string }
  const items = async (query = '') => {
    const res = await get(`/items${query}`)
    expect(res.statusCode).toBe(200)
    return res.json() as Page
  }

  it('items: rows the explorer shows, newest first, filtered like the explorer', async () => {
    const { item, clerk } = await invoiceAtClerk('EXP-NEEDLE-7')
    const all = await items('?limit=200')
    expect(all.items[0]).toMatchObject({ id: item.id, number: item.number, typeId: expect.any(String), title: expect.any(String), status: 'active', stepId: 'n_clerk', step: expect.any(String), assignee: clerk, age: expect.any(Number) })
    expect(all.items[0]).not.toHaveProperty('history')
    for (let i = 1; i < all.items.length; i++) expect(all.items[i - 1]!.createdAt).toBeGreaterThanOrEqual(all.items[i]!.createdAt)
    expect(all.total).toBe(await rt.read('app_invoice', (sim) => Object.keys(sim.objects).length))

    expect((await items('?q=exp-needle-7')).items.map((r) => r.id)).toEqual([item.id])
    expect((await items('?q=no-such-text-anywhere')).items).toEqual([])
    const atClerk = await items('?step=n_clerk&limit=200')
    expect(atClerk.items.map((r) => r.id)).toContain(item.id)
    const clerkIds = await rt.read('app_invoice', (sim) => Object.values(sim.objects).filter((o) => o.tokens.some((t) => t.nodeId === 'n_clerk')).map((o) => o.id))
    expect(atClerk.items.map((r) => r.id).sort()).toEqual(clerkIds.sort())
    const theirs = await items(`?assignee=${clerk}&limit=200`)
    expect(theirs.items.map((r) => r.id)).toContain(item.id)
    expect(theirs.items.every((r) => r.assignee === clerk)).toBe(true)
    expect((await items('?status=completed')).items.map((r) => r.id)).not.toContain(item.id)
    expect((await items('?status=active&limit=200')).items.every((r) => r.status === 'active')).toBe(true)
    expect((await items('?type=nope')).items).toEqual([])
    expect((await items(`?type=${all.items[0]!.typeId}`)).total).toBe(all.total)
  })

  it('items: pages without duplicates or gaps, even while items arrive', async () => {
    for (let i = 0; i < 5; i++) await invoiceAtClerk(`PAGE-${i}`)
    const before = (await items('?limit=200')).items.map((r) => r.id)
    const seen: string[] = []
    let page = await items('?limit=3')
    seen.push(...page.items.map((r) => r.id))
    // A new item between pages comes first in a fresh read, never in a later page.
    const { item: late } = await invoiceAtClerk('PAGE-LATE')
    while (page.next) {
      page = await items(`?limit=3&cursor=${encodeURIComponent(page.next)}`)
      seen.push(...page.items.map((r) => r.id))
    }
    expect(seen).toEqual(before)
    expect(seen).not.toContain(late.id)
    expect((await items('?limit=1')).items[0]!.id).toBe(late.id)
  })

  it('items: a well-formed cursor from elsewhere pages from where it sorts', async () => {
    const all = await items('?limit=200')
    const cur = (createdAt: number) => encodeURIComponent(Buffer.from(JSON.stringify([createdAt, 'X', 'x'])).toString('base64url'))
    // Later than everything: the first page. Earlier than everything: nothing.
    expect((await items(`?limit=200&cursor=${cur(1e12)}`)).items.map((r) => r.id)).toEqual(all.items.map((r) => r.id))
    const none = await items(`?cursor=${cur(-1)}`)
    expect(none.items).toEqual([])
    expect(none.next).toBeUndefined()
    expect(none.total).toBe(all.total)
  })

  it('items: rejected includes cancelled', async () => {
    const { workItemId, clerk } = await invoiceAtClerk('REJ-1')
    const released = await api.inject({ method: 'POST', url: `/api/apps/app_invoice/work/${encodeURIComponent(workItemId)}/release`, headers: as(clerk), payload: { outcomeId: 'o_k_no', comment: 'Duplicate' } })
    expect(released.statusCode, released.body).toBe(200)
    const { item: cancelled } = await invoiceAtClerk('CAN-1')
    // No API cancels an item yet; finish it as cancelled the way the engine records it.
    await rt.run('app_invoice', (sim) => Object.assign(sim.objects[cancelled.id]!, { status: 'cancelled', tokens: [], completedAt: sim.clock }))
    const rejected = await items('?status=rejected&limit=200')
    const statuses = await rt.read('app_invoice', (sim) => Object.values(sim.objects).filter((o) => o.status === 'rejected' || o.status === 'cancelled').map((o) => o.id))
    expect(rejected.items.map((r) => r.id).sort()).toEqual(statuses.sort())
    expect(rejected.items.find((r) => r.id === cancelled.id)).toMatchObject({ status: 'cancelled', state: 'cancelled' })
    expect(rejected.items.some((r) => r.status === 'rejected')).toBe(true)
  })

  it('items: search text is cached across commits, rebuilt only for what changed', async () => {
    await items('?q=warm-up')
    const cache = explorerCaches.get('app_invoice')!
    const n = await rt.read('app_invoice', (sim) => Object.keys(sim.objects).length)
    expect(cache.entries.size).toBe(n)
    const built = cache.builds
    await items('?q=warm-up')
    expect(cache.builds).toBe(built)
    // A commit copies the state; only the new item (and the ones its commit touched) are formatted again.
    await invoiceAtClerk('CACHE-1')
    expect((await items('?q=cache-1')).items).toHaveLength(1)
    expect(cache.builds - built).toBeGreaterThan(0)
    expect(cache.builds - built).toBeLessThan(5)
  })
})
