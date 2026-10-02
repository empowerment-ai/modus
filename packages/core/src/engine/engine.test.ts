import { describe, expect, it } from 'vitest'
import { optionsForField } from '../model/lists'
import { seedDesign } from '../model/seed'
import type { App, Distribution, Group, User, Workflow } from '../model/types'
import { adminAssign, adminMove, adminRedistribute, advance, computeView, createObject, newSim, openLoads, type Ctx } from './engine'

function people(n: number, prefix = 'u'): User[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `Person ${i}`, title: 'Clerk', color: '#000', speed: 1, available: true }))
}

/** start -> one user step -> end, with a single object type that has an Amount field. */
function oneStepCtx(distribution: Distribution, members = 10, extra: Partial<Workflow> = {}): Ctx {
  const users = people(members)
  const groups: Group[] = [{ id: 'g', name: 'Team', memberIds: users.map((u) => u.id), supervisorId: 'boss' }]
  users.push({ id: 'boss', name: 'Boss', title: 'Supervisor', color: '#000', speed: 1, available: true })
  const app: App = {
    id: 'a',
    name: 'Test',
    description: '',
    color: '#000',
    lists: [],
    objectTypes: [
      {
        id: 't',
        name: 'Thing',
        pluralName: 'Things',
        icon: 'file',
        color: '#000',
        numberPrefix: 'T-',
        permissions: {},
        fields: [{ id: 'amt', label: 'Amount', type: 'currency', width: 'half' }],
      },
    ],
    workflows: [
      {
        id: 'w',
        name: 'W',
        objectTypeId: 't',
        arrivalsPerHour: 0,
        nodes: [
          { id: 's', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
          {
            id: 'u',
            type: 'user',
            position: { x: 0, y: 0 },
            data: {
              label: 'Work',
              distribution,
              groupId: 'g',
              userId: 'u0',
              supervisorId: 'boss',
              autoDistribute: true,
              distributeEveryMinutes: 30,
              avgMinutes: 10_000, // nobody finishes during these tests
              outcomes: [{ id: 'ok', label: 'Done', weight: 1, actions: [] }],
              fieldAccess: {},
            },
          },
          { id: 'e', type: 'end', position: { x: 0, y: 0 }, data: { label: 'End', result: 'completed' } },
        ],
        edges: [
          { id: 'e1', source: 's', target: 'u', data: {} },
          { id: 'e2', source: 'u', target: 'e', data: { outcomeId: 'ok' } },
        ],
        ...extra,
      },
    ],
  }
  return { app, users, groups }
}

function seedCtx(appIndex = 0): Ctx {
  const d = seedDesign()
  return { app: d.apps[appIndex]!, users: d.users, groups: d.groups }
}

describe('routing on object metadata', () => {
  it('sends invoices to controller, manager or clerk by amount once the PO matches', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice')
    sim.arrivals = false
    const cases: Array<[number, string]> = [
      [25_000, 'n_controller'],
      [4_500, 'n_manager'],
      [350, 'n_clerk'],
    ]
    const objs = cases.map(([amount]) => createObject(sim, ctx, 'w_invoice', { f_amount: amount, f_po: 'PO-1' }, 'u_maya')!)
    // Capture step is automated; force its PO match to succeed by setting the result and letting it finish.
    ctx.app.workflows[0]!.nodes.forEach((n) => {
      if (n.type === 'auto' && n.id === 'n_capture') n.data.actions = [{ id: 'x', kind: 'setField', fieldId: 'f_pomatch', value: 'true' }]
    })
    advance(sim, ctx, 30)
    objs.forEach((o, i) => {
      const path = o.history.map((h) => h.nodeId)
      expect(path).toContain(cases[i]![1])
    })
  })

  it('routes unmatched invoices to the exception queue', () => {
    const ctx = seedCtx()
    ctx.app.workflows[0]!.nodes.forEach((n) => {
      if (n.type === 'auto' && n.id === 'n_capture') n.data.actions = [{ id: 'x', kind: 'setField', fieldId: 'f_pomatch', value: 'false' }]
    })
    const sim = newSim('app_invoice')
    sim.arrivals = false
    const o = createObject(sim, ctx, 'w_invoice', { f_amount: 500 }, 'u_maya')!
    advance(sim, ctx, 15)
    expect(o.history.some((h) => h.nodeId === 'n_exception')).toBe(true)
  })
})

describe('work distribution', () => {
  it('load balances evenly across a group of 10', () => {
    const ctx = oneStepCtx('load-balance', 10)
    const sim = newSim('a')
    sim.arrivals = false
    for (let i = 0; i < 53; i++) createObject(sim, ctx, 'w', {}, 'boss')
    const loads = [...openLoads(sim).values()]
    expect(loads).toHaveLength(10)
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1)
  })

  it('skips unavailable members when load balancing', () => {
    const ctx = oneStepCtx('load-balance', 4)
    ctx.users[0]!.available = false
    const sim = newSim('a')
    sim.arrivals = false
    for (let i = 0; i < 9; i++) createObject(sim, ctx, 'w', {}, 'boss')
    expect(openLoads(sim).get('u0')).toBeUndefined()
    expect([...openLoads(sim).values()]).toEqual([3, 3, 3])
  })

  it('leaves queue work unassigned until members fetch it', () => {
    const ctx = oneStepCtx('queue', 3)
    const sim = newSim('a')
    sim.arrivals = false
    for (let i = 0; i < 5; i++) createObject(sim, ctx, 'w', {}, 'boss')
    expect(computeView(sim, ctx).nodes.u!.unassigned).toBe(5)
    advance(sim, ctx, 1)
    const m = computeView(sim, ctx).nodes.u!
    expect(m.working).toBe(3)
    expect(m.unassigned).toBe(2)
    expect(Object.values(sim.objects).some((o) => o.history.some((h) => h.kind === 'fetched'))).toBe(true)
  })

  it('holds manager-distribution work until the supervisor hands it out', () => {
    const ctx = oneStepCtx('manager', 4)
    const sim = newSim('a')
    sim.arrivals = false
    for (let i = 0; i < 6; i++) createObject(sim, ctx, 'w', {}, 'boss')
    advance(sim, ctx, 20)
    expect(computeView(sim, ctx).nodes.u!.unassigned).toBe(6)
    advance(sim, ctx, 15)
    expect(computeView(sim, ctx).nodes.u!.unassigned).toBe(0)
    const assignedBySupervisor = Object.values(sim.objects).filter((o) => o.history.some((h) => h.kind === 'assigned' && h.actor === 'Boss'))
    expect(assignedBySupervisor).toHaveLength(6)
  })

  it('assigns direct steps to the named user', () => {
    const ctx = oneStepCtx('direct', 3)
    const sim = newSim('a')
    sim.arrivals = false
    createObject(sim, ctx, 'w', {}, 'boss')
    createObject(sim, ctx, 'w', {}, 'boss')
    expect(openLoads(sim).get('u0')).toBe(2)
  })
})

describe('administrator operations', () => {
  it('redistributes a piled-up basket evenly', () => {
    const ctx = oneStepCtx('manager', 5)
    const sim = newSim('a')
    sim.arrivals = false
    const objs = Array.from({ length: 20 }, () => createObject(sim, ctx, 'w', {}, 'boss')!)
    objs.forEach((o) => adminAssign(sim, ctx, o.id, 'u0'))
    expect(openLoads(sim).get('u0')).toBe(20)
    const moved = adminRedistribute(sim, ctx, 'u')
    expect(moved).toBeGreaterThan(0)
    expect([...openLoads(sim).values()].sort()).toEqual([4, 4, 4, 4, 4])
  })

  it('moves an object to another step and records who did it', () => {
    const ctx = oneStepCtx('queue', 2)
    const sim = newSim('a')
    sim.arrivals = false
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(adminMove(sim, ctx, o.id, 'e')).toBe(true)
    expect(o.status).toBe('completed')
    expect(o.history.some((h) => h.kind === 'moved' && h.actor === 'Administrator')).toBe(true)
  })
})

describe('model-driven changes', () => {
  it('parks work with no path as stuck, then resumes when the map is fixed', () => {
    const ctx = oneStepCtx('queue', 1)
    const wf = ctx.app.workflows[0]!
    // Replace start -> user with start -> decision that has no matching rule and no default.
    wf.nodes.push({ id: 'd', type: 'decision', position: { x: 0, y: 0 }, data: { label: 'Big?' } })
    wf.edges = [
      { id: 'e0', source: 's', target: 'd', data: {} },
      { id: 'e1', source: 'd', target: 'u', data: { order: 0, condition: { match: 'all', rules: [{ id: 'r', fieldId: 'amt', op: 'gt', value: 1000 }] } } },
      { id: 'e2', source: 'u', target: 'e', data: { outcomeId: 'ok' } },
    ]
    const sim = newSim('a')
    sim.arrivals = false
    const o = createObject(sim, ctx, 'w', { amt: 10 }, 'boss')!
    expect(o.state).toBe('stuck')
    expect(computeView(sim, ctx).stuck).toBe(1)
    wf.edges.push({ id: 'e3', source: 'd', target: 'e', data: { isDefault: true } })
    advance(sim, ctx, 1)
    expect(o.status).toBe('completed')
  })
})

describe('full simulation', () => {
  it('runs a working day of the invoice process and accounts for every object', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 7)
    advance(sim, ctx, 8 * 60)
    const v = computeView(sim, ctx)
    expect(sim.created).toBeGreaterThan(60)
    expect(sim.completed).toBeGreaterThan(20)
    expect(v.stuck).toBe(0)
    expect(sim.created).toBe(v.active + sim.completed + sim.rejected)
    // Every completed invoice that was approved has an approver recorded.
    const paid = Object.values(sim.objects).filter((o) => o.status === 'completed')
    expect(paid.every((o) => typeof o.data.f_approver === 'string' && typeof o.data.f_paydate === 'string')).toBe(true)
  })

  it('runs the fleet process with linked list values that are consistent', () => {
    const ctx = seedCtx(1)
    const sim = newSim('app_fleet', 3)
    advance(sim, ctx, 16 * 60)
    const list = ctx.app.lists.find((l) => l.id === 'l_vehicles')!
    const type = ctx.app.objectTypes[0]!
    const objs = Object.values(sim.objects)
    expect(objs.length).toBeGreaterThan(10)
    for (const o of objs) {
      const make = list.items.find((i) => i.id === o.data.v_make)!
      const model = list.items.find((i) => i.id === o.data.v_model)!
      expect(make.parentId).toBe(o.data.v_year)
      expect(model.parentId).toBe(o.data.v_make)
    }
    const yearField = type.fields.find((f) => f.id === 'v_make')!
    expect(optionsForField(yearField, list, { v_year: 'l_vehicles_0' }).map((i) => i.label)).toEqual(['Ford', 'Toyota', 'Chevrolet'])
  })
})
