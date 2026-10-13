import { describe, expect, it } from 'vitest'
import { seedDesign } from '../model/seed'
import { advance, completeJob, createObject, type Ctx, failJob, newSim, pollJobs } from './engine'
import { adminCancel } from './ops'
import { changesBetween, projectItem } from './project'

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

describe('changesBetween', () => {
  it('reports a new item’s entries, the item as touched, and its job as ready', () => {
    const ctx = live()
    const before = newSim('app_invoice')
    const after = structuredClone(before)
    const o = createObject(after, ctx, 'w_invoice', { f_invno: 'C-1' }, 'u_maya')!
    const c = changesBetween(before, after)
    expect(c.itemIds).toEqual([o.id])
    expect(c.entries).toEqual([{ itemId: o.id, itemNumber: o.number, entries: o.history }])
    expect(c.outbox).toEqual([{ itemId: o.id, kind: 'job.ready', payload: { tokenId: o.tokens[0]!.id, serviceId: 'svc_erp', nodeId: 'n_capture', attempt: 1 } }])
  })

  it('reports only what changed, and a retry as a new job', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'C-2' }, 'u_maya')!
    createObject(sim, ctx, 'w_invoice', { f_invno: 'C-3' }, 'u_maya')
    const [job] = pollJobs(sim, ctx, 'svc_erp', 'w1')
    const before = structuredClone(sim)
    failJob(sim, ctx, job!.id, 'timed out')
    const c = changesBetween(before, sim)
    expect(c.itemIds).toEqual([o.id])
    expect(c.entries[0]!.entries).toEqual(o.history.slice(before.objects[o.id]!.history.length))
    expect(c.outbox).toEqual([expect.objectContaining({ kind: 'job.ready', payload: expect.objectContaining({ attempt: 2 }) })])
  })

  it('turns notify and escalated entries into notify messages', () => {
    const before = newSim('app_invoice')
    const ctx = live()
    createObject(before, ctx, 'w_invoice', { f_invno: 'C-4' }, 'u_maya')
    const after = structuredClone(before)
    const o = Object.values(after.objects)[0]!
    o.history.push({ at: 5, kind: 'notify', nodeId: 'n_x', text: 'Email to someone' }, { at: 6, kind: 'escalated', nodeId: 'n_x', tokenId: 't1', text: 'Escalated' })
    const c = changesBetween(before, after)
    expect(c.outbox).toEqual([
      { itemId: o.id, kind: 'notify', payload: { at: 5, kind: 'notify', nodeId: 'n_x', text: 'Email to someone' } },
      { itemId: o.id, kind: 'notify', payload: { at: 6, kind: 'escalated', nodeId: 'n_x', tokenId: 't1', text: 'Escalated' } },
    ])
  })

  it('reports a job at the next service step when one call leads straight into another', () => {
    const ctx = live()
    // Rewire the invoice map so the ERP match leads straight into Post to ERP (also svc_erp).
    const wf = ctx.app.workflows.find((w) => w.id === 'w_invoice')!
    wf.edges = wf.edges.map((e) => (e.id === 'e_2' ? { ...e, target: 'n_post' } : e))
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'C-6' }, 'u_maya')!
    const [job] = pollJobs(sim, ctx, 'svc_erp', 'w1')
    const before = structuredClone(sim)
    expect(completeJob(sim, ctx, job!.id, { matched: true })).toBe(true)
    const t = o.tokens[0]!
    expect(t).toMatchObject({ nodeId: 'n_post', state: 'auto', serviceId: 'svc_erp' })
    expect(changesBetween(before, sim).outbox).toEqual([{ itemId: o.id, kind: 'job.ready', payload: { tokenId: t.id, serviceId: 'svc_erp', nodeId: 'n_post', attempt: 1 } }])
  })

  it('touches an item that finished in the command and projects it as ended', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'C-7' }, 'u_maya')!
    const before = structuredClone(sim)
    expect(adminCancel(sim, ctx, o.id, 'Duplicate')).toMatchObject({ ok: true })
    expect(sim.activeIds).not.toContain(o.id)
    expect(changesBetween(before, sim).itemIds).toEqual([o.id])
    const p = projectItem(sim, ctx, o.id)!
    expect(p.item.status).not.toBe('active')
    expect(p.item.endedAt).toBe(sim.clock)
    expect(p.workItems).toEqual([])
  })

  it('counts a token that moved without an audit entry as a touch', () => {
    const ctx = live()
    const before = newSim('app_invoice')
    const o = createObject(before, ctx, 'w_invoice', { f_invno: 'C-5' }, 'u_maya')!
    const after = structuredClone(before)
    after.objects[o.id]!.tokens[0]!.state = 'queued'
    expect(changesBetween(before, after).itemIds).toEqual([o.id])
    expect(changesBetween(before, structuredClone(before)).itemIds).toEqual([])
  })
})
