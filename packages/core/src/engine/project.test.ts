import { describe, expect, it } from 'vitest'
import { seedDesign } from '../model/seed'
import { advance, completeJob, createObject, type Ctx, failJob, newSim, pollJobs } from './engine'
import { projectItem } from './project'

function live(): Ctx {
  const d = seedDesign()
  return { app: d.apps[0]!, users: d.users, groups: d.groups, services: d.services, live: true }
}

describe('projectItem', () => {
  it('maps an item and its service-bound token', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-1' }, 'u_maya')!
    const p = projectItem(sim, ctx, o.id)!
    expect(p.item).toMatchObject({ itemId: o.id, number: o.number, status: 'active', priority: o.priority, expedited: false, createdAt: o.createdAt, data: o.data })
    expect(p.item.endedAt).toBeUndefined()
    expect(p.workItems).toHaveLength(1)
    expect(p.workItems[0]).toMatchObject({ tokenId: o.tokens[0]!.id, itemId: o.id, stepId: 'n_capture', state: 'auto', serviceId: 'svc_erp', priority: o.priority })
  })

  it('gives people steps their group, assignee and due time', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-2', f_lines: [{ id: 'row_1', c_desc: 'Consulting hours', c_qty: 1, c_price: 420 }], f_po: 'PO-9' }, 'u_maya')!
    // A worker matches the PO, so a small invoice goes on to AP clerk review (a 24-hour step for g_clerks).
    const [job] = pollJobs(sim, ctx, 'svc_erp', 'w1')
    completeJob(sim, ctx, job!.id, { matched: true })
    const t = o.tokens[0]!
    expect(t.nodeId).toBe('n_clerk')
    const [w] = projectItem(sim, ctx, o.id)!.workItems
    expect(w).toMatchObject({ tokenId: t.id, stepId: 'n_clerk', state: 'assigned', groupId: 'g_clerks', assignee: t.userId, enteredAt: t.enteredAt })
    expect(w!.assignee).toBeDefined()
    expect(w!.serviceId).toBeUndefined()
    expect(w!.dueAt).toBeLessThanOrEqual(t.enteredAt + 24 * 60)
  })

  it('gives a failed job handed to people its fallback group', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-4' }, 'u_maya')!
    // Retries run out, so the automated step falls back to people (AP Exceptions).
    for (let i = 0; i < 2; i++) failJob(sim, ctx, pollJobs(sim, ctx, 'svc_erp', 'w1')[0]!.id, 'timed out')
    const t = o.tokens[0]!
    expect(t.manual).toBe(true)
    const [w] = projectItem(sim, ctx, o.id)!.workItems
    expect(w).toMatchObject({ stepId: 'n_capture', state: 'assigned', assignee: t.userId })
    expect(w!.groupId).toBeDefined()
  })

  it('gives a job waiting for a worker no group', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-5' }, 'u_maya')!
    advance(sim, ctx, 1)
    expect(projectItem(sim, ctx, o.id)!.workItems[0]!.groupId).toBeUndefined()
  })

  it('has no work items once the item has ended, and an end time', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-3' }, 'u_maya')!
    o.status = 'cancelled'
    o.completedAt = 12
    o.tokens = []
    const p = projectItem(sim, ctx, o.id)!
    expect(p.item).toMatchObject({ status: 'cancelled', endedAt: 12 })
    expect(p.workItems).toEqual([])
  })

  it('is undefined for an unknown item', () => {
    expect(projectItem(newSim('app_invoice'), live(), 'nope')).toBeUndefined()
  })
})
