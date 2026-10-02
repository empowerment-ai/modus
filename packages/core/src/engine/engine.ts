// The process engine: a discrete-time engine that moves work through the
// workflow map exactly as the designer describes it. Each item (SimObject) has
// one or more tokens — one per parallel branch — and every function here
// mutates the SimState it is given.
//
// The same engine powers the browser simulation (with simulated people and
// services) and is written to move behind a server unchanged: it does no I/O,
// reads the design on every call (so live edits apply), and is deterministic
// for a given seed.

import { describeCondition, evaluateCondition } from '../model/conditions'
import type {
  ActionDef,
  App,
  AutoStepData,
  Group,
  Id,
  NodeOf,
  ObjectType,
  Outcome,
  Priority,
  ServiceDef,
  ServiceOperation,
  User,
  WfEdge,
  WfNode,
  Workflow,
} from '../model/types'
import { AUTO_FAILURE, AUTO_SUCCESS } from '../model/types'
import { currencyFmt, isoDay, simDate } from '../model/util'
import { commentFor, generateData } from './generate'
import { expMinutes, pick, rand, randInt, weightedPick } from './rng'
import {
  type AuditEntry,
  type AuditKind,
  byUrgency,
  type Ctx,
  type ForkFrame,
  type NodeStat,
  PRIORITIES,
  PRIORITY_RANK,
  type ServiceStat,
  type SimObject,
  type SimState,
  type Token,
  type UserStat,
} from './state'

export * from './state'

// ---------- Index over the design (rebuilt per call so live edits apply) ----------

export interface Index {
  ctx: Ctx
  wf: Map<Id, Workflow>
  node: Map<Id, { node: WfNode; wf: Workflow }>
  out: Map<Id, WfEdge[]>
  type: Map<Id, ObjectType>
  user: Map<Id, User>
  group: Map<Id, Group>
  service: Map<Id, ServiceDef>
  manual: Set<Id>
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
    service: new Map((ctx.services ?? []).map((s) => [s.id, s])),
    manual: new Set(ctx.manualUserIds ?? []),
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

export const userName = (idx: Index, id?: Id) => (id ? (idx.user.get(id)?.name ?? 'Unknown user') : 'nobody')

export function nodeLabel(idx: Index, id: Id): string {
  return idx.node.get(id)?.node.data.label ?? 'a removed step'
}

export function stat(sim: SimState, nodeId: Id): NodeStat {
  return (sim.nodeStats[nodeId] ??= { entered: 0, exited: 0, timeInStep: 0, waitTotal: 0, waitCount: 0 })
}

export function ustat(sim: SimState, userId: Id): UserStat {
  return (sim.users[userId] ??= { completed: 0, busyMinutes: 0 })
}

export function sstat(sim: SimState, serviceId: Id): ServiceStat {
  return (sim.services[serviceId] ??= { inFlight: 0, calls: 0, ok: 0, failed: 0, busyMinutes: 0 })
}

const FEED_KINDS: AuditKind[] = [
  'created',
  'released',
  'completed',
  'reassigned',
  'delegated',
  'distributed',
  'moved',
  'returned',
  'stuck',
  'fetched',
  'claimed',
  'escalated',
  'manual',
  'security',
  'split',
  'joined',
]

export function audit(sim: SimState, obj: SimObject, entry: Omit<AuditEntry, 'at'>) {
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

// ---------- Tokens ----------

export function activeObjects(sim: SimState): SimObject[] {
  const out: SimObject[] = []
  for (const id of sim.activeIds) {
    const o = sim.objects[id]
    if (o) out.push(o)
  }
  return out
}

/** Every live token of the application, across all items. */
export function activeTokens(sim: SimState): Token[] {
  const out: Token[] = []
  for (const id of sim.activeIds) {
    const o = sim.objects[id]
    if (o) for (const t of o.tokens) out.push(t)
  }
  return out
}

/** Token ids embed their item id ("o12~3"), so lookups don't need a separate index. */
export function findToken(sim: SimState, tokenId: Id): { obj: SimObject; tok: Token } | undefined {
  const objId = tokenId.slice(0, tokenId.lastIndexOf('~'))
  const obj = sim.objects[objId]
  const tok = obj?.tokens.find((t) => t.id === tokenId)
  return obj && tok ? { obj, tok } : undefined
}

const objectOf = (sim: SimState) => (t: Token) => sim.objects[t.objectId]

function newToken(sim: SimState, obj: SimObject, from: Pick<Token, 'workflowId' | 'nodeId' | 'forks' | 'calls'>): Token {
  const t: Token = {
    id: `${obj.id}~${++obj.tokenSeq}`,
    objectId: obj.id,
    workflowId: from.workflowId,
    nodeId: from.nodeId,
    enteredAt: sim.clock,
    state: 'auto',
    forks: from.forks.map((f) => ({ ...f })),
    calls: from.calls.map((c) => ({ ...c })),
  }
  obj.tokens.push(t)
  return t
}

/** Take a token out of the item (it finished, merged, or was withdrawn). */
function dropToken(sim: SimState, obj: SimObject, tok: Token) {
  freeWorker(sim, tok)
  releaseServiceSlot(sim, tok)
  obj.tokens = obj.tokens.filter((t) => t !== tok)
}

// ---------- Object lifecycle ----------

export function nextNumber(sim: SimState, type: ObjectType): string {
  return `${type.numberPrefix}${1001 + sim.seq}`
}

/** Priority from the type's priority field (labels containing low / high / urgent / critical). */
export function priorityFrom(type: ObjectType, data: Record<string, unknown>, lists: App['lists']): Priority {
  const f = type.priorityFieldId ? type.fields.find((x) => x.id === type.priorityFieldId) : undefined
  if (!f) return 'normal'
  const raw = data[f.id]
  const label = f.type === 'choice' ? lists.find((l) => l.id === f.listId)?.items.find((i) => i.id === raw)?.label : String(raw ?? '')
  if (!label) return 'normal'
  if (/urgent|critical|p1|emergency/i.test(label)) return 'urgent'
  if (/high|p2/i.test(label)) return 'high'
  if (/low|p4/i.test(label)) return 'low'
  return 'normal'
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
  const values = typeof data === 'function' ? data(number) : { ...data }
  const obj: SimObject = {
    id: `o${sim.seq}`,
    number,
    typeId: type.id,
    workflowId,
    data: values,
    createdAt: sim.clock,
    createdBy,
    status: 'active',
    priority: priorityFrom(type, values, ctx.app.lists),
    dueBy: wf.targetHours ? sim.clock + wf.targetHours * 60 : undefined,
    tokens: [],
    tokenSeq: 0,
    passed: [],
    history: [],
  }
  sim.objects[obj.id] = obj
  sim.activeIds.push(obj.id)
  sim.created++
  const byName = idx.user.get(createdBy)?.name ?? createdBy
  audit(sim, obj, { kind: 'created', userId: idx.user.has(createdBy) ? createdBy : undefined, text: `${type.name} created by ${byName}` })
  const start = wf.nodes.find((n) => n.type === 'start')
  const tok = newToken(sim, obj, { workflowId, nodeId: start?.id ?? '', forks: [], calls: [] })
  if (!start) {
    markStuck(sim, obj, tok, 'This workflow has no start step')
    return obj
  }
  enterNode(sim, idx, obj, tok, start.id, 0)
  return obj
}

export function markStuck(sim: SimState, obj: SimObject, tok: Token, reason: string, pendingOutcomeId?: Id) {
  const changed = tok.state !== 'stuck' || tok.stuckReason !== reason
  freeWorker(sim, tok)
  releaseServiceSlot(sim, tok)
  tok.state = 'stuck'
  tok.stuckReason = reason
  tok.pendingOutcomeId = pendingOutcomeId
  tok.userId = undefined
  tok.waitReason = undefined
  if (changed) audit(sim, obj, { kind: 'stuck', nodeId: tok.nodeId, tokenId: tok.id, text: `Stuck: ${reason}` })
}

export function enterNode(sim: SimState, idx: Index, obj: SimObject, tok: Token, nodeId: Id, hops: number) {
  const found = idx.node.get(nodeId)
  freeWorker(sim, tok)
  releaseServiceSlot(sim, tok)
  tok.nodeId = nodeId
  tok.enteredAt = sim.clock
  tok.userId = undefined
  tok.assignedAt = undefined
  tok.startedAt = undefined
  tok.dueAt = undefined
  tok.pendingOutcomeId = undefined
  tok.stuckReason = undefined
  tok.waitReason = undefined
  tok.attempt = undefined
  tok.manual = undefined
  tok.escalated = undefined
  tok.state = 'auto'
  if (!found) return markStuck(sim, obj, tok, 'This step was removed from the map')
  const { node, wf } = found
  tok.workflowId = wf.id
  stat(sim, node.id).entered++

  switch (node.type) {
    case 'start':
    case 'decision':
      return advanceFrom(sim, idx, obj, tok, undefined, hops)
    case 'split':
      return split(sim, idx, obj, tok, node, hops)
    case 'join':
      return arriveAtJoin(sim, idx, obj, tok, node, hops)
    case 'subflow':
      return callSubflow(sim, idx, obj, tok, node, hops)
    case 'wait':
      tok.state = 'waiting'
      tok.dueAt = sim.clock + Math.max(1, Math.round(node.data.minutes))
      tok.waitReason = `Timer: ${node.data.minutes} min`
      audit(sim, obj, { kind: 'waiting', nodeId: node.id, tokenId: tok.id, text: `${node.data.label}: waiting ${node.data.minutes} min` })
      return
    case 'auto':
      return startAutomated(sim, idx, tok, node)
    case 'user':
      audit(sim, obj, { kind: 'entered', nodeId: node.id, tokenId: tok.id, text: `Arrived at ${node.data.label}` })
      return distributeOnArrival(sim, idx, obj, tok, node)
    case 'end':
      return reachEnd(sim, idx, obj, tok, node)
  }
}

// ---------- Routing ----------

interface Choice {
  edge?: WfEdge
  reason?: string
  matched?: string
}

function ruleBranches(idx: Index, obj: SimObject, out: WfEdge[]): { matches: WfEdge[]; fallback?: WfEdge; conditional: WfEdge[] } {
  const type = idx.type.get(obj.typeId)
  const conditional = out
    .filter((e) => !e.data.isDefault && e.data.condition && e.data.condition.rules.length > 0)
    .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
  const matches = type ? conditional.filter((e) => evaluateCondition(e.data.condition, type, obj.data)) : []
  const fallback = out.find((e) => e.data.isDefault) ?? out.find((e) => !e.data.condition || e.data.condition.rules.length === 0)
  return { matches, fallback, conditional }
}

export function chooseEdge(idx: Index, obj: SimObject, node: WfNode, outcomeId?: Id): Choice {
  const out = idx.out.get(node.id) ?? []
  if (out.length === 0) return { reason: `No path leaves "${node.data.label}"` }

  if (node.type === 'user' || node.type === 'auto' || node.type === 'subflow') {
    if (outcomeId) {
      const e = out.find((x) => x.data.outcomeId === outcomeId)
      if (e) return { edge: e }
    }
    const generic = out.filter((x) => !x.data.outcomeId)
    // Failures and rejections never take the "normal" path by accident.
    const unhappy = outcomeId === AUTO_FAILURE || outcomeId === 'rejected' || outcomeId === 'cancelled'
    if (!unhappy) {
      if (generic.length === 1) return { edge: generic[0] }
      if (out.length === 1 && node.type === 'user') return { edge: out[0] }
    }
    const label =
      node.type === 'user'
        ? (node.data.outcomes.find((o) => o.id === outcomeId)?.label ?? 'this outcome')
        : outcomeId === AUTO_FAILURE
          ? 'Failed'
          : (outcomeId ?? 'this result')
    return { reason: `No path for "${label}" from "${node.data.label}"` }
  }

  const { matches, fallback, conditional } = ruleBranches(idx, obj, out)
  const type = idx.type.get(obj.typeId)
  if (matches[0] && type) {
    return { edge: matches[0], matched: describeCondition(matches[0].data.condition, { type, lists: idx.ctx.app.lists, users: idx.ctx.users }) }
  }
  if (fallback) return { edge: fallback, matched: conditional.length ? 'Otherwise' : undefined }
  return { reason: `No rule in "${node.data.label}" matched and there is no "Otherwise" path` }
}

export function advanceFrom(sim: SimState, idx: Index, obj: SimObject, tok: Token, outcomeId: Id | undefined, hops: number): void {
  const found = idx.node.get(tok.nodeId)
  if (!found) return markStuck(sim, obj, tok, 'This step was removed from the map', outcomeId)
  if (hops > 60) return markStuck(sim, obj, tok, 'Routing loop detected (60 instant hops)', outcomeId)
  const { node } = found
  const choice = chooseEdge(idx, obj, node, outcomeId)
  if (!choice.edge) {
    // A subflow that ended rejected/cancelled with no path for it ends the caller the same way.
    if (node.type === 'subflow' && (outcomeId === 'rejected' || outcomeId === 'cancelled')) {
      return finishScope(sim, idx, obj, tok, outcomeId, `${node.data.label} ended ${outcomeId}`)
    }
    return markStuck(sim, obj, tok, choice.reason ?? 'No path', outcomeId)
  }
  const edge = choice.edge
  if (node.type === 'decision') {
    audit(sim, obj, { kind: 'decision', nodeId: node.id, tokenId: tok.id, text: `${node.data.label}: ${choice.matched ?? 'matched'} → ${nodeLabel(idx, edge.target)}` })
  }
  leave(sim, idx, obj, tok, edge, outcomeId)
  enterNode(sim, idx, obj, tok, edge.target, hops + 1)
}

function leave(sim: SimState, idx: Index, obj: SimObject, tok: Token, edge: WfEdge, outcomeId?: Id) {
  const s = stat(sim, tok.nodeId)
  s.exited++
  s.timeInStep += sim.clock - tok.enteredAt
  if (obj.passed[obj.passed.length - 1] !== tok.nodeId) obj.passed.push(tok.nodeId)
  if (obj.passed.length > 400) obj.passed.splice(0, obj.passed.length - 400)
  countEdge(sim, idx, obj, edge, outcomeId)
}

function countEdge(sim: SimState, idx: Index, obj: SimObject, edge: WfEdge, outcomeId?: Id) {
  sim.edgeCounts[edge.id] = (sim.edgeCounts[edge.id] ?? 0) + 1
  const src = idx.node.get(edge.source)?.node
  const outcomeLabel = src?.type === 'user' ? (src.data.outcomes.find((o) => o.id === (edge.data.outcomeId ?? outcomeId))?.label ?? '') : ''
  const target = idx.node.get(edge.target)?.node
  const reject =
    /reject|deny/i.test(outcomeLabel) ||
    edge.data.outcomeId === AUTO_FAILURE ||
    edge.data.outcomeId === 'rejected' ||
    (target?.type === 'end' && target.data.result !== 'completed')
  sim.flights.push({ edgeId: edge.id, objectId: obj.id, reject })
  if (sim.flights.length > 400) sim.flights.splice(0, sim.flights.length - 400)
}

// ---------- Parallel split / join ----------

function split(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'split'>, hops: number) {
  const out = idx.out.get(node.id) ?? []
  let branches: WfEdge[]
  if (node.data.mode === 'inclusive') {
    const { matches, fallback } = ruleBranches(idx, obj, out)
    branches = matches.length ? matches : fallback ? [fallback] : []
  } else {
    branches = out
  }
  if (branches.length === 0) {
    return markStuck(sim, obj, tok, out.length ? `No branch of "${node.data.label}" applies` : `No path leaves "${node.data.label}"`)
  }
  const forkId = `f${++sim.forkSeq}`
  sim.forks[forkId] = { objectId: obj.id, splitId: node.id, expected: branches.length, arrived: [], ended: 0, closed: false }
  const frame: ForkFrame = { forkId, splitId: node.id }
  audit(sim, obj, {
    kind: 'split',
    nodeId: node.id,
    tokenId: tok.id,
    text: `${node.data.label}: ${branches.length} parallel branch${branches.length === 1 ? '' : 'es'} → ${branches.map((e) => nodeLabel(idx, e.target)).join(', ')}`,
  })
  const s = stat(sim, node.id)
  s.exited++
  if (obj.passed[obj.passed.length - 1] !== node.id) obj.passed.push(node.id)

  // Create every branch first, then start them: a branch that ends the item at once
  // must be able to withdraw its siblings.
  const starts: Array<{ t: Token; edge: WfEdge }> = branches.map((edge, i) => ({ t: i === 0 ? tok : newToken(sim, obj, tok), edge }))
  for (const { t } of starts) t.forks.push({ ...frame })
  for (const { t, edge } of starts) {
    if (obj.status !== 'active' || !obj.tokens.includes(t)) continue
    countEdge(sim, idx, obj, edge)
    enterNode(sim, idx, obj, t, edge.target, hops + 1)
  }
}

/** The innermost fork frame that belongs to the token's current workflow (not a caller's). */
function currentFrame(tok: Token): ForkFrame | undefined {
  const depth = tok.calls[tok.calls.length - 1]?.forkDepth ?? 0
  return tok.forks.length > depth ? tok.forks[tok.forks.length - 1] : undefined
}

function arriveAtJoin(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'join'>, hops: number) {
  const frame = currentFrame(tok)
  const fork = frame && sim.forks[frame.forkId]
  if (!frame || !fork) {
    // Not part of a split (paths merging after a decision): just pass through.
    if (frame) tok.forks.pop()
    return advanceFrom(sim, idx, obj, tok, undefined, hops)
  }
  if (fork.closed) {
    // The join already continued with the first branch(es); this one is absorbed.
    audit(sim, obj, { kind: 'joined', nodeId: node.id, tokenId: tok.id, text: `${node.data.label}: a later branch arrived and was absorbed` })
    stat(sim, node.id).exited++
    const ended = obj.scopeEnds?.[scopeKey(tok)]
    if (ended && scopePeers(obj, tok).length === 1) {
      // Everything else in this scope already finished: finish it the way it ended.
      tok.forks.length = tok.calls[tok.calls.length - 1]?.forkDepth ?? 0
      maybeDropFork(sim, obj, frame.forkId)
      return finishScope(sim, idx, obj, tok, ended.result, ended.label, ended.nodeId, ended.outcome)
    }
    dropToken(sim, obj, tok)
    maybeDropFork(sim, obj, frame.forkId)
    return
  }
  fork.arrived.push(tok.id)
  tok.state = 'joining'
  evaluateJoin(sim, idx, obj, frame.forkId, hops)
}

function joinNeeds(node: NodeOf<'join'>, fork: { expected: number; ended: number }): number {
  const live = Math.max(1, fork.expected - fork.ended)
  if (node.data.mode === 'any') return 1
  if (node.data.mode === 'count') return Math.max(1, Math.min(node.data.count ?? 1, live))
  return live
}

function evaluateJoin(sim: SimState, idx: Index, obj: SimObject, forkId: Id, hops = 0) {
  const fork = sim.forks[forkId]
  if (!fork || fork.closed) return
  const waiting = fork.arrived.map((id) => obj.tokens.find((t) => t.id === id)).filter((t): t is Token => !!t)
  fork.arrived = waiting.map((t) => t.id)
  const last = waiting[waiting.length - 1]
  if (!last) return
  const node = idx.node.get(last.nodeId)?.node
  if (node?.type !== 'join') return
  const needs = joinNeeds(node, fork)
  if (waiting.length < needs) {
    const more = needs - waiting.length
    for (const t of waiting) t.waitReason = `Waiting for ${more} more branch${more === 1 ? '' : 'es'}`
    return
  }
  // Continue with the last arrival; the others merge into it.
  for (const t of waiting) {
    if (t === last) continue
    stat(sim, node.id).exited++
    stat(sim, node.id).timeInStep += sim.clock - t.enteredAt
    dropToken(sim, obj, t)
  }
  fork.closed = true
  const cut = last.forks.findIndex((f) => f.forkId === forkId)
  if (cut >= 0) last.forks.length = cut
  last.waitReason = undefined
  const desc =
    node.data.mode === 'all'
      ? `all ${waiting.length} branch${waiting.length === 1 ? '' : 'es'} done`
      : `${waiting.length} of ${fork.expected} branches done`
  audit(sim, obj, { kind: 'joined', nodeId: node.id, tokenId: last.id, text: `${node.data.label}: ${desc}; continuing` })
  if (node.data.mode !== 'all' && node.data.cancelRemaining) {
    for (const t of [...obj.tokens]) {
      if (t === last || !t.forks.some((f) => f.forkId === forkId)) continue
      withdraw(sim, idx, obj, t, `${node.data.label} continued without this branch`)
    }
  }
  maybeDropFork(sim, obj, forkId)
  last.state = 'auto'
  advanceFrom(sim, idx, obj, last, undefined, hops)
}

/** Forget a fork once no token carries it any more. */
function maybeDropFork(sim: SimState, obj: SimObject, forkId: Id) {
  const fork = sim.forks[forkId]
  if (!fork) return
  if (fork.closed && !obj.tokens.some((t) => t.forks.some((f) => f.forkId === forkId))) delete sim.forks[forkId]
}

/**
 * A branch finished without reaching its join (an end step, or absorbed). Tell the
 * innermost fork; if that whole fork finished without anyone reaching the join, the
 * branch it was part of is gone too.
 */
function branchGone(sim: SimState, idx: Index, obj: SimObject, frames: ForkFrame[]) {
  for (let i = frames.length - 1; i >= 0; i--) {
    const fork = sim.forks[frames[i]!.forkId]
    if (!fork) return
    if (fork.closed) {
      maybeDropFork(sim, obj, frames[i]!.forkId)
      return
    }
    fork.ended++
    if (fork.arrived.length > 0) {
      evaluateJoin(sim, idx, obj, frames[i]!.forkId)
      return
    }
    if (fork.ended < fork.expected) return
    // Every branch of this fork ended elsewhere: the enclosing branch is gone as well.
    delete sim.forks[frames[i]!.forkId]
  }
}

/** Remove a token from the item while it is still running (cancelled branch). */
function withdraw(sim: SimState, idx: Index, obj: SimObject, tok: Token, why: string) {
  const s = stat(sim, tok.nodeId)
  s.exited++
  s.timeInStep += sim.clock - tok.enteredAt
  if (tok.userId || tok.state === 'auto' || tok.state === 'queued') {
    audit(sim, obj, { kind: 'withdrawn', nodeId: tok.nodeId, tokenId: tok.id, userId: tok.userId, text: `Withdrawn from ${nodeLabel(idx, tok.nodeId)}: ${why}` })
  }
  dropToken(sim, obj, tok)
  for (const f of tok.forks) {
    const fork = sim.forks[f.forkId]
    if (fork) fork.arrived = fork.arrived.filter((id) => id !== tok.id)
    maybeDropFork(sim, obj, f.forkId)
  }
}

// ---------- Subflows ----------

function callSubflow(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'subflow'>, hops: number) {
  const child = node.data.workflowId ? idx.wf.get(node.data.workflowId) : undefined
  if (!child) return markStuck(sim, obj, tok, `“${node.data.label}” doesn’t point to a subflow yet`)
  if (tok.calls.some((c) => c.nodeId === node.id) || tok.calls.length > 8) return markStuck(sim, obj, tok, `“${node.data.label}” calls itself`)
  const start = child.nodes.find((n) => n.type === 'start')
  if (!start) return markStuck(sim, obj, tok, `Subflow “${child.name}” has no start step`)
  tok.calls.push({ callId: `c${++sim.callSeq}`, nodeId: node.id, workflowId: tok.workflowId, forkDepth: tok.forks.length, at: sim.clock })
  audit(sim, obj, { kind: 'subflow', nodeId: node.id, tokenId: tok.id, text: `Entered subflow “${child.name}”` })
  enterNode(sim, idx, obj, tok, start.id, hops + 1)
}

function scopeKey(tok: Token): string {
  return tok.calls[tok.calls.length - 1]?.callId ?? 'root'
}

/** Tokens running in the same subflow call (or, at the top level, the whole item). */
function scopePeers(obj: SimObject, tok: Token): Token[] {
  const call = tok.calls[tok.calls.length - 1]
  if (!call) return obj.tokens
  return obj.tokens.filter((t) => t.calls.some((c) => c.callId === call.callId))
}

function reachEnd(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'end'>) {
  const result = node.data.result
  const terminate = node.data.terminate ?? result !== 'completed'
  const peers = scopePeers(obj, tok)
  stat(sim, node.id).exited++
  if (!terminate && peers.length > 1) {
    // A parallel branch finished; the others carry on.
    audit(sim, obj, { kind: 'joined', nodeId: node.id, tokenId: tok.id, text: `Branch finished at ${node.data.label}` })
    ;(obj.scopeEnds ??= {})[scopeKey(tok)] = { result, label: node.data.label, nodeId: node.id, outcome: node.data.outcome?.trim() || undefined }
    const depth = tok.calls[tok.calls.length - 1]?.forkDepth ?? 0
    dropToken(sim, obj, tok)
    branchGone(sim, idx, obj, tok.forks.slice(depth))
    return
  }
  finishScope(sim, idx, obj, tok, result, node.data.label, node.id, node.data.outcome?.trim() || undefined)
}

/** End the current scope (subflow call or the whole item) with a result. */
function finishScope(
  sim: SimState,
  idx: Index,
  obj: SimObject,
  tok: Token,
  result: 'completed' | 'rejected' | 'cancelled',
  label: string,
  endNodeId?: Id,
  outcomeKey?: string,
): void {
  for (const t of [...scopePeers(obj, tok)]) if (t !== tok) withdraw(sim, idx, obj, t, `${label} ended the ${tok.calls.length ? 'subflow' : 'item'}`)
  if (obj.scopeEnds) delete obj.scopeEnds[scopeKey(tok)]
  const call = tok.calls.pop()
  if (call) {
    // Return to the subflow step in the calling workflow and continue on the ending's path.
    tok.forks.length = Math.min(tok.forks.length, call.forkDepth)
    tok.nodeId = call.nodeId
    tok.workflowId = call.workflowId
    tok.enteredAt = call.at
    tok.state = 'auto'
    const key = outcomeKey ?? result
    const sub = idx.node.get(call.nodeId)?.node
    audit(sim, obj, { kind: 'subflow', nodeId: call.nodeId, tokenId: tok.id, text: `Subflow “${sub?.data.label ?? 'subflow'}” finished: ${key}` })
    const out = idx.out.get(call.nodeId) ?? []
    const generic = out.filter((e) => !e.data.outcomeId)
    const edge =
      out.find((e) => e.data.outcomeId === key) ?? out.find((e) => e.data.outcomeId === result) ?? (result === 'completed' && generic.length === 1 ? generic[0] : undefined)
    if (edge) {
      leave(sim, idx, obj, tok, edge, key)
      return enterNode(sim, idx, obj, tok, edge.target, 1)
    }
    // A rejection or cancellation with nowhere to go ends the caller the same way.
    if (result !== 'completed') return finishScope(sim, idx, obj, tok, result, `${sub?.data.label ?? 'Subflow'} ended ${key}`, undefined, key)
    return markStuck(sim, obj, tok, `No path for “${key}” from “${sub?.data.label ?? 'the subflow step'}”`, key)
  }
  obj.tokens = []
  obj.status = result
  obj.completedAt = sim.clock
  obj.endNodeId = endNodeId
  sim.activeIds = sim.activeIds.filter((i) => i !== obj.id)
  if (result === 'completed') sim.completed++
  else sim.rejected++
  sim.cycleTotal += sim.clock - obj.createdAt
  for (const [id, f] of Object.entries(sim.forks)) if (f.objectId === obj.id) delete sim.forks[id]
  audit(sim, obj, { kind: 'completed', nodeId: endNodeId, tokenId: tok.id, text: `Finished: ${label}` })
}

// ---------- Automated steps & services ----------

export function serviceOf(idx: Index, d: AutoStepData): { svc?: ServiceDef; op?: ServiceOperation } {
  const svc = d.serviceId ? idx.service.get(d.serviceId) : undefined
  const op = svc ? (svc.operations.find((o) => o.id === d.operationId) ?? svc.operations[0]) : undefined
  return { svc, op }
}

function startAutomated(sim: SimState, idx: Index, tok: Token, node: NodeOf<'auto'>) {
  const { svc, op } = serviceOf(idx, node.data)
  if (!svc || !op) {
    tok.state = 'auto'
    tok.dueAt = sim.clock + workDuration(sim, node.data.avgMinutes)
    return
  }
  tryDispatch(sim, tok, svc, op)
}

/** Start the call if the service has room; otherwise the token waits in the service's queue. */
function tryDispatch(sim: SimState, tok: Token, svc: ServiceDef, op: ServiceOperation): boolean {
  const st = sstat(sim, svc.id)
  if (svc.status === 'offline') {
    tok.state = 'queued'
    tok.waitReason = `${svc.name} is offline`
    return false
  }
  if (svc.concurrency && st.inFlight >= svc.concurrency) {
    tok.state = 'queued'
    tok.waitReason = `Waiting for a free ${svc.name} slot (${svc.concurrency} in use)`
    return false
  }
  st.inFlight++
  st.calls++
  tok.state = 'auto'
  tok.waitReason = undefined
  tok.serviceId = svc.id
  tok.startedAt = sim.clock
  tok.attempt = (tok.attempt ?? 0) + 1
  tok.dueAt = sim.clock + workDuration(sim, op.avgMinutes * (svc.status === 'degraded' ? 3 : 1))
  if (tok.attempt === 1) {
    const s = stat(sim, tok.nodeId)
    s.waitTotal += sim.clock - tok.enteredAt
    s.waitCount++
  }
  return true
}

/** Free the service slot an in-flight call holds (when it finishes or the token leaves). */
export function releaseServiceSlot(sim: SimState, tok: Token) {
  if (!tok.serviceId) return
  const st = sstat(sim, tok.serviceId)
  if (st.inFlight > 0) st.inFlight--
  st.busyMinutes += sim.clock - (tok.startedAt ?? sim.clock)
  tok.serviceId = undefined
  tok.startedAt = undefined
}

function simulatedOutput(sim: SimState, o: ServiceOperation['outputs'][number]): unknown {
  switch (o.type) {
    case 'boolean':
      return rand(sim) < (o.trueRate ?? 0.5)
    case 'number': {
      const min = o.min ?? 0
      const max = o.max ?? 100
      const v = min + rand(sim) * (max - min)
      return max - min > 20 ? Math.round(v) : Math.round(v * 100) / 100
    }
    default:
      return pick(sim, o.options ?? []) ?? 'OK'
  }
}

/** Store a service result on the object, converting to the field's type (choice values by label). */
function storeOutput(idx: Index, obj: SimObject, fieldId: Id, value: unknown) {
  const type = idx.type.get(obj.typeId)
  const f = type?.fields.find((x) => x.id === fieldId)
  if (!f) return
  if (f.type === 'boolean') obj.data[f.id] = value === true || /^(true|yes|1|ok)$/i.test(String(value))
  else if (f.type === 'number' || f.type === 'currency') obj.data[f.id] = Number(value) || 0
  else if (f.type === 'choice') {
    const list = idx.ctx.app.lists.find((l) => l.id === f.listId)
    const item = list?.items.find((i) => i.label.toLowerCase() === String(value).toLowerCase())
    if (item) obj.data[f.id] = item.id
  } else obj.data[f.id] = String(value)
}

function finishAutomated(sim: SimState, idx: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      if (tok.state !== 'auto' || tok.manual || tok.dueAt === undefined || tok.dueAt > sim.clock) continue
      const node = idx.node.get(tok.nodeId)?.node
      if (!node || node.type !== 'auto') {
        markStuck(sim, obj, tok, 'This step was removed from the map')
        continue
      }
      const { svc, op } = serviceOf(idx, node.data)
      if (!svc || !op) {
        applyActions(sim, idx, obj, node.data.actions, undefined, node.id)
        audit(sim, obj, { kind: 'auto', nodeId: node.id, tokenId: tok.id, text: `${node.data.label} completed automatically` })
        advanceFrom(sim, idx, obj, tok, AUTO_SUCCESS, 0)
        continue
      }
      releaseServiceSlot(sim, tok)
      const st = sstat(sim, svc.id)
      const ok = rand(sim) < op.successRate * (svc.status === 'degraded' ? 0.75 : 1)
      if (ok) {
        st.ok++
        const shown: string[] = []
        for (const out of node.data.outputs ?? []) {
          const spec = op.outputs.find((x) => x.key === out.key)
          if (!spec) continue
          const v = simulatedOutput(sim, spec)
          storeOutput(idx, obj, out.fieldId, v)
          shown.push(`${spec.label} ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}`)
        }
        audit(sim, obj, {
          kind: 'service',
          nodeId: node.id,
          tokenId: tok.id,
          text: `${svc.name} · ${op.name}: OK${shown.length ? ` (${shown.join(', ')})` : ''}`,
        })
        applyActions(sim, idx, obj, node.data.actions, undefined, node.id)
        advanceFrom(sim, idx, obj, tok, AUTO_SUCCESS, 0)
      } else {
        st.failed++
        const retries = node.data.retries ?? 0
        if ((tok.attempt ?? 1) <= retries) {
          audit(sim, obj, { kind: 'service', nodeId: node.id, tokenId: tok.id, text: `${svc.name} · ${op.name}: failed, retrying (attempt ${(tok.attempt ?? 1) + 1} of ${retries + 1})` })
          tryDispatch(sim, tok, svc, op)
        } else {
          automationFailed(sim, idx, obj, tok, node, `${svc.name} · ${op.name} failed${retries ? ` after ${retries + 1} attempts` : ''}`)
        }
      }
    }
  }
  // Calls finished: start queued ones where there is room (most urgent first).
  dispatchQueued(sim, idx)
}

function dispatchQueued(sim: SimState, idx: Index) {
  const queued = activeTokens(sim).filter((t) => t.state === 'queued')
  if (!queued.length) return
  queued.sort(byUrgency((t) => t.enteredAt, objectOf(sim)))
  for (const tok of queued) {
    const obj = sim.objects[tok.objectId]
    const node = idx.node.get(tok.nodeId)?.node
    if (!obj || node?.type !== 'auto') continue
    const { svc, op } = serviceOf(idx, node.data)
    if (!svc || !op) {
      startAutomated(sim, idx, tok, node)
      continue
    }
    tryDispatch(sim, tok, svc, op)
  }
}

function automationFailed(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'auto'>, reason: string) {
  const policy = node.data.onFailure ?? 'route'
  const hasFailurePath = (idx.out.get(node.id) ?? []).some((e) => e.data.outcomeId === AUTO_FAILURE)
  if (policy === 'route' && hasFailurePath) {
    audit(sim, obj, { kind: 'service', nodeId: node.id, tokenId: tok.id, text: `${reason}; taking the “Failed” path` })
    return advanceFrom(sim, idx, obj, tok, AUTO_FAILURE, 0)
  }
  const fallback = node.data.fallbackGroupId ? idx.group.get(node.data.fallbackGroupId) : undefined
  if (policy !== 'stuck' && fallback) {
    audit(sim, obj, { kind: 'manual', nodeId: node.id, tokenId: tok.id, text: `${reason}; handed to ${fallback.name} to do by hand` })
    return toManual(sim, idx, obj, tok, node)
  }
  markStuck(sim, obj, tok, reason)
}

/** A person takes over an automated step. */
function toManual(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'auto'>, assignTo?: Id, actor?: string) {
  releaseServiceSlot(sim, tok)
  tok.manual = true
  tok.state = 'unassigned'
  tok.dueAt = undefined
  tok.stuckReason = undefined
  tok.waitReason = undefined
  const ws = workStepOf(idx, tok)
  if (!ws) return markStuck(sim, obj, tok, 'No fallback group to do this step by hand')
  if (assignTo) assign(sim, obj, tok, assignTo, 'reassigned', `${actor ?? 'Administrator'} reassigned ${node.data.label} to ${userName(idx, assignTo)} to do by hand`, actor)
  else loadBalance(sim, idx, obj, tok, ws, openLoads(sim))
}

// ---------- People steps: a common view over user steps and hand-done automated steps ----------

export interface WorkStep {
  node: WfNode
  label: string
  distribution: NodeOf<'user'>['data']['distribution']
  groupId?: Id
  userId?: Id
  assigneeFieldId?: Id
  supervisorId?: Id
  distributorGroupId?: Id
  autoDistribute: boolean
  distributeEveryMinutes: number
  avgMinutes: number
  slaHours?: number
  outcomes: Outcome[]
  allowDelegate: boolean
}

export const MANUAL_OUTCOMES: Outcome[] = [
  { id: AUTO_SUCCESS, label: 'Done by hand', weight: 95, actions: [] },
  { id: AUTO_FAILURE, label: 'Could not complete', weight: 5, requireComment: true, actions: [] },
]

/** The work definition for a token at a people step (or an automated step done by hand). */
export function workStepOf(idx: Index, tok: Token): WorkStep | undefined {
  const node = idx.node.get(tok.nodeId)?.node
  if (node?.type === 'user') {
    const d = node.data
    return {
      node,
      label: d.label,
      distribution: d.distribution,
      groupId: d.groupId,
      userId: d.userId,
      assigneeFieldId: d.assigneeFieldId,
      supervisorId: d.supervisorId,
      distributorGroupId: d.distributorGroupId,
      autoDistribute: d.autoDistribute,
      distributeEveryMinutes: d.distributeEveryMinutes,
      avgMinutes: d.avgMinutes,
      slaHours: d.slaHours,
      outcomes: d.outcomes,
      allowDelegate: d.allowDelegate ?? true,
    }
  }
  if (node?.type === 'auto' && tok.manual) {
    const { op } = serviceOf(idx, node.data)
    return {
      node,
      label: node.data.label,
      distribution: 'load-balance',
      groupId: node.data.fallbackGroupId,
      autoDistribute: false,
      distributeEveryMinutes: 30,
      avgMinutes: Math.max(8, Math.round((op?.avgMinutes ?? node.data.avgMinutes) * 6)),
      outcomes: MANUAL_OUTCOMES,
      allowDelegate: true,
    }
  }
  return undefined
}

/** The step's dispatchers: the distribution group's members, else the supervisor. */
export function distributorsOf(idx: Index, ws: Pick<WorkStep, 'distributorGroupId' | 'supervisorId' | 'groupId'>): Id[] {
  const dg = ws.distributorGroupId ? idx.group.get(ws.distributorGroupId) : undefined
  if (dg?.memberIds.length) return dg.memberIds
  const sup = ws.supervisorId ?? (ws.groupId ? idx.group.get(ws.groupId)?.supervisorId : undefined)
  return sup ? [sup] : []
}

function availableMembers(idx: Index, ws: Pick<WorkStep, 'groupId'>): User[] {
  const g = ws.groupId ? idx.group.get(ws.groupId) : undefined
  if (!g) return []
  return g.memberIds.map((id) => idx.user.get(id)).filter((u): u is User => !!u && u.available)
}

export function openLoads(sim: SimState): Map<Id, number> {
  const loads = new Map<Id, number>()
  for (const t of activeTokens(sim)) {
    if (t.userId && (t.state === 'assigned' || t.state === 'working')) loads.set(t.userId, (loads.get(t.userId) ?? 0) + 1)
  }
  return loads
}

export function assign(sim: SimState, obj: SimObject, tok: Token, userId: Id, kind: AuditKind, text: string, actor?: string) {
  freeWorker(sim, tok)
  tok.state = 'assigned'
  tok.userId = userId
  tok.assignedAt = sim.clock
  tok.startedAt = undefined
  tok.dueAt = undefined
  audit(sim, obj, { kind, nodeId: tok.nodeId, tokenId: tok.id, userId, actor, text })
}

/** Give the token to the available group member with the fewest open items (round-robin on ties). */
function loadBalance(sim: SimState, idx: Index, obj: SimObject, tok: Token, ws: WorkStep, loads: Map<Id, number>, actor?: string): boolean {
  const members = availableMembers(idx, ws)
  if (members.length === 0) return false
  const n = members.length
  const cursor = (sim.rrCursor[ws.node.id] ?? 0) % n
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
  sim.rrCursor[ws.node.id] = (bestAt + 1) % n
  loads.set(best.id, bestLoad + 1)
  const text = actor ? `Redistributed to ${best.name} by ${actor}` : `Load balanced to ${best.name} (${bestLoad} open before)`
  assign(sim, obj, tok, best.id, actor ? 'reassigned' : 'assigned', text, actor)
  return true
}

export { loadBalance as loadBalanceToken }

/** `field` distribution: give it to the person named in a field of the item. */
function assignFromField(sim: SimState, idx: Index, obj: SimObject, tok: Token, ws: WorkStep): boolean {
  const f = ws.assigneeFieldId ? idx.type.get(obj.typeId)?.fields.find((x) => x.id === ws.assigneeFieldId) : undefined
  const who = f ? obj.data[f.id] : undefined
  if (typeof who !== 'string' || !idx.user.has(who)) return false
  assign(sim, obj, tok, who, 'assigned', `Assigned to ${userName(idx, who)} (the ${f!.label.toLowerCase()})`)
  return true
}

function distributeOnArrival(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'user'>) {
  const ws = workStepOf(idx, tok)!
  tok.state = 'unassigned'
  switch (node.data.distribution) {
    case 'direct':
      if (node.data.userId) assign(sim, obj, tok, node.data.userId, 'assigned', `Assigned directly to ${userName(idx, node.data.userId)}`)
      return
    case 'load-balance':
      loadBalance(sim, idx, obj, tok, ws, openLoads(sim))
      return
    case 'field':
      if (!assignFromField(sim, idx, obj, tok, ws)) loadBalance(sim, idx, obj, tok, ws, openLoads(sim))
      return
    case 'queue': {
      const g = ws.groupId ? idx.group.get(ws.groupId) : undefined
      audit(sim, obj, { kind: 'entered', nodeId: node.id, tokenId: tok.id, text: `Waiting in the ${g?.name ?? 'group'} queue` })
      return
    }
    case 'manager': {
      const dg = ws.distributorGroupId ? idx.group.get(ws.distributorGroupId) : undefined
      const who = dg ? dg.name : userName(idx, distributorsOf(idx, ws)[0])
      audit(sim, obj, { kind: 'entered', nodeId: node.id, tokenId: tok.id, text: `Awaiting distribution by ${who}` })
      return
    }
  }
}

// ---------- The clock ----------

/** Advance the simulation by `minutes` of simulated time, one minute at a time. */
export function advance(sim: SimState, ctx: Ctx, minutes: number) {
  const idx = buildIndex(ctx)
  const end = sim.clock + minutes
  while (sim.clock < end - 1e-9) {
    sim.clock = Math.min(end, sim.clock + 1)
    arrivals(sim, idx)
    timers(sim, idx)
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

function creatorFor(sim: SimState, idx: Index, type: ObjectType, wf: Workflow): string {
  const trigger = wf.nodes.find((n) => n.type === 'start')
  if (trigger?.type === 'start' && trigger.data.trigger && trigger.data.trigger !== 'form') {
    return trigger.data.source ? `${trigger.data.trigger === 'event' ? 'Event stream' : trigger.data.trigger === 'api' ? 'API' : trigger.data.trigger === 'email' ? 'Inbox' : 'Schedule'} ${trigger.data.source}` : 'Intake service'
  }
  const creatorGroups = Object.entries(type.permissions)
    .filter(([, p]) => p.create)
    .map(([gid]) => idx.group.get(gid))
  const people = creatorGroups.flatMap((g) => g?.memberIds ?? []).filter((id) => !idx.manual.has(id))
  return pick(sim, people) ?? 'Intake service'
}

function arrivals(sim: SimState, idx: Index) {
  if (!sim.arrivals) return
  for (const wf of idx.ctx.app.workflows) {
    if (wf.kind === 'subflow' || !(wf.arrivalsPerHour > 0)) {
      delete sim.nextArrival[wf.id]
      continue
    }
    sim.nextArrival[wf.id] ??= sim.clock + expMinutes(sim, wf.arrivalsPerHour)
    let guard = 0
    while (sim.nextArrival[wf.id]! <= sim.clock && guard++ < 80) {
      generateObject(sim, idx, wf)
      sim.nextArrival[wf.id]! += expMinutes(sim, wf.arrivalsPerHour)
    }
  }
}

function generateObject(sim: SimState, idx: Index, wf: Workflow): SimObject | undefined {
  const type = idx.type.get(wf.objectTypeId)
  if (!type) return undefined
  const creator = creatorFor(sim, idx, type, wf)
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

/** Timers finishing, and escalations of work that has sat too long. */
function timers(sim: SimState, idx: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      if (tok.state === 'waiting' && tok.dueAt !== undefined && tok.dueAt <= sim.clock) {
        tok.state = 'auto'
        tok.waitReason = undefined
        advanceFrom(sim, idx, obj, tok, undefined, 0)
        continue
      }
      const node = idx.node.get(tok.nodeId)?.node
      if (node?.type !== 'user' || tok.escalated || !node.data.escalateAfterHours) continue
      if (tok.state !== 'unassigned' && tok.state !== 'assigned' && tok.state !== 'working') continue
      if (sim.clock - tok.enteredAt < node.data.escalateAfterHours * 60) continue
      escalate(sim, idx, obj, tok, node)
    }
  }
}

function escalate(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'user'>) {
  tok.escalated = true
  const esc = node.data.escalation ?? { raisePriority: true, toDistributors: false }
  const did: string[] = []
  if (esc.raisePriority) {
    const next = PRIORITIES[Math.min(PRIORITIES.length - 1, PRIORITY_RANK[obj.priority] + 1)]!
    if (next !== obj.priority) {
      obj.priority = next
      did.push(`priority raised to ${next}`)
    }
  }
  if (esc.toDistributors && tok.state === 'assigned') {
    const ws = workStepOf(idx, tok)
    const who = ws ? distributorsOf(idx, ws) : []
    if (who.length) {
      tok.state = 'unassigned'
      tok.userId = undefined
      tok.assignedAt = undefined
      did.push('returned for re-distribution')
    }
  }
  if (esc.notify) did.push(`${esc.notify} notified`)
  audit(sim, obj, {
    kind: 'escalated',
    nodeId: node.id,
    tokenId: tok.id,
    text: `Escalated after ${node.data.escalateAfterHours}h at ${node.data.label}${did.length ? `: ${did.join(', ')}` : ''}`,
  })
}

function finishWork(sim: SimState, idx: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      if (tok.state !== 'working' || tok.dueAt === undefined || tok.dueAt > sim.clock) continue
      if (tok.userId && idx.manual.has(tok.userId)) continue
      const ws = workStepOf(idx, tok)
      if (!ws) {
        freeWorker(sim, tok)
        markStuck(sim, obj, tok, 'This step was removed from the map')
        continue
      }
      const outcome = weightedPick(sim, ws.outcomes, (o) => o.weight)
      const comment = outcome && (outcome.requireComment || rand(sim) < 0.35) ? commentFor(sim, outcome.label) : undefined
      // People doing an automated step by hand fill in what the service would have returned.
      if (ws.node.type === 'auto' && outcome?.id === AUTO_SUCCESS) fillOutputs(sim, idx, obj, ws.node)
      release(sim, idx, obj, tok, outcome?.id, comment)
    }
  }
}

function fillOutputs(sim: SimState, idx: Index, obj: SimObject, node: NodeOf<'auto'>) {
  const { op } = serviceOf(idx, node.data)
  for (const out of node.data.outputs ?? []) {
    const spec = op?.outputs.find((x) => x.key === out.key)
    if (spec && obj.data[out.fieldId] === undefined) storeOutput(idx, obj, out.fieldId, simulatedOutput(sim, spec))
  }
}

export function freeWorker(sim: SimState, tok: Token) {
  if (!tok.userId) return
  const st = ustat(sim, tok.userId)
  if (st.currentId === tok.id) {
    st.currentId = undefined
    st.busyMinutes += sim.clock - (tok.startedAt ?? sim.clock)
  }
}

/** Release a token from a people step with an outcome. Runs the outcome's actions, then routes. */
export function release(sim: SimState, idx: Index, obj: SimObject, tok: Token, outcomeId: Id | undefined, comment: string | undefined, actor?: string) {
  const ws = workStepOf(idx, tok)
  if (!ws) return
  const outcome: Outcome | undefined = ws.outcomes.find((o) => o.id === outcomeId)
  const worker = tok.userId
  if (worker) {
    freeWorker(sim, tok)
    ustat(sim, worker).completed++
  }
  const who = actor ? (worker && actor !== userName(idx, worker) ? `${actor} (for ${userName(idx, worker)})` : actor) : userName(idx, worker)
  audit(sim, obj, {
    kind: 'released',
    nodeId: ws.node.id,
    tokenId: tok.id,
    userId: worker,
    actor,
    text: `${who} released ${ws.label} as “${outcome?.label ?? 'Done'}”`,
    comment,
  })
  if (outcome) applyActions(sim, idx, obj, outcome.actions, worker, ws.node.id)
  if (ws.node.type === 'auto') {
    tok.manual = undefined
    if (outcomeId === AUTO_SUCCESS) applyActions(sim, idx, obj, ws.node.data.actions, worker, ws.node.id)
  }
  tok.state = 'auto'
  advanceFrom(sim, idx, obj, tok, outcomeId, 0)
}

function retryStuck(sim: SimState, idx: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (tok.state !== 'stuck' || obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      const node = idx.node.get(tok.nodeId)?.node
      if (!node) continue
      if (node.type === 'subflow' && !tok.pendingOutcomeId) {
        // Waiting for the subflow to be configured.
        const child = node.data.workflowId ? idx.wf.get(node.data.workflowId) : undefined
        if (!child?.nodes.some((n) => n.type === 'start')) continue
        audit(sim, obj, { kind: 'moved', nodeId: node.id, tokenId: tok.id, text: `Subflow configured; entering “${child.name}”` })
        enterNode(sim, idx, obj, tok, node.id, 0)
        continue
      }
      if (node.type === 'auto' && !tok.pendingOutcomeId) continue // failed call: needs an administrator
      if (node.type === 'split') {
        const out = idx.out.get(node.id) ?? []
        if (!out.length) continue
        audit(sim, obj, { kind: 'moved', nodeId: node.id, tokenId: tok.id, text: `Path fixed in the map; continuing` })
        enterNode(sim, idx, obj, tok, node.id, 0)
        continue
      }
      const choice = chooseEdge(idx, obj, node, tok.pendingOutcomeId)
      if (!choice.edge) continue
      audit(sim, obj, { kind: 'moved', nodeId: node.id, tokenId: tok.id, text: `Path fixed in the map; continuing to ${nodeLabel(idx, choice.edge.target)}` })
      tok.state = 'auto'
      advanceFrom(sim, idx, obj, tok, tok.pendingOutcomeId, 0)
    }
  }
}

function unassignedByNode(sim: SimState): Map<Id, Token[]> {
  const waiting = new Map<Id, Token[]>()
  for (const t of activeTokens(sim)) {
    if (t.state !== 'unassigned') continue
    const list = waiting.get(t.nodeId) ?? []
    list.push(t)
    waiting.set(t.nodeId, list)
  }
  return waiting
}

function supervise(sim: SimState, idx: Index) {
  let loads: Map<Id, number> | undefined
  const urgency = byUrgency((t) => t.enteredAt, objectOf(sim))
  for (const [nodeId, pending] of unassignedByNode(sim)) {
    pending.sort(urgency)
    const first = pending[0]
    const ws = first && workStepOf(idx, first)
    if (!ws) continue
    if (ws.distribution === 'load-balance' || ws.distribution === 'field') {
      // Members may have become available (or the field filled in) since the item arrived.
      loads ??= openLoads(sim)
      for (const t of pending) {
        const o = sim.objects[t.objectId]!
        if (ws.distribution === 'field' && assignFromField(sim, idx, o, t, ws)) continue
        if (!loadBalance(sim, idx, o, t, ws, loads)) break
      }
    } else if (ws.distribution === 'direct') {
      if (ws.userId) for (const t of pending) assign(sim, sim.objects[t.objectId]!, t, ws.userId, 'assigned', `Assigned directly to ${userName(idx, ws.userId)}`)
    } else if (ws.distribution === 'manager' && ws.autoDistribute) {
      const last = sim.lastDistribution[nodeId]
      if (last === undefined) {
        sim.lastDistribution[nodeId] = sim.clock
        continue
      }
      if (sim.clock - last < Math.max(5, ws.distributeEveryMinutes)) continue
      sim.lastDistribution[nodeId] = sim.clock
      const members = availableMembers(idx, ws)
      // Dispatchers driven by a real person in the Workspace do it themselves.
      const dispatchers = distributorsOf(idx, ws).filter((id) => !idx.manual.has(id))
      if (!members.length || !dispatchers.length) continue
      for (const t of pending) {
        const by = userName(idx, pick(sim, dispatchers))
        // A dispatcher's judgment, not an algorithm: favors faster people, so loads end up uneven.
        const u = weightedPick(sim, members, (m) => 1 / (m.speed * m.speed))!
        assign(sim, sim.objects[t.objectId]!, t, u.id, 'distributed', `${by} assigned it to ${u.name}`, by)
      }
    }
  }
}

/** Members of `group` able to work queue steps, mapped to those steps. */
function queueStepsByUser(idx: Index): Map<Id, Id[]> {
  const map = new Map<Id, Id[]>()
  for (const wf of idx.ctx.app.workflows) {
    for (const node of wf.nodes) {
      if (node.type !== 'user' || node.data.distribution !== 'queue' || !node.data.groupId) continue
      for (const uid of idx.group.get(node.data.groupId)?.memberIds ?? []) {
        const l = map.get(uid) ?? []
        l.push(node.id)
        map.set(uid, l)
      }
    }
  }
  return map
}

export { queueStepsByUser }

function pullWork(sim: SimState, idx: Index) {
  const baskets = new Map<Id, Token[]>()
  const queues = new Map<Id, Token[]>()
  for (const t of activeTokens(sim)) {
    if (t.state === 'assigned' && t.userId) {
      const b = baskets.get(t.userId) ?? []
      b.push(t)
      baskets.set(t.userId, b)
    } else if (t.state === 'unassigned') {
      const ws = workStepOf(idx, t)
      if (ws?.distribution === 'queue') {
        const q = queues.get(t.nodeId) ?? []
        q.push(t)
        queues.set(t.nodeId, q)
      }
    }
  }
  const objOf = objectOf(sim)
  for (const b of baskets.values()) b.sort(byUrgency((t) => t.assignedAt ?? 0, objOf))
  for (const q of queues.values()) q.sort(byUrgency((t) => t.enteredAt, objOf))

  const queueNodesByUser = queueStepsByUser(idx)
  const users = idx.ctx.users
  const n = users.length
  const offset = n ? Math.floor(sim.clock) % n : 0
  for (let i = 0; i < n; i++) {
    const u = users[(offset + i) % n]!
    if (!u.available || idx.manual.has(u.id)) continue
    const st = ustat(sim, u.id)
    if (st.currentId) {
      const cur = findToken(sim, st.currentId)?.tok
      if (cur && cur.state === 'working' && cur.userId === u.id) continue
      st.currentId = undefined
    }
    let next = baskets.get(u.id)?.shift()
    if (!next) {
      // Fetch: take the most urgent, oldest item from any queue this user can work.
      let bestQ: Token[] | undefined
      for (const nodeId of queueNodesByUser.get(u.id) ?? []) {
        const q = queues.get(nodeId)
        if (q?.length && (!bestQ || byUrgency((t) => t.enteredAt, objOf)(q[0]!, bestQ[0]!) < 0)) bestQ = q
      }
      const fetched = bestQ?.shift()
      if (fetched) {
        assign(sim, sim.objects[fetched.objectId]!, fetched, u.id, 'fetched', `${u.name} fetched it from the queue`)
        next = fetched
      }
    }
    if (next) startWork(sim, idx, next, u)
  }
}

function startWork(sim: SimState, idx: Index, tok: Token, u: User) {
  const ws = workStepOf(idx, tok)
  const obj = sim.objects[tok.objectId]
  if (!ws || !obj) return
  tok.state = 'working'
  tok.startedAt = sim.clock
  tok.dueAt = sim.clock + workDuration(sim, ws.avgMinutes, u.speed)
  ustat(sim, u.id).currentId = tok.id
  const s = stat(sim, ws.node.id)
  s.waitTotal += sim.clock - tok.enteredAt
  s.waitCount++
  audit(sim, obj, { kind: 'started', nodeId: ws.node.id, tokenId: tok.id, userId: u.id, text: `${u.name} started working on it` })
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
  return v
    .replace(/\{number\}/g, obj.number)
    .replace(/\{seq\}/g, () => String(randInt(sim, 10000, 99999)))
    .replace(/\{currentUser\}/g, userName(idx, currentUser))
}

export function displayValue(idx: Index, type: ObjectType | undefined, fieldId: Id, value: unknown): string {
  const f = type?.fields.find((x) => x.id === fieldId)
  if (!f) return String(value)
  if (f.type === 'boolean') return value ? 'Yes' : 'No'
  if (f.type === 'user') return userName(idx, value as Id)
  if (f.type === 'currency') return currencyFmt.format(Number(value) || 0)
  if (f.type === 'choice') return idx.ctx.app.lists.find((l) => l.id === f.listId)?.items.find((i) => i.id === value)?.label ?? String(value ?? '')
  if (f.type === 'date' && typeof value === 'string') {
    const d = new Date(`${value}T00:00:00`)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return String(value ?? '')
}

export function applyActions(sim: SimState, idx: Index, obj: SimObject, actions: ActionDef[], currentUser?: Id, nodeId?: Id) {
  const type = idx.type.get(obj.typeId)
  for (const a of actions) {
    if (a.kind === 'setField') {
      const f = type?.fields.find((x) => x.id === a.fieldId)
      if (!f) continue
      const value = resolveValue(sim, idx, obj, a.value, f.type, currentUser)
      obj.data[f.id] = value
      audit(sim, obj, { kind: 'field', nodeId, text: `${f.label} set to ${displayValue(idx, type, f.id, value)}` })
    } else if (a.kind === 'notify') {
      const msg = String(resolveValue(sim, idx, obj, a.message, 'text', currentUser))
      audit(sim, obj, { kind: 'notify', nodeId, text: `Email to ${a.to || 'recipient'}: “${msg}”` })
    } else if (a.kind === 'integration') {
      const ok = rand(sim) < a.successRate
      if (a.resultFieldId) {
        const f = type?.fields.find((x) => x.id === a.resultFieldId)
        if (f) obj.data[f.id] = f.type === 'boolean' ? ok : ok ? 'OK' : 'FAILED'
      }
      audit(sim, obj, { kind: 'integration', nodeId, text: `${a.system}: ${ok ? 'success' : 'no match'}` })
    }
  }
}

// Internal hooks for the operations module (admin + workbasket).
export const internals = { toManual, tryDispatch, withdraw, evaluateJoin, dropToken, finishScope }
