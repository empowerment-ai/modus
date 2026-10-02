// Read models: what the studio canvas, the monitor and the workspace show.
// Pure functions of (SimState, Ctx); nothing here mutates.

import type { Id, Priority, WfNode, Workflow } from '../model/types'
import {
  activeObjects,
  activeTokens,
  buildIndex,
  byUrgency,
  type Ctx,
  distributorsOf,
  type Index,
  queueStepsByUser,
  serviceOf,
  type SimObject,
  type SimState,
  type Token,
  type TokenState,
  type WorkStep,
  workStepOf,
} from './engine'

export interface NodeMetrics {
  total: number
  unassigned: number
  assigned: number
  working: number
  stuck: number
  /** Automated calls in flight (or routing). */
  automated: number
  /** Waiting for a service slot / an offline service. */
  queued: number
  /** Parallel branches waiting at a join. */
  joining: number
  /** On a timer. */
  waiting: number
  /** Automated step being done by hand. */
  manual: number
  /** Subflow step: items currently running inside it. */
  inside: number
  oldestAge: number
  avgTime: number
  avgWait: number
  entered: number
  exited: number
  slaBreaches: number
  byUser: Record<Id, { assigned: number; working: number }>
  availableMembers: number
  /** 0 idle · 1 flowing · 2 building up · 3 backed up */
  heat: 0 | 1 | 2 | 3
}

export interface ServiceMetrics {
  inFlight: number
  queued: number
  calls: number
  ok: number
  failed: number
  /** Share of capacity used since the start (0..1); undefined when unlimited. */
  utilization?: number
}

export interface SimView {
  clock: number
  nodes: Record<Id, NodeMetrics>
  users: Record<Id, { open: number; working: boolean; currentId?: Id; completed: number; busyMinutes: number }>
  services: Record<Id, ServiceMetrics>
  created: number
  active: number
  completed: number
  rejected: number
  stuck: number
  /** Live parallel branches across all items. */
  branches: number
  avgCycle: number
  overdue: number
  bottleneckId?: Id
}

const blank = (): NodeMetrics => ({
  total: 0,
  unassigned: 0,
  assigned: 0,
  working: 0,
  stuck: 0,
  automated: 0,
  queued: 0,
  joining: 0,
  waiting: 0,
  manual: 0,
  inside: 0,
  oldestAge: 0,
  avgTime: 0,
  avgWait: 0,
  entered: 0,
  exited: 0,
  slaBreaches: 0,
  byUser: {},
  availableMembers: 0,
  heat: 0,
})

export function computeView(sim: SimState, ctx: Ctx): SimView {
  const idx = buildIndex(ctx)
  const nodes: Record<Id, NodeMetrics> = {}
  for (const [id] of idx.node) nodes[id] = blank()
  const users: SimView['users'] = {}
  for (const u of ctx.users) {
    const st = sim.users[u.id]
    users[u.id] = { open: 0, working: false, currentId: st?.currentId, completed: st?.completed ?? 0, busyMinutes: st?.busyMinutes ?? 0 }
  }
  let stuck = 0
  let branches = 0
  let overdue = 0
  const queuedBySvc = new Map<Id, number>()
  const insideSeen = new Set<string>()
  for (const obj of activeObjects(sim)) {
    if (obj.dueBy !== undefined && sim.clock > obj.dueBy) overdue++
    if (obj.tokens.length > 1) branches += obj.tokens.length
    for (const t of obj.tokens) {
      const m = (nodes[t.nodeId] ??= blank())
      m.total++
      m.oldestAge = Math.max(m.oldestAge, sim.clock - t.enteredAt)
      const node = idx.node.get(t.nodeId)?.node
      if (node?.type === 'user' && node.data.slaHours && sim.clock - t.enteredAt > node.data.slaHours * 60) m.slaBreaches++
      // Subflow steps count the items running inside them, at every level (once per item, however many branches).
      for (const c of t.calls) {
        const key = `${c.nodeId}|${obj.id}`
        if (insideSeen.has(key)) continue
        insideSeen.add(key)
        const sm = (nodes[c.nodeId] ??= blank())
        sm.inside++
        sm.total++
        sm.oldestAge = Math.max(sm.oldestAge, sim.clock - c.at)
      }
      if (t.manual) m.manual++
      switch (t.state) {
        case 'unassigned':
          m.unassigned++
          break
        case 'assigned':
        case 'working': {
          if (t.state === 'assigned') m.assigned++
          else m.working++
          if (t.userId) {
            const b = (m.byUser[t.userId] ??= { assigned: 0, working: 0 })
            if (t.state === 'assigned') b.assigned++
            else b.working++
            const u = users[t.userId]
            if (u) {
              u.open++
              if (t.state === 'working') u.working = true
            }
          }
          break
        }
        case 'stuck':
          m.stuck++
          stuck++
          break
        case 'queued': {
          m.queued++
          if (node?.type === 'auto' && node.data.serviceId) queuedBySvc.set(node.data.serviceId, (queuedBySvc.get(node.data.serviceId) ?? 0) + 1)
          break
        }
        case 'joining':
          m.joining++
          break
        case 'waiting':
          m.waiting++
          break
        default:
          m.automated++
      }
    }
  }

  let bottleneckId: Id | undefined
  let worst = 0
  for (const [id, { node }] of idx.node) {
    const m = nodes[id]!
    const s = sim.nodeStats[id]
    if (s) {
      m.entered = s.entered
      m.exited = s.exited
      m.avgTime = s.exited ? s.timeInStep / s.exited : 0
      m.avgWait = s.waitCount ? s.waitTotal / s.waitCount : 0
    }
    if (node.type === 'user') {
      const ws: Pick<WorkStep, 'groupId'> = { groupId: node.data.groupId }
      m.availableMembers = ws.groupId ? (idx.group.get(ws.groupId)?.memberIds.filter((uid) => idx.user.get(uid)?.available).length ?? 0) : 0
      const perWorker = m.total / Math.max(1, node.data.distribution === 'direct' ? 1 : m.availableMembers)
      m.heat = m.total === 0 ? 0 : perWorker < 2 ? 1 : perWorker < 5 ? 2 : 3
      if (m.slaBreaches > 0 && m.heat < 2) m.heat = 2
      if (m.stuck > 0) m.heat = 3
      const score = m.total * (1 + m.oldestAge / 60)
      if (m.total >= 5 && score > worst) {
        worst = score
        bottleneckId = id
      }
    } else if (node.type === 'auto') {
      // An automated step is a bottleneck when work piles up waiting for its service.
      m.heat = m.stuck > 0 || m.queued >= 10 ? 3 : m.queued > 0 || m.manual > 0 ? 2 : m.total > 0 ? 1 : 0
      const score = m.queued * (1 + m.oldestAge / 60)
      if (m.queued >= 5 && score > worst) {
        worst = score
        bottleneckId = id
      }
    } else if (node.type === 'subflow') {
      m.heat = m.stuck > 0 ? 3 : m.inside > 0 ? 1 : 0
    } else {
      m.heat = m.stuck > 0 ? 3 : m.total > 0 ? 1 : 0
    }
  }

  const services: Record<Id, ServiceMetrics> = {}
  for (const svc of ctx.services ?? []) {
    const st = sim.services[svc.id]
    const capacity = svc.concurrency ? svc.concurrency * Math.max(1, sim.clock) : undefined
    services[svc.id] = {
      inFlight: st?.inFlight ?? 0,
      queued: queuedBySvc.get(svc.id) ?? 0,
      calls: st?.calls ?? 0,
      ok: st?.ok ?? 0,
      failed: st?.failed ?? 0,
      utilization: capacity ? Math.min(1, ((st?.busyMinutes ?? 0) + (st?.inFlight ?? 0) * 0.5) / capacity) : undefined,
    }
  }

  const finished = sim.completed + sim.rejected
  return {
    clock: sim.clock,
    nodes,
    users,
    services,
    created: sim.created,
    active: sim.activeIds.length,
    completed: sim.completed,
    rejected: sim.rejected,
    stuck,
    branches,
    avgCycle: finished ? sim.cycleTotal / finished : 0,
    overdue,
    bottleneckId,
  }
}

// ---------- Workspace selectors ----------

export interface WorkItem {
  token: Token
  obj: SimObject
  node: WfNode
  wf: Workflow
  step: WorkStep
  priority: Priority
  /** When this step is due (sim minute), from the step's service level. */
  stepDue?: number
  /** When the whole item is due. */
  caseDue?: number
  /** The earlier of the two. */
  due?: number
  overdue: boolean
  /** Minutes at this step. */
  age: number
  /** "Workflow › Subflow" when the step runs inside a subflow. */
  path: string
}

function toItem(sim: SimState, idx: Index, t: Token): WorkItem | undefined {
  const obj = sim.objects[t.objectId]
  const found = idx.node.get(t.nodeId)
  const step = workStepOf(idx, t)
  if (!obj || !found || !step) return undefined
  const stepDue = step.slaHours ? t.enteredAt + step.slaHours * 60 : undefined
  const caseDue = obj.dueBy
  const due = stepDue !== undefined && caseDue !== undefined ? Math.min(stepDue, caseDue) : (stepDue ?? caseDue)
  const parents = t.calls.map((c) => idx.wf.get(c.workflowId)?.name).filter(Boolean)
  return {
    token: t,
    obj,
    node: found.node,
    wf: found.wf,
    step,
    priority: obj.priority,
    stepDue,
    caseDue,
    due,
    overdue: due !== undefined && sim.clock > due,
    age: sim.clock - t.enteredAt,
    path: [...parents, found.wf.name].join(' › '),
  }
}

const urgent = (sim: SimState) => byUrgency((t) => t.enteredAt, (t) => sim.objects[t.objectId])

/** Everything in a person's basket, most urgent first. */
export function basketOf(sim: SimState, ctx: Ctx, userId: Id): WorkItem[] {
  const idx = buildIndex(ctx)
  return activeTokens(sim)
    .filter((t) => t.userId === userId && (t.state === 'assigned' || t.state === 'working'))
    .sort(urgent(sim))
    .map((t) => toItem(sim, idx, t))
    .filter((x): x is WorkItem => !!x)
}

export interface QueueSummary {
  nodeId: Id
  label: string
  path: string
  groupName: string
  items: WorkItem[]
}

/** Queues a person can fetch from, with what is waiting in each. */
export function queuesFor(sim: SimState, ctx: Ctx, userId: Id): QueueSummary[] {
  const idx = buildIndex(ctx)
  const steps = queueStepsByUser(idx).get(userId) ?? []
  const waiting = activeTokens(sim).filter((t) => t.state === 'unassigned')
  return steps.map((nodeId) => {
    const found = idx.node.get(nodeId)!
    const node = found.node
    const groupId = node.type === 'user' ? node.data.groupId : undefined
    const items = waiting
      .filter((t) => t.nodeId === nodeId)
      .sort(urgent(sim))
      .map((t) => toItem(sim, idx, t))
      .filter((x): x is WorkItem => !!x)
    return { nodeId, label: node.data.label, path: found.wf.name, groupName: idx.group.get(groupId ?? '')?.name ?? '', items }
  })
}

export interface DistributionSummary {
  nodeId: Id
  label: string
  path: string
  groupId?: Id
  groupName: string
  /** Waiting to be handed out. */
  waiting: WorkItem[]
  /** Already handed out and not yet started (can be moved). */
  assigned: WorkItem[]
}

/** Steps a person hands work out for (as a dispatcher or supervisor), with their pools. */
export function distributionFor(sim: SimState, ctx: Ctx, userId: Id): DistributionSummary[] {
  const idx = buildIndex(ctx)
  const out: DistributionSummary[] = []
  const tokens = activeTokens(sim)
  for (const wf of ctx.app.workflows) {
    for (const node of wf.nodes) {
      if (node.type !== 'user' || node.data.distribution !== 'manager') continue
      const ws = { distributorGroupId: node.data.distributorGroupId, supervisorId: node.data.supervisorId, groupId: node.data.groupId }
      if (!distributorsOf(idx, ws).includes(userId)) continue
      const here = tokens.filter((t) => t.nodeId === node.id).sort(urgent(sim))
      const items = (pred: (t: Token) => boolean) => here.filter(pred).map((t) => toItem(sim, idx, t)).filter((x): x is WorkItem => !!x)
      out.push({
        nodeId: node.id,
        label: node.data.label,
        path: wf.name,
        groupId: node.data.groupId,
        groupName: idx.group.get(node.data.groupId ?? '')?.name ?? '',
        waiting: items((t) => t.state === 'unassigned'),
        assigned: items((t) => t.state === 'assigned'),
      })
    }
  }
  return out
}

export interface RequestSummary {
  obj: SimObject
  /** Where it is now: one entry per active branch. */
  where: Array<{ label: string; state: TokenState; who?: Id }>
  due?: number
  overdue: boolean
}

/** Items a person created, newest first. */
export function requestsBy(sim: SimState, ctx: Ctx, userId: Id): RequestSummary[] {
  const idx = buildIndex(ctx)
  return Object.values(sim.objects)
    .filter((o) => o.createdBy === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((obj) => ({
      obj,
      where: obj.tokens.map((t) => ({ label: idx.node.get(t.nodeId)?.node.data.label ?? 'Removed step', state: t.state, who: t.userId })),
      due: obj.dueBy,
      overdue: obj.status === 'active' && obj.dueBy !== undefined && sim.clock > obj.dueBy,
    }))
}

/** One work item, by token id. */
export function workItem(sim: SimState, ctx: Ctx, tokenId: Id): WorkItem | undefined {
  const idx = buildIndex(ctx)
  const objId = tokenId.slice(0, tokenId.lastIndexOf('~'))
  const t = sim.objects[objId]?.tokens.find((x) => x.id === tokenId)
  return t ? toItem(sim, idx, t) : undefined
}

/** Human description of where a token is and what it is waiting for. */
export function describeToken(_sim: SimState, ctx: Ctx, t: Token): string {
  const idx = buildIndex(ctx)
  const node = idx.node.get(t.nodeId)?.node
  const name = (id?: Id) => idx.user.get(id ?? '')?.name ?? 'someone'
  switch (t.state) {
    case 'working':
      return `${name(t.userId)} is working on it`
    case 'assigned':
      return `In ${name(t.userId)}’s basket`
    case 'unassigned': {
      const ws = workStepOf(idx, t)
      if (!ws) return 'Waiting'
      const g = idx.group.get(ws.groupId ?? '')?.name ?? 'the group'
      if (ws.distribution === 'queue') return `Waiting in the ${g} queue`
      if (ws.distribution === 'manager') {
        const dg = ws.distributorGroupId ? idx.group.get(ws.distributorGroupId)?.name : undefined
        return `Waiting to be handed out by ${dg ?? name(distributorsOf(idx, ws)[0])}`
      }
      return `Waiting for an available ${g} member`
    }
    case 'queued':
      return t.waitReason ?? 'Waiting for the service'
    case 'joining':
      return t.waitReason ?? 'Waiting for the other branches'
    case 'waiting':
      return t.waitReason ?? 'On a timer'
    case 'stuck':
      return `Stuck: ${t.stuckReason ?? 'no path out of this step'}`
    default: {
      if (node?.type === 'auto') {
        const { svc, op } = serviceOf(idx, node.data)
        return svc ? `Calling ${svc.name}${op ? ` · ${op.name}` : ''}${(t.attempt ?? 1) > 1 ? ` (attempt ${t.attempt})` : ''}` : 'Automated step running'
      }
      return 'Routing…'
    }
  }
}
