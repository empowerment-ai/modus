// The simulated "server": a discrete-time process engine that moves objects
// through the workflow map exactly as the designer describes it. Every function
// here mutates the SimState it is given; the store wraps calls and re-renders.

import { describeCondition, evaluateCondition } from '../model/conditions'
import type { ActionDef, App, Group, Id, ObjectType, Outcome, User, UserStepData, WfEdge, WfNode, Workflow } from '../model/types'
import { currencyFmt, isoDay, simDate } from '../model/util'
import { commentFor, generateData } from './generate'
import { expMinutes, pick, rand, randInt, weightedPick } from './rng'

// ---------- State ----------

export type WorkState = 'auto' | 'unassigned' | 'assigned' | 'working' | 'stuck' | 'done'

export interface Attachment {
  name: string
  size: number
  kind: string
  /** Object URL for files uploaded in this browser session (not persisted). */
  url?: string
}

export type AuditKind =
  | 'created'
  | 'entered'
  | 'decision'
  | 'auto'
  | 'assigned'
  | 'fetched'
  | 'started'
  | 'released'
  | 'reassigned'
  | 'returned'
  | 'moved'
  | 'notify'
  | 'integration'
  | 'field'
  | 'completed'
  | 'stuck'

export interface AuditEntry {
  at: number
  kind: AuditKind
  nodeId?: Id
  userId?: Id
  actor?: string
  text: string
  comment?: string
}

export interface SimObject {
  id: Id
  number: string
  typeId: Id
  workflowId: Id
  data: Record<string, unknown>
  createdAt: number
  createdBy: string
  status: 'active' | 'completed' | 'rejected' | 'cancelled'
  completedAt?: number
  nodeId: Id
  enteredAt: number
  state: WorkState
  userId?: Id
  assignedAt?: number
  startedAt?: number
  /** Automated step finishes / user finishes working at this sim minute. */
  dueAt?: number
  /** Outcome chosen on release that had no path; retried when the map is fixed. */
  pendingOutcomeId?: Id
  stuckReason?: string
  history: AuditEntry[]
}

export interface NodeStat {
  entered: number
  exited: number
  timeInStep: number
  waitTotal: number
  waitCount: number
}

export interface UserStat {
  completed: number
  busyMinutes: number
  currentId?: Id
}

export interface FeedEntry {
  at: number
  objectId: Id
  number: string
  kind: AuditKind
  text: string
  comment?: string
  userId?: Id
  nodeId?: Id
}

export interface Flight {
  edgeId: Id
  objectId: Id
  reject: boolean
}

export interface SimState {
  appId: Id
  clock: number
  rng: number
  seq: number
  objects: Record<Id, SimObject>
  activeIds: Id[]
  users: Record<Id, UserStat>
  nodeStats: Record<Id, NodeStat>
  edgeCounts: Record<Id, number>
  nextArrival: Record<Id, number>
  lastDistribution: Record<Id, number>
  rrCursor: Record<Id, number>
  feed: FeedEntry[]
  series: Array<{ t: number; wip: number; done: number }>
  /** Edge traversals since the UI last drained them; used to animate tokens. */
  flights: Flight[]
  arrivals: boolean
  created: number
  completed: number
  rejected: number
  cycleTotal: number
}

export interface Ctx {
  app: App
  users: User[]
  groups: Group[]
}

export const ADMIN = 'Administrator'

export function newSim(appId: Id, seed = 20261005): SimState {
  return {
    appId,
    clock: 0,
    rng: seed,
    seq: 0,
    objects: {},
    activeIds: [],
    users: {},
    nodeStats: {},
    edgeCounts: {},
    nextArrival: {},
    lastDistribution: {},
    rrCursor: {},
    feed: [],
    series: [{ t: 0, wip: 0, done: 0 }],
    flights: [],
    arrivals: true,
    created: 0,
    completed: 0,
    rejected: 0,
    cycleTotal: 0,
  }
}

// ---------- Index over the design (rebuilt per call so live edits apply) ----------

interface Index {
  ctx: Ctx
  wf: Map<Id, Workflow>
  node: Map<Id, { node: WfNode; wf: Workflow }>
  out: Map<Id, WfEdge[]>
  type: Map<Id, ObjectType>
  user: Map<Id, User>
  group: Map<Id, Group>
}

export function buildIndex(ctx: Ctx): Index {
  const idx: Index = {
    ctx,
    wf: new Map(),
    node: new Map(),
    out: new Map(),
    type: new Map(ctx.app.objectTypes.map((t) => [t.id, t])),
    user: new Map(ctx.users.map((u) => [u.id, u])),
    group: new Map(ctx.groups.map((g) => [g.id, g])),
  }
  for (const wf of ctx.app.workflows) {
    idx.wf.set(wf.id, wf)
    for (const n of wf.nodes) idx.node.set(n.id, { node: n, wf })
    for (const e of wf.edges) {
      const list = idx.out.get(e.source) ?? []
      list.push(e)
      idx.out.set(e.source, list)
    }
  }
  return idx
}

const userName = (idx: Index, id?: Id) => (id ? (idx.user.get(id)?.name ?? 'Unknown user') : 'nobody')

function nodeLabel(idx: Index, id: Id): string {
  return idx.node.get(id)?.node.data.label ?? 'a removed step'
}

function stat(sim: SimState, nodeId: Id): NodeStat {
  return (sim.nodeStats[nodeId] ??= { entered: 0, exited: 0, timeInStep: 0, waitTotal: 0, waitCount: 0 })
}

function ustat(sim: SimState, userId: Id): UserStat {
  return (sim.users[userId] ??= { completed: 0, busyMinutes: 0 })
}

const FEED_KINDS: AuditKind[] = ['created', 'released', 'completed', 'reassigned', 'moved', 'returned', 'stuck', 'fetched']

function audit(sim: SimState, obj: SimObject, entry: Omit<AuditEntry, 'at'>) {
  const e: AuditEntry = { at: sim.clock, ...entry }
  obj.history.push(e)
  if (FEED_KINDS.includes(e.kind) || (e.kind === 'assigned' && e.actor)) {
    sim.feed.unshift({ at: e.at, objectId: obj.id, number: obj.number, kind: e.kind, text: e.text, comment: e.comment, userId: e.userId, nodeId: e.nodeId })
    if (sim.feed.length > 300) sim.feed.length = 300
  }
}

function workDuration(sim: SimState, avgMinutes: number, speed = 1): number {
  const base = 0.55 + rand(sim) * 0.9
  const tail = rand(sim) < 0.08 ? rand(sim) * 1.5 : 0
  return Math.max(1, Math.round(avgMinutes * speed * (base + tail)))
}

// ---------- Object lifecycle ----------

export function nextNumber(sim: SimState, type: ObjectType): string {
  return `${type.numberPrefix}${1001 + sim.seq}`
}

export function createObject(
  sim: SimState,
  ctx: Ctx,
  workflowId: Id,
  data: Record<string, unknown> | ((number: string) => Record<string, unknown>),
  createdBy: string,
  idx: Index = buildIndex(ctx),
): SimObject | undefined {
  const wf = idx.wf.get(workflowId)
  const type = wf && idx.type.get(wf.objectTypeId)
  if (!wf || !type) return undefined
  const number = nextNumber(sim, type)
  sim.seq++
  const obj: SimObject = {
    id: `o${sim.seq}`,
    number,
    typeId: type.id,
    workflowId,
    data: typeof data === 'function' ? data(number) : { ...data },
    createdAt: sim.clock,
    createdBy,
    status: 'active',
    nodeId: '',
    enteredAt: sim.clock,
    state: 'auto',
    history: [],
  }
  sim.objects[obj.id] = obj
  sim.activeIds.push(obj.id)
  sim.created++
  const byName = idx.user.get(createdBy)?.name ?? createdBy
  audit(sim, obj, { kind: 'created', userId: idx.user.has(createdBy) ? createdBy : undefined, text: `${type.name} created by ${byName}` })
  const start = wf.nodes.find((n) => n.type === 'start')
  if (!start) {
    markStuck(sim, obj, 'This workflow has no start step')
    return obj
  }
  enterNode(sim, idx, obj, start.id, 0)
  return obj
}

function markStuck(sim: SimState, obj: SimObject, reason: string, pendingOutcomeId?: Id) {
  const changed = obj.state !== 'stuck' || obj.stuckReason !== reason
  obj.state = 'stuck'
  obj.stuckReason = reason
  obj.pendingOutcomeId = pendingOutcomeId
  obj.userId = undefined
  if (changed) audit(sim, obj, { kind: 'stuck', nodeId: obj.nodeId, text: `Stuck: ${reason}` })
}

function enterNode(sim: SimState, idx: Index, obj: SimObject, nodeId: Id, hops: number) {
  const found = idx.node.get(nodeId)
  obj.nodeId = nodeId
  obj.enteredAt = sim.clock
  obj.userId = undefined
  obj.assignedAt = undefined
  obj.startedAt = undefined
  obj.dueAt = undefined
  obj.pendingOutcomeId = undefined
  obj.stuckReason = undefined
  if (!found) return markStuck(sim, obj, 'This step was removed from the map')
  const { node } = found
  stat(sim, node.id).entered++

  switch (node.type) {
    case 'start':
      obj.state = 'auto'
      return advanceFrom(sim, idx, obj, undefined, hops)
    case 'decision':
      obj.state = 'auto'
      return advanceFrom(sim, idx, obj, undefined, hops)
    case 'auto':
      obj.state = 'auto'
      obj.dueAt = sim.clock + workDuration(sim, node.data.avgMinutes)
      return
    case 'user':
      audit(sim, obj, { kind: 'entered', nodeId: node.id, text: `Arrived at ${node.data.label}` })
      return distributeOnArrival(sim, idx, obj, node)
    case 'end': {
      obj.state = 'done'
      obj.status = node.data.result
      obj.completedAt = sim.clock
      sim.activeIds = sim.activeIds.filter((i) => i !== obj.id)
      if (node.data.result === 'completed') sim.completed++
      else sim.rejected++
      sim.cycleTotal += sim.clock - obj.createdAt
      audit(sim, obj, { kind: 'completed', nodeId: node.id, text: `Finished: ${node.data.label}` })
      return
    }
  }
}

interface Choice {
  edge?: WfEdge
  reason?: string
  matched?: string
}

function chooseEdge(idx: Index, obj: SimObject, node: WfNode, outcomeId?: Id): Choice {
  const out = idx.out.get(node.id) ?? []
  if (out.length === 0) return { reason: `No path leaves "${node.data.label}"` }

  if (node.type === 'user') {
    if (outcomeId) {
      const e = out.find((x) => x.data.outcomeId === outcomeId)
      if (e) return { edge: e }
    }
    const generic = out.filter((x) => !x.data.outcomeId)
    if (generic.length === 1) return { edge: generic[0] }
    if (out.length === 1) return { edge: out[0] }
    const label = node.data.outcomes.find((o) => o.id === outcomeId)?.label ?? 'this outcome'
    return { reason: `No path for "${label}" from "${node.data.label}"` }
  }

  const type = idx.type.get(obj.typeId)
  const conditional = out
    .filter((e) => !e.data.isDefault && e.data.condition && e.data.condition.rules.length > 0)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
  if (type) {
    for (const e of conditional) {
      if (evaluateCondition(e.data.condition, type, obj.data)) {
        return { edge: e, matched: describeCondition(e.data.condition, { type, lists: idx.ctx.app.lists, users: idx.ctx.users }) }
      }
    }
  }
  const fallback = out.find((e) => e.data.isDefault) ?? out.find((e) => !e.data.condition || e.data.condition.rules.length === 0)
  if (fallback) return { edge: fallback, matched: conditional.length ? 'Otherwise' : undefined }
  return { reason: `No rule in "${node.data.label}" matched and there is no "Otherwise" path` }
}

function advanceFrom(sim: SimState, idx: Index, obj: SimObject, outcomeId: Id | undefined, hops: number) {
  const found = idx.node.get(obj.nodeId)
  if (!found) return markStuck(sim, obj, 'This step was removed from the map', outcomeId)
  if (hops > 40) return markStuck(sim, obj, 'Routing loop detected (40 instant hops)', outcomeId)
  const { node } = found
  const choice = chooseEdge(idx, obj, node, outcomeId)
  if (!choice.edge) return markStuck(sim, obj, choice.reason ?? 'No path', outcomeId)
  const edge = choice.edge
  if (node.type === 'decision') {
    audit(sim, obj, {
      kind: 'decision',
      nodeId: node.id,
      text: `${node.data.label}: ${choice.matched ?? 'matched'} → ${nodeLabel(idx, edge.target)}`,
    })
  }
  leave(sim, idx, obj, edge, outcomeId)
  enterNode(sim, idx, obj, edge.target, hops + 1)
}

function leave(sim: SimState, idx: Index, obj: SimObject, edge: WfEdge, outcomeId?: Id) {
  const s = stat(sim, obj.nodeId)
  s.exited++
  s.timeInStep += sim.clock - obj.enteredAt
  sim.edgeCounts[edge.id] = (sim.edgeCounts[edge.id] ?? 0) + 1
  const src = idx.node.get(edge.source)?.node
  const outcomeLabel = src?.type === 'user' ? (src.data.outcomes.find((o) => o.id === (edge.data.outcomeId ?? outcomeId))?.label ?? '') : ''
  const target = idx.node.get(edge.target)?.node
  const reject = /reject|deny/i.test(outcomeLabel) || (target?.type === 'end' && target.data.result !== 'completed')
  sim.flights.push({ edgeId: edge.id, objectId: obj.id, reject })
  if (sim.flights.length > 400) sim.flights.splice(0, sim.flights.length - 400)
}

// ---------- Distribution ----------

function availableMembers(idx: Index, data: UserStepData): User[] {
  const g = data.groupId ? idx.group.get(data.groupId) : undefined
  if (!g) return []
  return g.memberIds.map((id) => idx.user.get(id)).filter((u): u is User => !!u && u.available)
}

export function openLoads(sim: SimState): Map<Id, number> {
  const loads = new Map<Id, number>()
  for (const id of sim.activeIds) {
    const o = sim.objects[id]
    if (o && o.userId && (o.state === 'assigned' || o.state === 'working')) loads.set(o.userId, (loads.get(o.userId) ?? 0) + 1)
  }
  return loads
}

function assign(sim: SimState, obj: SimObject, userId: Id, kind: AuditKind, text: string, actor?: string) {
  obj.state = 'assigned'
  obj.userId = userId
  obj.assignedAt = sim.clock
  obj.startedAt = undefined
  obj.dueAt = undefined
  audit(sim, obj, { kind, nodeId: obj.nodeId, userId, actor, text })
}

/** Give the object to the available group member with the fewest open items (round-robin on ties). */
function loadBalance(sim: SimState, idx: Index, obj: SimObject, node: Extract<WfNode, { type: 'user' }>, loads: Map<Id, number>, actor?: string): boolean {
  const members = availableMembers(idx, node.data)
  if (members.length === 0) return false
  const n = members.length
  const cursor = (sim.rrCursor[node.id] ?? 0) % n
  let best = members[cursor]!
  let bestLoad = Infinity
  let bestAt = cursor
  for (let i = 0; i < n; i++) {
    const at = (cursor + i) % n
    const u = members[at]!
    const l = loads.get(u.id) ?? 0
    if (l < bestLoad) {
      best = u
      bestLoad = l
      bestAt = at
    }
  }
  sim.rrCursor[node.id] = (bestAt + 1) % n
  loads.set(best.id, bestLoad + 1)
  const text = actor ? `Redistributed to ${best.name} by ${actor}` : `Load balanced to ${best.name} (${bestLoad} open before)`
  assign(sim, obj, best.id, actor ? 'reassigned' : 'assigned', text, actor)
  return true
}

function distributeOnArrival(sim: SimState, idx: Index, obj: SimObject, node: Extract<WfNode, { type: 'user' }>) {
  const d = node.data
  obj.state = 'unassigned'
  switch (d.distribution) {
    case 'direct':
      if (d.userId) assign(sim, obj, d.userId, 'assigned', `Assigned directly to ${userName(idx, d.userId)}`)
      return
    case 'load-balance':
      loadBalance(sim, idx, obj, node, openLoads(sim))
      return
    case 'queue': {
      const g = d.groupId ? idx.group.get(d.groupId) : undefined
      audit(sim, obj, { kind: 'entered', nodeId: node.id, text: `Waiting in the ${g?.name ?? 'group'} queue` })
      return
    }
    case 'manager': {
      const sup = d.supervisorId ?? (d.groupId ? idx.group.get(d.groupId)?.supervisorId : undefined)
      audit(sim, obj, { kind: 'entered', nodeId: node.id, text: `Awaiting distribution by ${userName(idx, sup)}` })
      return
    }
  }
}

function userNodes(idx: Index): Array<Extract<WfNode, { type: 'user' }>> {
  const out: Array<Extract<WfNode, { type: 'user' }>> = []
  for (const wf of idx.ctx.app.workflows) for (const n of wf.nodes) if (n.type === 'user') out.push(n)
  return out
}

// ---------- The clock ----------

/** Advance the simulation by `minutes` of simulated time, one minute at a time. */
export function advance(sim: SimState, ctx: Ctx, minutes: number) {
  const idx = buildIndex(ctx)
  const end = sim.clock + minutes
  while (sim.clock < end - 1e-9) {
    sim.clock = Math.min(end, sim.clock + 1)
    arrivals(sim, idx)
    finishAutomated(sim, idx)
    finishWork(sim, idx)
    retryStuck(sim, idx)
    supervise(sim, idx)
    pullWork(sim, idx)
    const last = sim.series[sim.series.length - 1]
    if (!last || sim.clock - last.t >= 15) {
      sim.series.push({ t: Math.floor(sim.clock), wip: sim.activeIds.length, done: sim.completed + sim.rejected })
      if (sim.series.length > 3000) sim.series.splice(0, sim.series.length - 3000)
    }
  }
}

function creatorFor(sim: SimState, idx: Index, type: ObjectType): string {
  const creatorGroups = Object.entries(type.permissions)
    .filter(([, p]) => p.create)
    .map(([gid]) => idx.group.get(gid))
  const people = creatorGroups.flatMap((g) => g?.memberIds ?? [])
  return pick(sim, people) ?? 'Intake service'
}

function arrivals(sim: SimState, idx: Index) {
  if (!sim.arrivals) return
  for (const wf of idx.ctx.app.workflows) {
    if (!(wf.arrivalsPerHour > 0)) {
      delete sim.nextArrival[wf.id]
      continue
    }
    sim.nextArrival[wf.id] ??= sim.clock + expMinutes(sim, wf.arrivalsPerHour)
    let guard = 0
    while (sim.nextArrival[wf.id]! <= sim.clock && guard++ < 50) {
      generateObject(sim, idx, wf)
      sim.nextArrival[wf.id]! += expMinutes(sim, wf.arrivalsPerHour)
    }
  }
}

function generateObject(sim: SimState, idx: Index, wf: Workflow): SimObject | undefined {
  const type = idx.type.get(wf.objectTypeId)
  if (!type) return undefined
  const creator = creatorFor(sim, idx, type)
  return createObject(sim, idx.ctx, wf.id, (number) => generateData(sim, type, idx.ctx.app.lists, idx.ctx.users, sim.clock, number), creator, idx)
}

/** Create `count` random objects right now (a "burst" of arrivals). */
export function burst(sim: SimState, ctx: Ctx, workflowId: Id, count: number): number {
  const idx = buildIndex(ctx)
  const wf = idx.wf.get(workflowId)
  if (!wf) return 0
  let made = 0
  for (let i = 0; i < count; i++) if (generateObject(sim, idx, wf)) made++
  return made
}

function active(sim: SimState): SimObject[] {
  const out: SimObject[] = []
  for (const id of sim.activeIds) {
    const o = sim.objects[id]
    if (o) out.push(o)
  }
  return out
}

function finishAutomated(sim: SimState, idx: Index) {
  for (const obj of active(sim)) {
    if (obj.state !== 'auto' || obj.dueAt === undefined || obj.dueAt > sim.clock) continue
    const node = idx.node.get(obj.nodeId)?.node
    if (!node || node.type !== 'auto') {
      markStuck(sim, obj, 'This step was removed from the map')
      continue
    }
    applyActions(sim, idx, obj, node.data.actions)
    audit(sim, obj, { kind: 'auto', nodeId: node.id, text: `${node.data.label} completed automatically` })
    advanceFrom(sim, idx, obj, undefined, 0)
  }
}

function finishWork(sim: SimState, idx: Index) {
  for (const obj of active(sim)) {
    if (obj.state !== 'working' || obj.dueAt === undefined || obj.dueAt > sim.clock) continue
    const node = idx.node.get(obj.nodeId)?.node
    if (!node || node.type !== 'user') {
      freeWorker(sim, obj)
      markStuck(sim, obj, 'This step was removed from the map')
      continue
    }
    const outcome = weightedPick(sim, node.data.outcomes, (o) => o.weight)
    const comment = outcome && (outcome.requireComment || rand(sim) < 0.35) ? commentFor(sim, outcome.label) : undefined
    release(sim, idx, obj, outcome?.id, comment)
  }
}

function freeWorker(sim: SimState, obj: SimObject) {
  if (!obj.userId) return
  const st = ustat(sim, obj.userId)
  if (st.currentId === obj.id) {
    st.currentId = undefined
    st.busyMinutes += sim.clock - (obj.startedAt ?? sim.clock)
  }
}

function release(sim: SimState, idx: Index, obj: SimObject, outcomeId: Id | undefined, comment: string | undefined, actor?: string) {
  const node = idx.node.get(obj.nodeId)?.node
  if (!node || node.type !== 'user') return
  const outcome: Outcome | undefined = node.data.outcomes.find((o) => o.id === outcomeId)
  const worker = obj.userId
  if (worker) {
    freeWorker(sim, obj)
    ustat(sim, worker).completed++
  }
  const who = actor ? (worker ? `${actor} (for ${userName(idx, worker)})` : actor) : userName(idx, worker)
  audit(sim, obj, {
    kind: 'released',
    nodeId: node.id,
    userId: worker,
    actor,
    text: `${who} released ${node.data.label} as "${outcome?.label ?? 'Done'}"`,
    comment,
  })
  if (outcome) applyActions(sim, idx, obj, outcome.actions, worker)
  advanceFrom(sim, idx, obj, outcomeId, 0)
}

function retryStuck(sim: SimState, idx: Index) {
  for (const obj of active(sim)) {
    if (obj.state !== 'stuck') continue
    const node = idx.node.get(obj.nodeId)?.node
    if (!node) continue
    const choice = chooseEdge(idx, obj, node, obj.pendingOutcomeId)
    if (!choice.edge) continue
    audit(sim, obj, { kind: 'moved', nodeId: node.id, text: `Path fixed in the map; continuing to ${nodeLabel(idx, choice.edge.target)}` })
    advanceFrom(sim, idx, obj, obj.pendingOutcomeId, 0)
  }
}

function supervise(sim: SimState, idx: Index) {
  let loads: Map<Id, number> | undefined
  const waiting = new Map<Id, SimObject[]>()
  for (const o of active(sim)) {
    if (o.state !== 'unassigned') continue
    const list = waiting.get(o.nodeId) ?? []
    list.push(o)
    waiting.set(o.nodeId, list)
  }
  for (const node of userNodes(idx)) {
    const d = node.data
    const pending = (waiting.get(node.id) ?? []).sort((a, b) => a.enteredAt - b.enteredAt)
    if (d.distribution === 'load-balance') {
      // Members may have become available since the object arrived.
      if (!pending.length) continue
      loads ??= openLoads(sim)
      for (const o of pending) if (!loadBalance(sim, idx, o, node, loads)) break
    } else if (d.distribution === 'direct') {
      if (d.userId) for (const o of pending) assign(sim, o, d.userId, 'assigned', `Assigned directly to ${userName(idx, d.userId)}`)
    } else if (d.distribution === 'manager' && d.autoDistribute) {
      const last = sim.lastDistribution[node.id]
      if (last === undefined) {
        sim.lastDistribution[node.id] = sim.clock
        continue
      }
      if (sim.clock - last < Math.max(5, d.distributeEveryMinutes)) continue
      sim.lastDistribution[node.id] = sim.clock
      const members = availableMembers(idx, d)
      if (!members.length || !pending.length) continue
      const sup = d.supervisorId ?? (d.groupId ? idx.group.get(d.groupId)?.supervisorId : undefined)
      const supName = userName(idx, sup)
      // A supervisor's judgment, not an algorithm: favors faster people, so loads end up uneven.
      for (const o of pending) {
        const u = weightedPick(sim, members, (m) => 1 / (m.speed * m.speed))!
        assign(sim, o, u.id, 'assigned', `${supName} assigned it to ${u.name}`, supName)
      }
    }
  }
}

function pullWork(sim: SimState, idx: Index) {
  const baskets = new Map<Id, SimObject[]>()
  const queues = new Map<Id, SimObject[]>()
  for (const o of active(sim)) {
    if (o.state === 'assigned' && o.userId) {
      const b = baskets.get(o.userId) ?? []
      b.push(o)
      baskets.set(o.userId, b)
    } else if (o.state === 'unassigned') {
      const node = idx.node.get(o.nodeId)?.node
      if (node?.type === 'user' && node.data.distribution === 'queue') {
        const q = queues.get(node.id) ?? []
        q.push(o)
        queues.set(node.id, q)
      }
    }
  }
  for (const b of baskets.values()) b.sort((a, c) => (a.assignedAt ?? 0) - (c.assignedAt ?? 0))
  for (const q of queues.values()) q.sort((a, c) => a.enteredAt - c.enteredAt)

  const queueNodesByUser = new Map<Id, Id[]>()
  for (const node of userNodes(idx)) {
    if (node.data.distribution !== 'queue' || !node.data.groupId) continue
    for (const uid of idx.group.get(node.data.groupId)?.memberIds ?? []) {
      const l = queueNodesByUser.get(uid) ?? []
      l.push(node.id)
      queueNodesByUser.set(uid, l)
    }
  }

  const users = idx.ctx.users
  const n = users.length
  const offset = n ? Math.floor(sim.clock) % n : 0
  for (let i = 0; i < n; i++) {
    const u = users[(offset + i) % n]!
    if (!u.available) continue
    const st = ustat(sim, u.id)
    if (st.currentId) {
      const cur = sim.objects[st.currentId]
      if (cur && cur.state === 'working' && cur.userId === u.id) continue
      st.currentId = undefined
    }
    let next = baskets.get(u.id)?.shift()
    if (!next) {
      // Fetch: take the oldest item from any queue this user can work.
      let bestQ: SimObject[] | undefined
      for (const nodeId of queueNodesByUser.get(u.id) ?? []) {
        const q = queues.get(nodeId)
        if (q?.length && (!bestQ || q[0]!.enteredAt < bestQ[0]!.enteredAt)) bestQ = q
      }
      const fetched = bestQ?.shift()
      if (fetched) {
        assign(sim, fetched, u.id, 'fetched', `${u.name} fetched it from the queue`)
        next = fetched
      }
    }
    if (next) startWork(sim, idx, next, u)
  }
}

function startWork(sim: SimState, idx: Index, obj: SimObject, u: User) {
  const node = idx.node.get(obj.nodeId)?.node
  if (!node || node.type !== 'user') return
  obj.state = 'working'
  obj.startedAt = sim.clock
  obj.dueAt = sim.clock + workDuration(sim, node.data.avgMinutes, u.speed)
  ustat(sim, u.id).currentId = obj.id
  const s = stat(sim, node.id)
  s.waitTotal += sim.clock - obj.enteredAt
  s.waitCount++
  audit(sim, obj, { kind: 'started', nodeId: node.id, userId: u.id, text: `${u.name} started working on it` })
}

// ---------- Actions ----------

function resolveValue(sim: SimState, idx: Index, obj: SimObject, raw: string, fieldType: string | undefined, currentUser?: Id): unknown {
  const v = raw.trim()
  if (v === '{currentUser}') return currentUser
  const today = /^\{today([+-]\d+)?\}$/.exec(v)
  if (today) {
    const offset = Number(today[1] ?? 0)
    return isoDay(new Date(simDate(sim.clock).getTime() + offset * 86_400_000))
  }
  if (fieldType === 'boolean') return /^(true|yes|1)$/i.test(v)
  if (fieldType === 'number' || fieldType === 'currency') return Number(v)
  return v.replace(/\{number\}/g, obj.number).replace(/\{seq\}/g, () => String(randInt(sim, 10000, 99999))).replace(/\{currentUser\}/g, userName(idx, currentUser))
}

function displayValue(idx: Index, type: ObjectType | undefined, fieldId: Id, value: unknown): string {
  const f = type?.fields.find((x) => x.id === fieldId)
  if (!f) return String(value)
  if (f.type === 'boolean') return value ? 'Yes' : 'No'
  if (f.type === 'user') return userName(idx, value as Id)
  if (f.type === 'currency') return currencyFmt.format(Number(value) || 0)
  if (f.type === 'date' && typeof value === 'string') {
    const d = new Date(`${value}T00:00:00`)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return String(value ?? '')
}

function applyActions(sim: SimState, idx: Index, obj: SimObject, actions: ActionDef[], currentUser?: Id) {
  const type = idx.type.get(obj.typeId)
  for (const a of actions) {
    if (a.kind === 'setField') {
      const f = type?.fields.find((x) => x.id === a.fieldId)
      if (!f) continue
      const value = resolveValue(sim, idx, obj, a.value, f.type, currentUser)
      obj.data[f.id] = value
      audit(sim, obj, { kind: 'field', nodeId: obj.nodeId, text: `${f.label} set to ${displayValue(idx, type, f.id, value)}` })
    } else if (a.kind === 'notify') {
      const msg = String(resolveValue(sim, idx, obj, a.message, 'text', currentUser))
      audit(sim, obj, { kind: 'notify', nodeId: obj.nodeId, text: `Email to ${a.to || 'recipient'}: “${msg}”` })
    } else if (a.kind === 'integration') {
      const ok = rand(sim) < a.successRate
      if (a.resultFieldId) {
        const f = type?.fields.find((x) => x.id === a.resultFieldId)
        if (f) obj.data[f.id] = f.type === 'boolean' ? ok : ok ? 'OK' : 'FAILED'
      }
      audit(sim, obj, { kind: 'integration', nodeId: obj.nodeId, text: `${a.system}: ${ok ? 'success' : 'no match'}` })
    }
  }
}

// ---------- Administrator operations ----------

function userStepOf(idx: Index, obj: SimObject) {
  const node = idx.node.get(obj.nodeId)?.node
  return node?.type === 'user' ? node : undefined
}

export function adminAssign(sim: SimState, ctx: Ctx, objectId: Id, userId: Id, actor = ADMIN): boolean {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active' || !userStepOf(idx, obj)) return false
  if (obj.userId === userId && (obj.state === 'assigned' || obj.state === 'working')) return false
  const prev = obj.userId
  freeWorker(sim, obj)
  const text = prev ? `Reassigned from ${userName(idx, prev)} to ${userName(idx, userId)} by ${actor}` : `Assigned to ${userName(idx, userId)} by ${actor}`
  assign(sim, obj, userId, 'reassigned', text, actor)
  return true
}

export function adminReturnToPool(sim: SimState, ctx: Ctx, objectId: Id, actor = ADMIN): boolean {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  const node = obj && userStepOf(idx, obj)
  if (!obj || !node || obj.state === 'unassigned') return false
  const prev = obj.userId
  freeWorker(sim, obj)
  obj.state = 'unassigned'
  obj.userId = undefined
  obj.assignedAt = undefined
  obj.startedAt = undefined
  obj.dueAt = undefined
  audit(sim, obj, { kind: 'returned', nodeId: obj.nodeId, actor, text: `Taken from ${userName(idx, prev)} and returned to the pool by ${actor}` })
  return true
}

/** Even out everything not yet being worked at a step across its available members. */
export function adminRedistribute(sim: SimState, ctx: Ctx, nodeId: Id, actor = ADMIN): number {
  const idx = buildIndex(ctx)
  const node = idx.node.get(nodeId)?.node
  if (!node || node.type !== 'user') return 0
  const movable = active(sim)
    .filter((o) => o.nodeId === nodeId && (o.state === 'assigned' || o.state === 'unassigned'))
    .sort((a, b) => a.enteredAt - b.enteredAt)
  if (!availableMembers(idx, node.data).length) return 0
  const before = new Map(movable.map((o) => [o.id, o.userId]))
  for (const o of movable) {
    o.state = 'unassigned'
    o.userId = undefined
  }
  const loads = openLoads(sim)
  let moved = 0
  for (const o of movable) {
    const prev = before.get(o.id)
    if (!loadBalance(sim, idx, o, node, loads, actor)) break
    if (o.userId !== prev) moved++
  }
  return moved
}

export function adminMove(sim: SimState, ctx: Ctx, objectId: Id, nodeId: Id, actor = ADMIN): boolean {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active' || !idx.node.has(nodeId) || obj.nodeId === nodeId) return false
  freeWorker(sim, obj)
  const from = nodeLabel(idx, obj.nodeId)
  const s = stat(sim, obj.nodeId)
  s.exited++
  s.timeInStep += sim.clock - obj.enteredAt
  audit(sim, obj, { kind: 'moved', nodeId: obj.nodeId, actor, text: `Moved from ${from} to ${nodeLabel(idx, nodeId)} by ${actor}` })
  enterNode(sim, idx, obj, nodeId, 0)
  return true
}

/** Release on behalf of the assignee (or nobody) with an outcome and comment. */
export function adminRelease(sim: SimState, ctx: Ctx, objectId: Id, outcomeId: Id, comment: string, actor = ADMIN): boolean {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active' || !userStepOf(idx, obj)) return false
  release(sim, idx, obj, outcomeId, comment.trim() || undefined, actor)
  return true
}

export function adminUpdateData(sim: SimState, ctx: Ctx, objectId: Id, patch: Record<string, unknown>, actor = ADMIN) {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj) return
  const type = idx.type.get(obj.typeId)
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(obj.data[k]) === JSON.stringify(v)) continue
    obj.data[k] = v
    const f = type?.fields.find((x) => x.id === k)
    if (f && f.type !== 'attachment') audit(sim, obj, { kind: 'field', nodeId: obj.nodeId, actor, text: `${f.label} changed to ${displayValue(idx, type, k, v) || '(blank)'} by ${actor}` })
    else if (f) audit(sim, obj, { kind: 'field', nodeId: obj.nodeId, actor, text: `${f.label} updated by ${actor}` })
  }
}

// ---------- Read model for the UI ----------

export interface NodeMetrics {
  total: number
  unassigned: number
  assigned: number
  working: number
  stuck: number
  automated: number
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

export interface SimView {
  clock: number
  nodes: Record<Id, NodeMetrics>
  users: Record<Id, { open: number; working: boolean; currentId?: Id; completed: number; busyMinutes: number }>
  created: number
  active: number
  completed: number
  rejected: number
  stuck: number
  avgCycle: number
  bottleneckId?: Id
}

export function computeView(sim: SimState, ctx: Ctx): SimView {
  const idx = buildIndex(ctx)
  const nodes: Record<Id, NodeMetrics> = {}
  const blank = (): NodeMetrics => ({
    total: 0,
    unassigned: 0,
    assigned: 0,
    working: 0,
    stuck: 0,
    automated: 0,
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
  for (const [id] of idx.node) nodes[id] = blank()
  const users: SimView['users'] = {}
  for (const u of ctx.users) {
    const st = sim.users[u.id]
    users[u.id] = { open: 0, working: false, currentId: st?.currentId, completed: st?.completed ?? 0, busyMinutes: st?.busyMinutes ?? 0 }
  }
  let stuck = 0
  for (const o of active(sim)) {
    const m = (nodes[o.nodeId] ??= blank())
    m.total++
    m.oldestAge = Math.max(m.oldestAge, sim.clock - o.enteredAt)
    const node = idx.node.get(o.nodeId)?.node
    if (node?.type === 'user' && node.data.slaHours && sim.clock - o.enteredAt > node.data.slaHours * 60) m.slaBreaches++
    switch (o.state) {
      case 'unassigned':
        m.unassigned++
        break
      case 'assigned':
      case 'working': {
        if (o.state === 'assigned') m.assigned++
        else m.working++
        if (o.userId) {
          const b = (m.byUser[o.userId] ??= { assigned: 0, working: 0 })
          if (o.state === 'assigned') b.assigned++
          else b.working++
          const u = users[o.userId]
          if (u) {
            u.open++
            if (o.state === 'working') u.working = true
          }
        }
        break
      }
      case 'stuck':
        m.stuck++
        stuck++
        break
      default:
        m.automated++
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
      m.availableMembers = availableMembers(idx, node.data).length
      const perWorker = m.total / Math.max(1, node.data.distribution === 'direct' ? 1 : m.availableMembers)
      m.heat = m.total === 0 ? 0 : perWorker < 2 ? 1 : perWorker < 5 ? 2 : 3
      if (m.slaBreaches > 0 && m.heat < 2) m.heat = 2
      if (m.stuck > 0) m.heat = 3
      const score = m.total * (1 + m.oldestAge / 60)
      if (m.total >= 5 && score > worst) {
        worst = score
        bottleneckId = id
      }
    } else {
      m.heat = m.stuck > 0 ? 3 : m.total > 0 ? 1 : 0
    }
  }
  const finished = sim.completed + sim.rejected
  return {
    clock: sim.clock,
    nodes,
    users,
    created: sim.created,
    active: sim.activeIds.length,
    completed: sim.completed,
    rejected: sim.rejected,
    stuck,
    avgCycle: finished ? sim.cycleTotal / finished : 0,
    bottleneckId,
  }
}
