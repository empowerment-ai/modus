import { activeTokens, completeJob, type Ctx, createObject, newSim, pollJobs } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { describe, expect, it } from 'vitest'
import { loadDesign } from './design'

describe('loadDesign', () => {
  it('adds the clerks with zero-padded ids and names', () => {
    const d = loadDesign(12)
    const added = d.users.filter((u) => u.id.startsWith('u_load_'))
    expect(added).toHaveLength(12)
    expect(added[0]).toMatchObject({ id: 'u_load_0001', name: 'Load Clerk 0001', title: 'AP Clerk', available: true })
    expect(added.at(-1)!.id).toBe('u_load_0012')
    expect(d.users).toHaveLength(seedDesign().users.length + 12)
  })

  it('makes them AP clerks', () => {
    const clerks = loadDesign(3).groups.find((g) => g.id === 'g_clerks')!
    expect(clerks.memberIds.slice(-3)).toEqual(['u_load_0001', 'u_load_0002', 'u_load_0003'])
    expect(clerks.memberIds).toContain('u_maya')
  })

  it('leaves the design it starts from alone', () => {
    const base = seedDesign()
    const before = structuredClone(base)
    loadDesign(5, base)
    expect(base).toEqual(before)
  })

  it('still runs live, load balancing invoices onto generated clerks', () => {
    const d = loadDesign(5)
    const ctx: Ctx = { app: d.apps.find((a) => a.id === 'app_invoice')!, users: d.users, groups: d.groups, services: d.services, live: true }
    const sim = newSim('app_invoice')
    const data = { f_invno: '', f_vendor: 'l_vendors_0', f_lines: [{ id: 'row_1', c_desc: 'Toner', c_qty: 4, c_price: 105 }], f_dept: 'l_org_0', f_cc: 'l_org_1', f_invdate: '2026-09-28' }
    for (let i = 0; i < 30; i++) createObject(sim, ctx, 'w_invoice', { ...data, f_invno: `LOAD-${i}` }, 'u_maya')
    // The ERP worker matches each purchase order; the clerk step follows.
    for (const j of pollJobs(sim, ctx, 'svc_erp', 'test-worker', 100)) completeJob(sim, ctx, j.id, { matched: true })
    const assignees = activeTokens(sim)
      .filter((t) => t.nodeId === 'n_clerk' && t.userId)
      .map((t) => t.userId!)
    expect(assignees.length).toBeGreaterThan(0)
    expect(assignees.some((u) => u.startsWith('u_load_'))).toBe(true)
  })
})
