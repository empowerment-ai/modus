import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { memoryStorage } from './adapters/memory'
import { buildServer } from './http'
import { Runtime } from './runtime'

// The published design and the administrator's Monitor, through the API.

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
