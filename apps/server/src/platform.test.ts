import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { memoryStorage } from './adapters/memory'
import { buildServer } from './http'
import { Runtime } from './runtime'

// Search, supervision, expedite, readiness and the studio, through the API.

let rt: Runtime
let api: FastifyInstance

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  rt = await Runtime.create({ storage: memoryStorage() })
  api = buildServer(rt)
})

afterAll(async () => {
  await api.close()
  await rt.stop()
})

const as = (user: string) => ({ 'x-user-id': user })
const SECRET = 'ACCT-SECRET-9931'

interface Item {
  id: string
  number: string
  data: Record<string, unknown>
  fields: Array<{ id: string }>
  branches: Array<{ workItemId: string; stepId: string; assignee?: string }>
}

/** A small invoice from Maya, matched by the ERP worker and load balanced to an AP clerk. */
async function invoiceAtClerk(invno: string): Promise<{ item: Item; workItemId: string; clerk: string }> {
  const created = await api.inject({
    method: 'POST',
    url: '/api/apps/app_invoice/items',
    headers: as('u_maya'),
    payload: {
      workflowId: 'w_invoice',
      data: { f_invno: invno, f_vendor: 'l_vendors_0', f_lines: [{ id: 'row_1', c_desc: 'Toner cartridge', c_qty: 2, c_price: 50 }], f_dept: 'l_org_0', f_cc: 'l_org_1', f_bank: SECRET },
    },
  })
  expect(created.statusCode).toBe(201)
  const polled = (await api.inject({ method: 'POST', url: '/api/jobs/poll', payload: { serviceId: 'svc_erp', workerId: 'erp-test', max: 10 } })).json() as { jobs: Array<{ id: string }> }
  for (const j of polled.jobs) await api.inject({ method: 'POST', url: `/api/jobs/${encodeURIComponent(j.id)}/complete`, payload: { outputs: { matched: true } } })
  const item = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${created.json().value.id}`, headers: as('u_maya') })).json() as Item
  const at = item.branches.find((b) => b.stepId === 'n_clerk')!
  expect(at.assignee).toBeTruthy()
  return { item, workItemId: at.workItemId, clerk: at.assignee! }
}

const clerks = ['u_maya', 'u_jordan', 'u_aisha', 'u_tom', 'u_grace']
const otherClerk = (not: string) => clerks.find((c) => c !== not && c !== 'u_maya')!

describe('search', () => {
  it('finds items for people who may read them, and nobody else', async () => {
    const { item } = await invoiceAtClerk('SRCH-77')
    const found = await api.inject({ method: 'GET', url: `/api/apps/app_invoice/search?q=${item.number}`, headers: as('u_maya') })
    expect(found.statusCode).toBe(200)
    const body = found.json() as { total: number; hits: Array<Record<string, unknown>>; facets: Record<string, unknown> }
    expect(body.total).toBe(1)
    expect(body.hits[0]).toMatchObject({ number: item.number, status: 'active', priority: expect.any(String), expedited: false, where: expect.stringContaining('AP clerk review') })
    expect(body.hits[0]).toHaveProperty('due')
    expect(body.hits[0]).toHaveProperty('matches')
    expect(body.facets).toHaveProperty('step')

    // A patrol officer has no read permission on invoices: nothing at all.
    const officer = (await api.inject({ method: 'GET', url: '/api/apps/app_invoice/search?q=', headers: as('u_carmen') })).json() as { total: number }
    expect(officer.total).toBe(0)
    expect((await api.inject({ method: 'GET', url: '/api/apps/app_invoice/search?q=toner' })).statusCode).toBe(401)
    expect((await api.inject({ method: 'GET', url: '/api/apps/app_invoice/search?limit=0', headers: as('u_maya') })).statusCode).toBe(400)
  })

  it('never matches or returns fields hidden from the caller', async () => {
    const { item } = await invoiceAtClerk('SRCH-78')
    const clerk = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/search?q=${SECRET}`, headers: as('u_maya') })).json() as { total: number }
    expect(clerk.total).toBe(0)
    const controller = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/search?q=${SECRET}`, headers: as('u_victor') })).json() as { total: number }
    expect(controller.total).toBeGreaterThanOrEqual(1)

    const seenByClerk = await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${item.number}`, headers: as('u_maya') })
    expect(seenByClerk.body).not.toContain(SECRET)
    expect((seenByClerk.json() as Item).fields.some((f) => f.id === 'f_bank')).toBe(false)
    const seenByController = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${item.number}`, headers: as('u_victor') })).json() as Item
    expect(seenByController.data.f_bank).toBe(SECRET)

    // People who can't read the item at all don't learn it exists.
    expect((await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${item.number}`, headers: as('u_carmen') })).statusCode).toBe(404)
  })
})

describe('supervision', () => {
  it('lists what a person supervises', async () => {
    const { item } = await invoiceAtClerk('SUP-1')
    const carla = (await api.inject({ method: 'GET', url: '/api/apps/app_invoice/my/supervision', headers: as('u_carla') })).json() as {
      processes: Array<{ id: string }>
      steps: Array<{ stepId: string; items: Array<{ number: string }> }>
    }
    expect(carla.processes.map((p) => p.id)).toContain('w_invoice')
    expect(carla.steps.find((s) => s.stepId === 'n_clerk')!.items.map((i) => i.number)).toContain(item.number)
    const jordan = (await api.inject({ method: 'GET', url: '/api/apps/app_invoice/my/supervision', headers: as('u_jordan') })).json() as { steps: unknown[] }
    expect(jordan.steps).toEqual([])
  })

  it('refuses non-supervisors (403), reports engine refusals (409) and acts for supervisors (200)', async () => {
    const { workItemId, clerk } = await invoiceAtClerk('SUP-2')
    const url = (action: string) => `/api/apps/app_invoice/supervise/${encodeURIComponent(workItemId)}/${action}`
    const peer = otherClerk(clerk)

    expect((await api.inject({ method: 'POST', url: url('assign'), headers: as(peer), payload: { to: peer } })).statusCode).toBe(403)
    // A supervisor (not an administrator) may only reassign within the step's group.
    const outside = await api.inject({ method: 'POST', url: url('assign'), headers: as('u_carla'), payload: { to: 'u_marcus' } })
    expect(outside.statusCode).toBe(409)
    expect(outside.json().error).toMatch(/not in AP Clerks/)
    const moved = await api.inject({ method: 'POST', url: url('assign'), headers: as('u_carla'), payload: { to: peer } })
    expect(moved.json()).toEqual({ ok: true, value: true })
    const basket = (await api.inject({ method: 'GET', url: '/api/apps/app_invoice/my/basket', headers: as(peer) })).json() as Array<{ id: string }>
    expect(basket.map((b) => b.id)).toContain(workItemId)

    expect((await api.inject({ method: 'POST', url: url('return'), headers: as('u_carla') })).statusCode).toBe(200)
    expect((await api.inject({ method: 'POST', url: url('retry'), headers: as('u_carla') })).statusCode).toBe(409) // nothing to retry
    expect((await api.inject({ method: 'POST', url: '/api/apps/app_invoice/supervise/nope~1/assign', headers: as('u_carla'), payload: { to: peer } })).statusCode).toBe(404)
    expect((await api.inject({ method: 'POST', url: url('assign'), payload: { to: peer } })).statusCode).toBe(401)
  })

  it('redistributes a step for its supervisors only', async () => {
    const step = (id: string) => `/api/apps/app_invoice/supervise/steps/${id}/redistribute`
    const ok = await api.inject({ method: 'POST', url: step('n_clerk'), headers: as('u_carla') })
    expect(ok.statusCode).toBe(200)
    expect(typeof ok.json().value).toBe('number')
    expect((await api.inject({ method: 'POST', url: step('n_clerk'), headers: as('u_jordan') })).statusCode).toBe(403)
    expect((await api.inject({ method: 'POST', url: step('n_nope'), headers: as('u_carla') })).statusCode).toBe(404)
  })

  it('opens /admin routes to administrators and supervisors of the work only', async () => {
    const { workItemId, clerk } = await invoiceAtClerk('SUP-3')
    const url = `/api/apps/app_invoice/admin/work/${encodeURIComponent(workItemId)}/assign`
    expect((await api.inject({ method: 'POST', url, headers: as(otherClerk(clerk)), payload: { to: 'u_marcus' } })).statusCode).toBe(403)
    // Supervisors stay within the group even when they ask otherwise; administrators may go wider.
    expect((await api.inject({ method: 'POST', url, headers: as('u_carla'), payload: { to: 'u_marcus', sameGroupOnly: false } })).statusCode).toBe(409)
    expect((await api.inject({ method: 'POST', url, headers: as('u_avery'), payload: { to: 'u_marcus', sameGroupOnly: false } })).statusCode).toBe(200)
    const retry = `/api/apps/app_invoice/admin/work/${encodeURIComponent(workItemId)}/retry`
    expect((await api.inject({ method: 'POST', url: retry, headers: as('u_jordan') })).statusCode).toBe(403)
  })
})

describe('expedite', () => {
  it('follows the workflow’s policy: requester or supervisors, with a reason', async () => {
    const { item, clerk } = await invoiceAtClerk('EXP-1')
    const url = `/api/apps/app_invoice/items/${item.number}/expedite`
    const noReason = await api.inject({ method: 'POST', url, headers: as('u_maya'), payload: { on: true } })
    expect(noReason.statusCode).toBe(409)
    expect(noReason.json().error).toMatch(/Say why/)
    // The clerk holding it is neither the requester nor a supervisor.
    expect((await api.inject({ method: 'POST', url, headers: as(clerk), payload: { on: true, reason: 'Vendor called' } })).statusCode).toBe(403)
    expect((await api.inject({ method: 'POST', url, headers: as('u_carmen'), payload: { on: true, reason: 'x' } })).statusCode).toBe(404)

    expect((await api.inject({ method: 'POST', url, headers: as('u_maya'), payload: { on: true, reason: 'Early-payment discount ends Friday' } })).json()).toEqual({ ok: true, value: true })
    expect((await api.inject({ method: 'POST', url, headers: as('u_maya'), payload: { on: true, reason: 'again' } })).statusCode).toBe(409)
    const rush = (await api.inject({ method: 'GET', url: '/api/apps/app_invoice/search?q=is:expedited', headers: as('u_maya') })).json() as { hits: Array<{ number: string; expedited: boolean }> }
    expect(rush.hits.find((h) => h.number === item.number)?.expedited).toBe(true)

    // A process supervisor may take the flag off.
    expect((await api.inject({ method: 'POST', url, headers: as('u_victor'), payload: { on: false } })).statusCode).toBe(200)
  })
})

describe('health, readiness and the studio', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'modus-static-'))
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log("modus")')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('answers liveness and readiness, and turns not-ready while stopping', async () => {
    const own = await Runtime.create({ storage: memoryStorage() })
    const server = buildServer(own)
    expect((await server.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true, apps: 3 })
    expect((await server.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(200)
    await own.stop()
    expect((await server.inject({ method: 'GET', url: '/api/ready' })).statusCode).toBe(503)
    await server.close()
  })

  it('serves the built studio with a single-page fallback, keeping /api for the API', async () => {
    const server = buildServer(rt, { staticDir: dir })
    const home = await server.inject({ method: 'GET', url: '/' })
    expect(home.statusCode).toBe(200)
    expect(home.headers['content-type']).toMatch(/text\/html/)
    expect(home.body).toContain('id="root"')
    expect(home.headers['cache-control']).toBe('no-cache')

    const deep = await server.inject({ method: 'GET', url: '/workspace/basket?x=1' })
    expect(deep.statusCode).toBe(200)
    expect(deep.body).toContain('id="root"')

    const asset = await server.inject({ method: 'GET', url: '/assets/app-abc123.js' })
    expect(asset.statusCode).toBe(200)
    expect(asset.headers['cache-control']).toContain('immutable')
    expect((await server.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404)

    const unknownApi = await server.inject({ method: 'GET', url: '/api/nope' })
    expect(unknownApi.statusCode).toBe(404)
    expect(unknownApi.json()).toMatchObject({ ok: false })
    expect((await server.inject({ method: 'GET', url: '/api/apps' })).json()).toHaveLength(3)
    await server.close()
  })

  it('refuses a STATIC_DIR without a build, and serves no studio without one', async () => {
    expect(() => buildServer(rt, { staticDir: join(dir, 'assets') })).toThrow(/no index.html/)
    expect((await api.inject({ method: 'GET', url: '/' })).statusCode).toBe(404)
  })
})
