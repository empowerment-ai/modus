import { describe, expect, it } from 'vitest'
import { optionsForField } from '../model/lists'
import { seedDesign } from '../model/seed'
import { expandToSubflow, instantiateTemplate, suggestBinding } from '../model/templates'
import type { App, Distribution, Group, ServiceDef, User, WfEdge, WfNode, Workflow } from '../model/types'
import { activeTokens, advance, burst, createObject, type Ctx, newSim, openLoads, sstat } from './engine'
import {
  adminAssign,
  adminMove,
  adminRedistribute,
  adminRelease,
  canCreate,
  workClaim,
  workDelegate,
  workDistribute,
  workNext,
  workRelease,
  workSave,
} from './ops'
import { runScenario } from './scenario'
import { basketOf, computeView, distributionFor, queuesFor } from './view'

// ---------- Builders ----------

function people(n: number, prefix = 'u'): User[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `Person ${i}`, title: 'Clerk', color: '#000', speed: 1, available: true }))
}

const at = { x: 0, y: 0 }

function userStep(id: string, distribution: Distribution, extra: Partial<Extract<WfNode, { type: 'user' }>['data']> = {}): WfNode {
  return {
    id,
    type: 'user',
    position: at,
    data: {
      label: id,
      distribution,
      groupId: 'g',
      userId: 'u0',
      supervisorId: 'boss',
      autoDistribute: true,
      distributeEveryMinutes: 30,
      avgMinutes: 10_000, // nobody finishes unless a test says so
      outcomes: [{ id: 'ok', label: 'Done', weight: 1, actions: [] }],
      fieldAccess: {},
      ...extra,
    },
  }
}

function autoStep(id: string, avgMinutes: number, extra: Partial<Extract<WfNode, { type: 'auto' }>['data']> = {}): WfNode {
  return { id, type: 'auto', position: at, data: { label: id, avgMinutes, actions: [], ...extra } }
}

const start: WfNode = { id: 's', type: 'start', position: at, data: { label: 'Start' } }
const end = (id = 'e', result: 'completed' | 'rejected' | 'cancelled' = 'completed', extra = {}): WfNode => ({ id, type: 'end', position: at, data: { label: id, result, ...extra } })
const edge = (source: string, target: string, data: WfEdge['data'] = {}): WfEdge => ({ id: `${source}-${target}-${data.outcomeId ?? ''}`, source, target, data })

/** A small app with one object type (Amount, Approver, Priority, Notes, Secret) and the given workflows. */
function ctxWith(workflows: Workflow[], opts: { members?: number; services?: ServiceDef[]; groups?: Group[]; manual?: string[] } = {}): Ctx {
  const users = people(opts.members ?? 4)
  users.push({ id: 'boss', name: 'Boss', title: 'Supervisor', color: '#000', speed: 1, available: true })
  users.push({ id: 'disp', name: 'Dispatcher', title: 'Dispatcher', color: '#000', speed: 1, available: true })
  users.push({ id: 'out', name: 'Outsider', title: 'Other team', color: '#000', speed: 1, available: true })
  const groups: Group[] = opts.groups ?? [
    { id: 'g', name: 'Team', memberIds: users.filter((u) => u.id.startsWith('u')).map((u) => u.id), supervisorId: 'boss' },
    { id: 'dg', name: 'Dispatch', kind: 'distribution', memberIds: ['disp'] },
    { id: 'other', name: 'Other', memberIds: ['out'] },
  ]
  const app: App = {
    id: 'a',
    name: 'Test',
    description: '',
    color: '#000',
    lists: [{ id: 'pri', name: 'Priority', levels: ['Priority'], items: ['Low', 'Normal', 'Urgent'].map((label, i) => ({ id: `pri_${i}`, label, parentId: null })) }],
    objectTypes: [
      {
        id: 't',
        name: 'Thing',
        pluralName: 'Things',
        icon: 'file',
        color: '#000',
        numberPrefix: 'T-',
        priorityFieldId: 'pri',
        permissions: { g: { create: true, read: true, update: true, delete: false } },
        fields: [
          { id: 'amt', label: 'Amount', type: 'currency', width: 'half' },
          { id: 'who', label: 'Owner', type: 'user', width: 'half' },
          { id: 'pri', label: 'Priority', type: 'choice', listId: 'pri', level: 0, width: 'half' },
          { id: 'ok', label: 'Matched', type: 'boolean', width: 'half', system: true },
          { id: 'notes', label: 'Notes', type: 'textarea', width: 'full', required: true },
          { id: 'secret', label: 'Secret', type: 'text', width: 'half', restrictedTo: ['other'] },
        ],
      },
    ],
    workflows,
  }
  return { app, users, groups, services: opts.services ?? [], manualUserIds: opts.manual }
}

function wf(nodes: WfNode[], edges: WfEdge[], extra: Partial<Workflow> = {}): Workflow {
  return { id: 'w', name: 'W', kind: 'process', objectTypeId: 't', arrivalsPerHour: 0, nodes, edges, ...extra }
}

function oneStepCtx(distribution: Distribution, members = 10): Ctx {
  return ctxWith([wf([start, userStep('u', distribution), end()], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })])], { members })
}

function seedCtx(appIndex = 0): Ctx {
  const d = seedDesign()
  return { app: d.apps[appIndex]!, users: d.users, groups: d.groups, services: d.services }
}

function quiet(appId: string, seed?: number) {
  const sim = newSim(appId, seed)
  sim.arrivals = false
  return sim
}

const svc = (id: string, extra: Partial<ServiceDef> = {}, op: Partial<ServiceDef['operations'][number]> = {}): ServiceDef => ({
  id,
  name: id,
  kind: 'worker',
  endpoint: `topic: ${id}`,
  status: 'online',
  operations: [{ id: `${id}_op`, name: 'run', avgMinutes: 5, successRate: 1, outputs: [{ key: 'matched', label: 'Matched', type: 'boolean', trueRate: 1 }], ...op }],
  ...extra,
})

// ---------- Routing on metadata (sample app) ----------

describe('routing on object metadata', () => {
  function invoiceCtx(matched: boolean): Ctx {
    const ctx = seedCtx()
    const erp = ctx.services!.find((s) => s.id === 'svc_erp')!
    erp.operations.forEach((o) => {
      o.successRate = 1
      o.outputs.forEach((x) => (x.trueRate = matched ? 1 : 0))
    })
    return ctx
  }

  it('sends invoices to controller, manager or clerk by amount once the PO matches', () => {
    const ctx = invoiceCtx(true)
    const sim = quiet('app_invoice')
    const cases: Array<[number, string]> = [
      [25_000, 'n_controller'],
      [4_500, 'n_manager'],
      [350, 'n_clerk'],
    ]
    const objs = cases.map(([amount]) => createObject(sim, ctx, 'w_invoice', { f_amount: amount, f_po: 'PO-1' }, 'u_maya')!)
    advance(sim, ctx, 30)
    objs.forEach((o, i) => expect(o.history.map((h) => h.nodeId)).toContain(cases[i]![1]))
  })

  it('runs unmatched invoices through the exception subflow', () => {
    const ctx = invoiceCtx(false)
    const sim = quiet('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_amount: 500 }, 'u_maya')!
    advance(sim, ctx, 6)
    expect(o.tokens[0]!.calls.map((c) => c.nodeId)).toEqual(['n_exception'])
    expect(o.tokens[0]!.nodeId).toMatch(/^x_/)
    expect(computeView(sim, ctx).nodes.n_exception!.inside).toBe(1)
  })
})

// ---------- Distribution ----------

describe('work distribution', () => {
  it('load balances evenly across a group of 10', () => {
    const ctx = oneStepCtx('load-balance', 10)
    const sim = quiet('a')
    for (let i = 0; i < 53; i++) createObject(sim, ctx, 'w', {}, 'boss')
    const loads = [...openLoads(sim).values()]
    expect(loads).toHaveLength(10)
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1)
  })

  it('skips unavailable members when load balancing', () => {
    const ctx = oneStepCtx('load-balance', 4)
    ctx.users[0]!.available = false
    const sim = quiet('a')
    for (let i = 0; i < 9; i++) createObject(sim, ctx, 'w', {}, 'boss')
    expect(openLoads(sim).get('u0')).toBeUndefined()
    expect([...openLoads(sim).values()]).toEqual([3, 3, 3])
  })

  it('leaves queue work unassigned until members fetch it', () => {
    const ctx = oneStepCtx('queue', 3)
    const sim = quiet('a')
    for (let i = 0; i < 5; i++) createObject(sim, ctx, 'w', {}, 'boss')
    expect(computeView(sim, ctx).nodes.u!.unassigned).toBe(5)
    advance(sim, ctx, 1)
    const m = computeView(sim, ctx).nodes.u!
    expect(m.working).toBe(3)
    expect(m.unassigned).toBe(2)
  })

  it('fetches the most urgent item first, then the oldest', () => {
    const ctx = oneStepCtx('queue', 1)
    const sim = quiet('a')
    createObject(sim, ctx, 'w', { pri: 'pri_1' }, 'boss')
    advance(sim, ctx, 1) // u0 starts on the first one
    const normal = createObject(sim, ctx, 'w', { pri: 'pri_1' }, 'boss')!
    const urgent = createObject(sim, ctx, 'w', { pri: 'pri_2' }, 'boss')!
    expect(urgent.priority).toBe('urgent')
    const next = workNext(sim, ctx, 'u0')
    expect(next.ok && next.value).toBe(urgent.tokens[0]!.id)
    expect(normal.tokens[0]!.state).toBe('unassigned')
  })

  it('holds distribution-group work until a dispatcher hands it out', () => {
    const ctx = ctxWith([wf([start, userStep('u', 'manager', { distributorGroupId: 'dg' }), end()], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })])])
    const sim = quiet('a')
    for (let i = 0; i < 6; i++) createObject(sim, ctx, 'w', {}, 'boss')
    advance(sim, ctx, 20)
    expect(computeView(sim, ctx).nodes.u!.unassigned).toBe(6)
    advance(sim, ctx, 15)
    expect(computeView(sim, ctx).nodes.u!.unassigned).toBe(0)
    const byDispatcher = Object.values(sim.objects).filter((o) => o.history.some((h) => h.kind === 'distributed' && h.actor === 'Dispatcher'))
    expect(byDispatcher).toHaveLength(6)
  })

  it('lets dispatchers hand out work by hand, only to the step’s group', () => {
    const ctx = ctxWith([wf([start, userStep('u', 'manager', { distributorGroupId: 'dg', autoDistribute: false }), end()], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })])])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    const t = o.tokens[0]!.id
    expect(distributionFor(sim, ctx, 'disp')[0]!.waiting).toHaveLength(1)
    expect(workDistribute(sim, ctx, t, 'u1', 'u2').ok).toBe(false) // not a dispatcher
    expect(workDistribute(sim, ctx, t, 'disp', 'out').ok).toBe(false) // not in the group
    expect(workDistribute(sim, ctx, t, 'disp', 'u2').ok).toBe(true)
    expect(o.tokens[0]!.userId).toBe('u2')
  })

  it('assigns direct steps to the named user', () => {
    const ctx = oneStepCtx('direct', 3)
    const sim = quiet('a')
    createObject(sim, ctx, 'w', {}, 'boss')
    createObject(sim, ctx, 'w', {}, 'boss')
    expect(openLoads(sim).get('u0')).toBe(2)
  })

  it('assigns from a person field (retain familiar), falling back to the group', () => {
    const ctx = ctxWith([wf([start, userStep('u', 'field', { assigneeFieldId: 'who' }), end()], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })])])
    const sim = quiet('a')
    const named = createObject(sim, ctx, 'w', { who: 'u3' }, 'boss')!
    const blank = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(named.tokens[0]!.userId).toBe('u3')
    expect(blank.tokens[0]!.userId).toMatch(/^u\d$/)
  })

  it('escalates work that sits too long: priority up, back to the dispatchers', () => {
    const ctx = ctxWith([
      wf(
        [start, userStep('u', 'manager', { distributorGroupId: 'dg', autoDistribute: false, escalateAfterHours: 1, escalation: { raisePriority: true, toDistributors: true } }), end()],
        [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })],
      ),
    ], { manual: ['u1'] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    workDistribute(sim, ctx, o.tokens[0]!.id, 'disp', 'u1')
    advance(sim, ctx, 59)
    expect(o.priority).toBe('normal')
    advance(sim, ctx, 2)
    expect(o.priority).toBe('high')
    expect(o.tokens[0]!.state).toBe('unassigned')
    expect(o.history.some((h) => h.kind === 'escalated')).toBe(true)
  })
})

// ---------- Parallel split / join ----------

describe('parallel split and join (broadcast / rendezvous)', () => {
  const split = (mode: 'all' | 'inclusive' = 'all'): WfNode => ({ id: 'p', type: 'split', position: at, data: { label: 'Split', mode } })
  const join = (mode: 'all' | 'any' | 'count' = 'all', extra = {}): WfNode => ({ id: 'j', type: 'join', position: at, data: { label: 'Join', mode, ...extra } })

  it('runs every branch at once and continues only when all have arrived', () => {
    const ctx = ctxWith([wf([start, split(), autoStep('a', 5), autoStep('b', 60), join(), end()], [edge('s', 'p'), edge('p', 'a'), edge('p', 'b'), edge('a', 'j'), edge('b', 'j'), edge('j', 'e')])])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(o.tokens.map((t) => t.nodeId).sort()).toEqual(['a', 'b'])
    advance(sim, ctx, 15)
    expect(o.tokens.find((t) => t.nodeId === 'j')!.state).toBe('joining')
    expect(o.status).toBe('active')
    advance(sim, ctx, 120)
    expect(o.status).toBe('completed')
    expect(o.tokens).toHaveLength(0)
    expect(sim.forks).toEqual({})
    expect(sim.edgeCounts['j-e-']).toBe(1)
  })

  it('“first wins” join continues at once and withdraws the slower branch', () => {
    const ctx = ctxWith([
      wf([start, split(), autoStep('fast', 3), userStep('slow', 'load-balance'), join('any', { cancelRemaining: true }), end()], [
        edge('s', 'p'),
        edge('p', 'fast'),
        edge('p', 'slow'),
        edge('fast', 'j'),
        edge('slow', 'j', { outcomeId: 'ok' }),
        edge('j', 'e'),
      ]),
    ])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(openLoads(sim).size).toBe(1)
    advance(sim, ctx, 30)
    expect(o.status).toBe('completed')
    expect(openLoads(sim).size).toBe(0)
    expect(o.history.some((h) => h.kind === 'withdrawn')).toBe(true)
  })

  it('N-of-M join without cancelling: late branches are absorbed and the item still finishes', () => {
    const ctx = ctxWith([
      wf([start, split(), autoStep('a', 2), autoStep('b', 4), autoStep('c', 200), join('count', { count: 2 }), end()], [
        edge('s', 'p'),
        edge('p', 'a'),
        edge('p', 'b'),
        edge('p', 'c'),
        edge('a', 'j'),
        edge('b', 'j'),
        edge('c', 'j'),
        edge('j', 'e'),
      ]),
    ])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 30)
    expect(o.history.some((h) => h.text.includes('2 of 3 branches'))).toBe(true)
    expect(o.status).toBe('active') // the slow branch is still running
    advance(sim, ctx, 600)
    expect(o.status).toBe('completed')
    expect(o.tokens).toHaveLength(0)
  })

  it('inclusive split runs only the branches whose rules match, and the join waits for just those', () => {
    const big = { match: 'all' as const, rules: [{ id: 'r1', fieldId: 'amt', op: 'gt' as const, value: 1000 }] }
    const small = { match: 'all' as const, rules: [{ id: 'r2', fieldId: 'amt', op: 'lte' as const, value: 1000 }] }
    const any = { match: 'all' as const, rules: [{ id: 'r3', fieldId: 'amt', op: 'gt' as const, value: 0 }] }
    const ctx = ctxWith([
      wf([start, split('inclusive'), autoStep('a', 2), autoStep('b', 2), autoStep('c', 2), join(), end()], [
        edge('s', 'p'),
        edge('p', 'a', { condition: big, order: 0 }),
        edge('p', 'b', { condition: small, order: 1 }),
        edge('p', 'c', { condition: any, order: 2 }),
        edge('a', 'j'),
        edge('b', 'j'),
        edge('c', 'j'),
        edge('j', 'e'),
      ]),
    ])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', { amt: 5000 }, 'boss')!
    expect(o.tokens.map((t) => t.nodeId).sort()).toEqual(['a', 'c'])
    advance(sim, ctx, 30)
    expect(o.status).toBe('completed')
  })

  it('a branch that ends elsewhere no longer holds up the join', () => {
    const ctx = ctxWith([
      wf([start, split(), autoStep('a', 2), autoStep('b', 10), join(), end(), end('side')], [edge('s', 'p'), edge('p', 'a'), edge('p', 'b'), edge('a', 'side'), edge('b', 'j'), edge('j', 'e')]),
    ])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 60)
    expect(o.status).toBe('completed')
    expect(o.endNodeId).toBe('e')
  })

  it('a rejection in one branch ends the item and withdraws the others', () => {
    const ctx = ctxWith([
      wf([start, split(), userStep('review', 'load-balance'), autoStep('check', 2), join(), end(), end('no', 'rejected')], [
        edge('s', 'p'),
        edge('p', 'review'),
        edge('p', 'check'),
        edge('review', 'j', { outcomeId: 'ok' }),
        edge('check', 'no'),
        edge('j', 'e'),
      ]),
    ])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 10)
    expect(o.status).toBe('rejected')
    expect(o.tokens).toHaveLength(0)
    expect(openLoads(sim).size).toBe(0)
  })
})

// ---------- Subflows ----------

describe('subflows', () => {
  function subflowCtx(childEnd: WfNode, parentEdges: WfEdge[]): Ctx {
    const parent = wf(
      [start, { id: 'sub', type: 'subflow', position: at, data: { label: 'Do the thing', workflowId: 'child' } }, end('ok'), end('no', 'rejected')],
      [edge('s', 'sub'), ...parentEdges],
    )
    const child: Workflow = {
      id: 'child',
      name: 'Child',
      kind: 'subflow',
      objectTypeId: 't',
      arrivalsPerHour: 0,
      nodes: [{ id: 'cs', type: 'start', position: at, data: { label: 'Begin' } }, autoStep('work', 5), childEnd],
      edges: [edge('cs', 'work'), edge('work', childEnd.id)],
    }
    return ctxWith([parent, child])
  }

  it('runs the subflow inside the step and continues on the ending’s path', () => {
    const ctx = subflowCtx(end('ce', 'completed', { outcome: 'Approved' }), [edge('sub', 'ok', { outcomeId: 'Approved' }), edge('sub', 'no', { outcomeId: 'Rejected' })])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(o.tokens[0]!.nodeId).toBe('work')
    expect(computeView(sim, ctx).nodes.sub!.inside).toBe(1)
    advance(sim, ctx, 30)
    expect(o.status).toBe('completed')
    expect(o.endNodeId).toBe('ok')
    expect(o.history.filter((h) => h.kind === 'subflow')).toHaveLength(2)
  })

  it('a rejection inside the subflow with no path for it rejects the item', () => {
    const ctx = subflowCtx(end('ce', 'rejected', { outcome: 'Rejected' }), [edge('sub', 'ok')])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 30)
    expect(o.status).toBe('rejected')
  })

  it('blows a step out into a subflow without changing how work flows', () => {
    const ctx = seedCtx()
    const parent = ctx.app.workflows.find((w) => w.id === 'w_invoice')!
    const res = expandToSubflow(ctx.app, parent, 'n_clerk')!
    ctx.app.workflows = ctx.app.workflows.map((w) => (w.id === parent.id ? res.parent : w)).concat(res.child)
    const sim = newSim('app_invoice', 11)
    advance(sim, ctx, 10 * 60)
    const v = computeView(sim, ctx)
    expect(v.stuck).toBe(0)
    expect(sim.completed).toBeGreaterThan(20)
    expect(Object.values(sim.objects).some((o) => o.history.some((h) => h.kind === 'subflow' && h.nodeId === 'n_clerk'))).toBe(true)
  })
})

// ---------- Automated steps & services ----------

describe('automated steps and the service registry', () => {
  const flow = (extra: Partial<Extract<WfNode, { type: 'auto' }>['data']> = {}, edges: WfEdge[] = [edge('s', 'call'), edge('call', 'e')]) =>
    wf([start, autoStep('call', 5, { serviceId: 'svc', operationId: 'svc_op', outputs: [{ key: 'matched', fieldId: 'ok' }], ...extra }), end(), end('failed', 'rejected')], edges)

  it('limits calls in flight to the service’s capacity; the rest queue', () => {
    const ctx = ctxWith([flow()], { services: [svc('svc', { concurrency: 1 })] })
    const sim = quiet('a')
    for (let i = 0; i < 3; i++) createObject(sim, ctx, 'w', {}, 'boss')
    const v = computeView(sim, ctx)
    expect(v.services.svc!.inFlight).toBe(1)
    expect(v.services.svc!.queued).toBe(2)
    expect(v.nodes.call!.queued).toBe(2)
    advance(sim, ctx, 120)
    expect(sim.completed).toBe(3)
    expect(Object.values(sim.objects).every((o) => o.data.ok === true)).toBe(true)
    expect(sstat(sim, 'svc').inFlight).toBe(0)
  })

  it('waits while a service is offline and resumes when it is back', () => {
    const service = svc('svc', { status: 'offline' })
    const ctx = ctxWith([flow()], { services: [service] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 60)
    expect(o.tokens[0]!.state).toBe('queued')
    service.status = 'online'
    advance(sim, ctx, 30)
    expect(o.status).toBe('completed')
  })

  it('retries, then hands the work to a person when automation keeps failing', () => {
    const ctx = ctxWith([flow({ retries: 1, onFailure: 'manual', fallbackGroupId: 'g' })], { services: [svc('svc', {}, { successRate: 0 })], manual: ['u0', 'u1', 'u2', 'u3'] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 60)
    expect(sstat(sim, 'svc').calls).toBe(2)
    const t = o.tokens[0]!
    expect(t.manual).toBe(true)
    expect(t.userId).toMatch(/^u\d$/)
    expect(computeView(sim, ctx).nodes.call!.manual).toBe(1)
  })

  it('follows the “Failed” path when one is drawn', () => {
    const ctx = ctxWith([flow({ onFailure: 'route' }, [edge('s', 'call'), edge('call', 'e', { outcomeId: 'success' }), edge('call', 'failed', { outcomeId: 'failure' })])], {
      services: [svc('svc', {}, { successRate: 0 })],
    })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 30)
    expect(o.status).toBe('rejected')
    expect(o.endNodeId).toBe('failed')
  })

  it('an administrator can take work away from the automation and give it to a person in the group', () => {
    const ctx = ctxWith([flow({ fallbackGroupId: 'g' })], { services: [svc('svc', { concurrency: 1 }, { avgMinutes: 500 })] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(sstat(sim, 'svc').inFlight).toBe(1)
    expect(adminAssign(sim, ctx, o.tokens[0]!.id, 'out', 'Supervisor', { sameGroupOnly: true }).ok).toBe(false)
    expect(adminAssign(sim, ctx, o.tokens[0]!.id, 'u2', 'Supervisor', { sameGroupOnly: true }).ok).toBe(true)
    expect(sstat(sim, 'svc').inFlight).toBe(0)
    expect(o.tokens[0]!.manual).toBe(true)
    expect(adminRelease(sim, ctx, o.tokens[0]!.id, 'success', '').ok).toBe(true)
    expect(o.status).toBe('completed')
  })
})

// ---------- Workspace (people working their own baskets) ----------

describe('workspace operations', () => {
  it('real people in the Workspace are not worked by the simulation', () => {
    const ctx = ctxWith([wf([start, userStep('u', 'direct', { avgMinutes: 5 }), end()], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })])], { manual: ['u0'] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    advance(sim, ctx, 600)
    expect(o.status).toBe('active')
    expect(basketOf(sim, ctx, 'u0')).toHaveLength(1)
  })

  it('release needs the required comment and required fields; then the item moves on', () => {
    const step = userStep('u', 'direct', { outcomes: [{ id: 'no', label: 'Reject', weight: 1, requireComment: true, actions: [] }, { id: 'ok', label: 'Approve', weight: 1, actions: [] }] })
    const ctx = ctxWith([wf([start, step, end(), end('x', 'rejected')], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' }), edge('u', 'x', { outcomeId: 'no' })])], { manual: ['u0'] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    const t = o.tokens[0]!.id
    expect(workRelease(sim, ctx, t, 'u1', 'ok', '').ok).toBe(false) // not theirs
    expect(workRelease(sim, ctx, t, 'u0', 'no', '').ok).toBe(false) // comment required
    const missing = workRelease(sim, ctx, t, 'u0', 'ok', '')
    expect(!missing.ok && missing.error).toMatch(/Notes/)
    expect(workRelease(sim, ctx, t, 'u0', 'ok', '', { notes: 'Checked against the contract.' }).ok).toBe(true)
    expect(o.status).toBe('completed')
    expect(o.data.notes).toBe('Checked against the contract.')
  })

  it('field security: locked, read-only and restricted fields can’t be changed', () => {
    const step = userStep('u', 'direct', { fieldAccess: { amt: 'read' } })
    const ctx = ctxWith(
      [
        wf([start, autoStep('first', 1), step, end()], [edge('s', 'first'), edge('first', 'u'), edge('u', 'e', { outcomeId: 'ok' })], {
          fieldLocks: [{ id: 'l', fieldId: 'pri', access: 'read', when: 'after', afterNodeId: 'first' }],
        }),
      ],
      { manual: ['u0'] },
    )
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', { amt: 10 }, 'boss')!
    advance(sim, ctx, 5)
    const t = o.tokens[0]!.id
    expect(workSave(sim, ctx, t, 'u0', { amt: 99 }).ok).toBe(false) // read-only at this step
    expect(workSave(sim, ctx, t, 'u0', { pri: 'pri_2' }).ok).toBe(false) // locked after "first"
    expect(workSave(sim, ctx, t, 'u0', { secret: 'x' }).ok).toBe(false) // restricted to another group
    expect(workSave(sim, ctx, t, 'u0', { notes: 'fine' }).ok).toBe(true)
    expect(o.data.amt).toBe(10)
    expect(o.history.filter((h) => h.kind === 'security')).toHaveLength(3)
  })

  it('claim from a queue, delegate within the group only', () => {
    const ctx = ctxWith([wf([start, userStep('u', 'queue'), end()], [edge('s', 'u'), edge('u', 'e', { outcomeId: 'ok' })])], { manual: ['u0', 'u1', 'u2', 'u3'] })
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    const t = o.tokens[0]!.id
    expect(queuesFor(sim, ctx, 'u1')[0]!.items).toHaveLength(1)
    expect(workClaim(sim, ctx, t, 'out').ok).toBe(false)
    expect(workClaim(sim, ctx, t, 'u1').ok).toBe(true)
    expect(workDelegate(sim, ctx, t, 'u1', 'out').ok).toBe(false)
    expect(workDelegate(sim, ctx, t, 'u1', 'u3').ok).toBe(true)
    expect(basketOf(sim, ctx, 'u3')).toHaveLength(1)
  })

  it('create permission comes from the object type', () => {
    const ctx = oneStepCtx('queue', 2)
    expect(canCreate(ctx, 'w', 'u0')).toBe(true)
    expect(canCreate(ctx, 'w', 'out')).toBe(false)
  })
})

// ---------- Administrator operations ----------

describe('administrator operations', () => {
  it('redistributes a piled-up basket evenly', () => {
    const ctx = oneStepCtx('manager', 5)
    const sim = quiet('a')
    const objs = Array.from({ length: 20 }, () => createObject(sim, ctx, 'w', {}, 'boss')!)
    objs.forEach((o) => adminAssign(sim, ctx, o.tokens[0]!.id, 'u0'))
    expect(openLoads(sim).get('u0')).toBe(20)
    const moved = adminRedistribute(sim, ctx, 'u')
    expect(moved).toBeGreaterThan(0)
    expect([...openLoads(sim).values()].sort()).toEqual([4, 4, 4, 4, 4])
  })

  it('moves a work item to another step and records who did it', () => {
    const ctx = oneStepCtx('queue', 2)
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', {}, 'boss')!
    expect(adminMove(sim, ctx, o.tokens[0]!.id, 'e').ok).toBe(true)
    expect(o.status).toBe('completed')
    expect(o.history.some((h) => h.kind === 'moved' && h.actor === 'Administrator')).toBe(true)
  })
})

// ---------- Model-driven changes ----------

describe('model-driven changes', () => {
  it('parks work with no path as stuck, then resumes when the map is fixed', () => {
    const w = wf([start, userStep('u', 'queue'), end(), { id: 'd', type: 'decision', position: at, data: { label: 'Big?' } }], [
      edge('s', 'd'),
      edge('d', 'u', { order: 0, condition: { match: 'all', rules: [{ id: 'r', fieldId: 'amt', op: 'gt', value: 1000 }] } }),
      edge('u', 'e', { outcomeId: 'ok' }),
    ])
    const ctx = ctxWith([w])
    const sim = quiet('a')
    const o = createObject(sim, ctx, 'w', { amt: 10 }, 'boss')!
    expect(o.tokens[0]!.state).toBe('stuck')
    expect(computeView(sim, ctx).stuck).toBe(1)
    w.edges.push(edge('d', 'e', { isDefault: true }))
    advance(sim, ctx, 1)
    expect(o.status).toBe('completed')
  })
})

// ---------- Templates ----------

describe('templates', () => {
  it('stamps a template into an app, mapping fields by name and creating the rest', () => {
    const d = seedDesign()
    const app = d.apps[0]!
    const tpl = d.templates.find((t) => t.id === 'tpl_two_level')!
    const binding = suggestBinding(tpl, app.objectTypes[0]!.fields)
    expect(binding.t2_amount).toBe('f_amount')
    expect(binding.t2_approver).toBe('f_approver')
    const a = instantiateTemplate(app, tpl, { objectTypeId: 't_invoice', binding, groups: d.groups, users: d.users })
    const b = instantiateTemplate(app, tpl, { objectTypeId: 't_invoice', binding, groups: d.groups, users: d.users })
    expect(a.newFields).toHaveLength(0)
    expect(a.workflow.nodes.map((n) => n.id)).not.toEqual(b.workflow.nodes.map((n) => n.id))
    const rule = a.workflow.edges.find((e) => e.data.condition)!.data.condition!.rules[0]!
    expect(rule.fieldId).toBe('f_amount')
    // Every outcome path points at an outcome that exists on its step.
    for (const e of a.workflow.edges) {
      const src = a.workflow.nodes.find((n) => n.id === e.source)!
      if (src.type === 'user') expect(src.data.outcomes.some((o) => o.id === e.data.outcomeId)).toBe(true)
    }
  })
})

// ---------- What-if scenarios ----------

describe('what-if scenarios', () => {
  it('is deterministic: no change, same result', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 5)
    advance(sim, ctx, 120)
    const r = runScenario(sim, ctx, [], 4)
    expect(r.scenario.completed).toBe(r.baseline.completed)
    expect(r.scenario.wip).toBe(r.baseline.wip)
    expect(sim.clock).toBe(120) // the live simulation is untouched
  })

  it('adding GPU capacity clears the AI detection backlog', () => {
    const ctx = seedCtx(2)
    const sim = newSim('app_soc', 9)
    advance(sim, ctx, 6 * 60)
    const before = computeView(sim, ctx).nodes.s_detect!.queued
    expect(before).toBeGreaterThan(5)
    const r = runScenario(sim, ctx, [{ kind: 'capacity', serviceId: 'svc_vision', concurrency: 4 }], 2)
    expect(r.scenario.view.nodes.s_detect!.queued).toBeLessThan(r.baseline.view.nodes.s_detect!.queued)
    expect(r.scenario.completed).toBeGreaterThan(r.baseline.completed)
  })
})

// ---------- Full simulations of the sample apps ----------

describe('full simulation', () => {
  it('runs a working day of the invoice process and accounts for every item', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 7)
    advance(sim, ctx, 8 * 60)
    const v = computeView(sim, ctx)
    expect(sim.created).toBeGreaterThan(60)
    expect(sim.completed).toBeGreaterThan(20)
    expect(v.stuck).toBe(0)
    expect(sim.created).toBe(v.active + sim.completed + sim.rejected)
    const paid = Object.values(sim.objects).filter((o) => o.status === 'completed')
    expect(paid.every((o) => typeof o.data.f_approver === 'string' && typeof o.data.f_paydate === 'string')).toBe(true)
    // Paid invoices went through all three parallel branches.
    expect(paid.every((o) => ['n_post', 'n_remit', 'n_archive'].every((n) => o.passed.includes(n)))).toBe(true)
    expect(activeTokens(sim).every((t) => sim.objects[t.objectId]!.status === 'active')).toBe(true)
  })

  it('runs the fleet process: linked lists stay consistent and quotes join 2 of 3', () => {
    const ctx = seedCtx(1)
    const sim = newSim('app_fleet', 3)
    advance(sim, ctx, 3 * 24 * 60)
    const list = ctx.app.lists.find((l) => l.id === 'l_vehicles')!
    const type = ctx.app.objectTypes[0]!
    const objs = Object.values(sim.objects)
    expect(objs.length).toBeGreaterThan(30)
    for (const o of objs) {
      const make = list.items.find((i) => i.id === o.data.v_make)!
      const model = list.items.find((i) => i.id === o.data.v_model)!
      expect(make.parentId).toBe(o.data.v_year)
      expect(model.parentId).toBe(o.data.v_make)
    }
    const makeField = type.fields.find((f) => f.id === 'v_make')!
    expect(optionsForField(makeField, list, { v_year: 'l_vehicles_0' }).map((i) => i.label)).toEqual(['Ford', 'Toyota', 'Chevrolet'])
    expect(objs.some((o) => o.history.some((h) => h.text.includes('2 of 3 branches')))).toBe(true)
    expect(objs.some((o) => o.history.some((h) => h.kind === 'withdrawn'))).toBe(true)
    expect(computeView(sim, ctx).stuck).toBe(0)
    expect(sim.created).toBe(computeView(sim, ctx).active + sim.completed + sim.rejected)
  })

  it('runs camera events through AI, parallel enrichment, dispatch and incident reports', () => {
    const ctx = seedCtx(2)
    const sim = newSim('app_soc', 4)
    advance(sim, ctx, 8 * 60)
    const v = computeView(sim, ctx)
    const objs = Object.values(sim.objects)
    expect(sim.created).toBeGreaterThan(700)
    expect(v.stuck).toBe(0)
    expect(sim.created).toBe(v.active + sim.completed + sim.rejected)
    expect(objs.some((o) => o.endNodeId === 's_dismiss')).toBe(true)
    expect(objs.some((o) => o.endNodeId === 's_filed')).toBe(true)
    // The incident report went back to the officer who responded.
    const filed = objs.filter((o) => o.endNodeId === 's_filed')
    for (const o of filed) {
      const wrote = o.history.find((h) => h.kind === 'released' && h.nodeId === 'r_write')
      expect(wrote?.userId).toBe(o.data.e_officer)
    }
    expect(v.bottleneckId).toBe('s_detect')
  })

  it('bursts create work at once', () => {
    const ctx = seedCtx()
    const sim = quiet('app_invoice')
    expect(burst(sim, ctx, 'w_invoice', 10)).toBe(10)
    expect(sim.activeIds).toHaveLength(10)
  })
})
