import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { memoryStorage } from './adapters/memory'
import { buildServer } from './http'
import { Runtime } from './runtime'

// One invoice, end to end through the API: a person creates it, an ERP worker
// matches it, a clerk approves it, three workers run the parallel payment steps.

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

async function completeAll(serviceId: string, outputs: Record<string, unknown> = {}) {
  const polled = await api.inject({ method: 'POST', url: '/api/jobs/poll', payload: { serviceId, workerId: `${serviceId}-worker`, max: 10 } })
  const { jobs } = polled.json() as { jobs: Array<{ id: string }> }
  for (const j of jobs) {
    const done = await api.inject({ method: 'POST', url: `/api/jobs/${encodeURIComponent(j.id)}/complete`, payload: { outputs } })
    expect(done.statusCode).toBe(200)
  }
  return jobs.length
}

describe('the API runs the same engine live', () => {
  it('takes an invoice from creation to paid', async () => {
    const created = await api.inject({
      method: 'POST',
      url: '/api/apps/app_invoice/items',
      headers: as('u_maya'),
      payload: {
        workflowId: 'w_invoice',
        data: {
          f_invno: 'INV-API-1',
          f_vendor: 'l_vendors_0',
          f_lines: [{ id: 'row_1', c_desc: 'Toner cartridge', c_qty: 4, c_price: 105 }],
          f_dept: 'l_org_0',
          f_cc: 'l_org_1',
          f_invdate: '2026-09-28',
        },
      },
    })
    expect(created.statusCode).toBe(201)
    const item = created.json().value as { id: string; number: string }

    // Nobody outside the right groups may create invoices.
    const refused = await api.inject({ method: 'POST', url: '/api/apps/app_invoice/items', headers: as('u_carmen'), payload: { workflowId: 'w_invoice', data: {} } })
    expect(refused.statusCode).toBe(403)

    // The ERP worker matches the PO.
    expect(await completeAll('svc_erp', { matched: true })).toBe(1)

    // Load balanced to a clerk, who sees it in their basket and releases it.
    const got = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${item.id}`, headers: as('u_maya') })).json() as { branches: Array<{ assignee: string; workItemId: string }> }
    const clerk = got.branches[0]!.assignee
    const basket = (await api.inject({ method: 'GET', url: '/api/apps/app_invoice/my/basket', headers: as(clerk) })).json() as Array<{ id: string; outcomes: Array<{ id: string; label: string }> }>
    expect(basket).toHaveLength(1)
    const approve = basket[0]!.outcomes.find((o) => o.label === 'Approve')!

    // Field security is the engine's: the amount is locked once routed by amount.
    const locked = await api.inject({
      method: 'POST',
      url: `/api/apps/app_invoice/work/${encodeURIComponent(basket[0]!.id)}/save`,
      headers: as(clerk),
      payload: { patch: { f_lines: [{ id: 'row_1', c_desc: 'Toner cartridge', c_qty: 1, c_price: 1 }] } },
    })
    expect(locked.statusCode).toBe(409)

    const released = await api.inject({ method: 'POST', url: `/api/apps/app_invoice/work/${encodeURIComponent(basket[0]!.id)}/release`, headers: as(clerk), payload: { outcomeId: approve.id } })
    expect(released.json()).toEqual({ ok: true, value: true })

    // Three parallel branches: post to ERP, send remittance, archive.
    expect(await completeAll('svc_erp')).toBe(1)
    expect(await completeAll('svc_mail')).toBe(1)
    expect(await completeAll('svc_records')).toBe(1)
    await rt.tick()

    const done = (await api.inject({ method: 'GET', url: `/api/apps/app_invoice/items/${item.number}`, headers: as('u_maya') })).json() as { status: string; history: Array<{ kind: string }> }
    expect(done.status).toBe('completed')
    expect(done.history.filter((h) => h.kind === 'split' || h.kind === 'joined').length).toBeGreaterThanOrEqual(2)
  })

  it('needs an identity for personal routes', async () => {
    const r = await api.inject({ method: 'GET', url: '/api/apps/app_invoice/my/basket' })
    expect(r.statusCode).toBe(401)
  })
})
