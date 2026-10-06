// The process engine: a discrete-time engine that moves work through the
// workflow map exactly as the designer describes it. Each item (SimObject) has
// one or more tokens — one per parallel branch — and every function here
// mutates the SimState it is given.
//
// The same engine powers the browser simulation (with simulated people and
// services) and is written to move behind a server unchanged: it does no I/O,
// reads the design on every call (so published changes apply), and is
// deterministic for a given seed. Items run the workflow version they started
// on (see model/versions.ts); every lookup for a specific item goes through
// that item's own index (indexFor).

import { describeCondition, evaluateCondition, withMeta } from '../model/conditions'
import { type AccessInput, type FieldVerdict, fieldVerdicts, strictestVerdicts } from '../model/security'
import { normalizeData } from '../model/tables'
import { publishedVersion, runnable, runnableApp } from '../model/versions'
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

// ---------- Index over the design (rebuilt per call so published changes apply) ----------

export interface Index {
  /** The design as this index runs it: workflows resolved to the versions it was built for. */
  ctx: Ctx
  wf: Map<Id, Workflow>
  node: Map<Id, { node: WfNode; wf: Workflow }>
  out: Map<Id, WfEdge[]>
  type: Map<Id, ObjectType>
  user: Map<Id, User>
  group: Map<Id, Group>
  service: Map<Id, ServiceDef>
  manual: Set<Id>
  live: boolean
  /** The index items resolve from: every workflow at its published version (or as drawn, when unversioned). */
  base: Index
  /** The pins this index was built for, as a key ('' for the base). */
  pins: string
  /** The design as given: working copies, with their versions. */
  source: Ctx
  /** Its workflows by id. */
  design: Map<Id, Workflow>
  /** Every step of the published versions, the working copies and older versions, for labels and design-wide lists. */
  anyNode: Map<Id, { node: WfNode; wf: Workflow }>
  /** Steps live items can be at: the published versions', then older versions' (a step can appear once per version). */
  steps: Array<{ node: WfNode; wf: Workflow }>
  /** Per-item indexes, kept on the base by pin key. */
  cache: Map<string, Index>
}

export function buildIndex(ctx: Ctx): Index {
  return makeIndex(ctx)
}

function makeIndex(source: Ctx, pins?: Record<Id, number>, base?: Index, key = ''): Index {
  const versioned = source.app.workflows.some((w) => w.versions?.length)
  const ctx = versioned ? { ...source, app: runnableApp(source.app, pins) } : source
  const idx = {
    ctx,
    wf: new Map(),
    node: new Map(),
    out: new Map(),
    type: base?.type ?? new Map(ctx.app.objectTypes.map((t) => [t.id, t])),
    user: base?.user ?? new Map(ctx.users.map((u) => [u.id, u])),
    group: base?.group ?? new Map(ctx.groups.map((g) => [g.id, g])),
    service: base?.service ?? new Map((ctx.services ?? []).map((s) => [s.id, s])),
    manual: base?.manual ?? new Set(ctx.manualUserIds ?? []),
    live: !!ctx.live,
    pins: key,
    source,
    cache: base?.cache ?? new Map(),
  } as Index
  for (const wf of ctx.app.workflows) {
    idx.wf.set(wf.id, wf)
    for (const n of wf.nodes) idx.node.set(n.id, { node: n, wf })
    for (const e of wf.edges) {
      const list = idx.out.get(e.source) ?? []
      list.push(e)
      idx.out.set(e.source, list)
    }
  }
  if (base) {
    idx.base = base
    idx.design = base.design
    idx.anyNode = base.anyNode
    idx.steps = base.steps
    return idx
  }
  idx.base = idx
  idx.design = new Map(source.app.workflows.map((w) => [w.id, w]))
  idx.anyNode = new Map(idx.node)
  idx.steps = [...idx.node.values()]
  if (versioned) {
    for (const wf of source.app.workflows) for (const n of wf.nodes) if (!idx.anyNode.has(n.id)) idx.anyNode.set(n.id, { node: n, wf })
    for (const wf of source.app.workflows) {
      const live = publishedVersion(wf)
      for (const v of [...(wf.versions ?? [])].reverse()) {
        if (v.version === live) continue
        const run = runnable(wf, v.version)
        for (const n of run.nodes) {
          if (!idx.anyNode.has(n.id)) idx.anyNode.set(n.id, { node: n, wf: run })
          idx.steps.push({ node: n, wf: run })
        }
      }
    }
  }
  return idx
}

/**
 * The index an item runs on: each workflow at the version the item is pinned
 * to, else at its published version. Cached on the base index, so items on the
 * published versions share the base and others share one index per set of pins.
 */
export function indexFor(idx: Index, obj: Pick<SimObject, 'versions'> | undefined): Index {
  const base = idx.base
  const pins = obj?.versions
  if (!pins) return base
  let key = ''
  for (const [wfId, v] of Object.entries(pins).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const wf = base.design.get(wfId)
    if (wf?.versions?.some((x) => x.version === v) && v !== publishedVersion(wf)) key += `${wfId}@${v};`
  }
  if (!key) return base
  let hit = base.cache.get(key)
  if (!hit) base.cache.set(key, (hit = makeIndex(base.source, pins, base, key)))
  return hit
}

/** A step by id in this index, else in any version (for labels of steps a later version removed). */
export function stepOf(idx: Index, id: Id): { node: WfNode; wf: Workflow } | undefined {
  return idx.node.get(id) ?? idx.base.anyNode.get(id)
}

export const userName = (idx: Index, id?: Id) => (id ? (idx.user.get(id)?.name ?? 'Unknown user') : 'nobody')

export function nodeLabel(idx: Index, id: Id): string {
  return stepOf(idx, id)?.node.data.label ?? 'a removed step'
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
  opts: { expedite?: { reason?: string } } = {},
): SimObject | undefined {
  // New items start on the published version, and keep it.
  idx = idx.base
  const wf = idx.wf.get(workflowId)
  const type = wf && idx.type.get(wf.objectTypeId)
  if (!wf || !type) return undefined
  const number = nextNumber(sim, type)
  sim.seq++
  const values = normalizeData(type, typeof data === 'function' ? data(number) : { ...data })
  const version = publishedVersion(idx.design.get(workflowId))
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
    ...(version !== undefined ? { versions: { [workflowId]: version } } : {}),
    history: [],
  }
  sim.objects[obj.id] = obj
  sim.activeIds.push(obj.id)
  sim.created++
  const byName = idx.user.get(createdBy)?.name ?? createdBy
  audit(sim, obj, { kind: 'created', userId: idx.user.has(createdBy) ? createdBy : undefined, text: `${type.name} created by ${byName}` })
  if (opts.expedite) markExpedited(sim, idx, obj, byName, opts.expedite.reason)
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
  idx = indexFor(idx, obj)
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
  const data = withMeta(obj.data, { priority: obj.priority, expedited: !!obj.expedite })
  const matches = type ? conditional.filter((e) => evaluateCondition(e.data.condition, type, data)) : []
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
  idx = indexFor(idx, obj)
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
  // The item keeps the subflow version it first entered (the published one at the time).
  const version = publishedVersion(idx.design.get(child.id))
  if (version !== undefined && obj.versions?.[child.id] === undefined) (obj.versions ??= {})[child.id] = version
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
  if (obj.expedite) {
    sim.expFinished = (sim.expFinished ?? 0) + 1
    sim.expCycleTotal = (sim.expCycleTotal ?? 0) + (sim.clock - obj.createdAt)
  }
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
    // Built-in actions only: live, they run on the next tick; simulated, they take a while.
    tok.dueAt = sim.clock + (idx.live ? 0 : workDuration(sim, node.data.avgMinutes))
    return
  }
  tryDispatch(sim, tok, svc, op, idx.live)
}

/** Start the call if the service has room; otherwise the token waits in the service's queue. */
function tryDispatch(sim: SimState, tok: Token, svc: ServiceDef, op: ServiceOperation, live = false): boolean {
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
  tok.workerId = undefined
  tok.leaseUntil = undefined
  // Live, the call is a job a worker claims and completes; simulated, it finishes after a while.
  tok.dueAt = live ? undefined : sim.clock + workDuration(sim, op.avgMinutes * (svc.status === 'degraded' ? 3 : 1))
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
  tok.workerId = undefined
  tok.leaseUntil = undefined
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
  if (type) obj.data = normalizeData(type, obj.data)
}

/** A service call returned: store its outputs, run the step's actions, take the success path. */
function completeCall(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'auto'>, svc: ServiceDef, op: ServiceOperation, values: Record<string, unknown>) {
  releaseServiceSlot(sim, tok)
  sstat(sim, svc.id).ok++
  const shown: string[] = []
  const stored: Id[] = []
  for (const out of node.data.outputs ?? []) {
    if (!(out.key in values)) continue
    const v = values[out.key]
    storeOutput(idx, obj, out.fieldId, v)
    stored.push(out.fieldId)
    const label = op.outputs.find((x) => x.key === out.key)?.label ?? out.key
    shown.push(`${label} ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`)
  }
  const ok = `${svc.name} · ${op.name}: OK`
  audit(sim, obj, { kind: 'service', nodeId: node.id, tokenId: tok.id, fieldIds: stored.length ? stored : undefined, redacted: ok, text: `${ok}${shown.length ? ` (${shown.join(', ')})` : ''}` })
  applyActions(sim, idx, obj, node.data.actions, undefined, node.id)
  advanceFrom(sim, idx, obj, tok, AUTO_SUCCESS, 0)
}

/** A service call failed: retry while attempts remain, then apply the step's failure policy. */
function failCall(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'auto'>, svc: ServiceDef, op: ServiceOperation, error: string) {
  releaseServiceSlot(sim, tok)
  sstat(sim, svc.id).failed++
  const retries = node.data.retries ?? 0
  if ((tok.attempt ?? 1) <= retries) {
    audit(sim, obj, { kind: 'service', nodeId: node.id, tokenId: tok.id, text: `${svc.name} · ${op.name}: ${error}, retrying (attempt ${(tok.attempt ?? 1) + 1} of ${retries + 1})` })
    tryDispatch(sim, tok, svc, op, idx.live)
  } else {
    automationFailed(sim, idx, obj, tok, node, `${svc.name} · ${op.name} ${error}${retries ? ` after ${retries + 1} attempts` : ''}`)
  }
}

function finishAutomated(sim: SimState, base: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      if (tok.state !== 'auto' || tok.manual || tok.dueAt === undefined || tok.dueAt > sim.clock) continue
      const idx = indexFor(base, obj)
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
      const ok = rand(sim) < op.successRate * (svc.status === 'degraded' ? 0.75 : 1)
      if (ok) {
        const values: Record<string, unknown> = {}
        for (const spec of op.outputs) values[spec.key] = simulatedOutput(sim, spec)
        completeCall(sim, idx, obj, tok, node, svc, op, values)
      } else {
        failCall(sim, idx, obj, tok, node, svc, op, 'failed')
      }
    }
  }
  // Calls finished: start queued ones where there is room (most urgent first).
  dispatchQueued(sim, base)
}

function dispatchQueued(sim: SimState, base: Index) {
  const queued = activeTokens(sim).filter((t) => t.state === 'queued')
  if (!queued.length) return
  queued.sort(byUrgency((t) => t.enteredAt, objectOf(sim)))
  for (const tok of queued) {
    const obj = sim.objects[tok.objectId]
    const idx = indexFor(base, obj)
    const node = idx.node.get(tok.nodeId)?.node
    if (!obj || node?.type !== 'auto') continue
    const { svc, op } = serviceOf(idx, node.data)
    if (!svc || !op) {
      startAutomated(sim, idx, tok, node)
      continue
    }
    tryDispatch(sim, tok, svc, op, idx.live)
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
  separateFrom: Id[]
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
      separateFrom: d.separateFrom ?? [],
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
      separateFrom: [],
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

function availableMembers(idx: Index, ws: Pick<WorkStep, 'groupId'>, exclude?: Set<Id>): User[] {
  const g = ws.groupId ? idx.group.get(ws.groupId) : undefined
  if (!g) return []
  return g.memberIds.map((id) => idx.user.get(id)).filter((u): u is User => !!u && u.available && !exclude?.has(u.id))
}

/** Separation of duties: people who released one of the step's "separate from" steps on this item. */
export function excludedFor(obj: SimObject, ws: Pick<WorkStep, 'separateFrom'>): Set<Id> {
  const out = new Set<Id>()
  if (!ws.separateFrom.length) return out
  for (const h of obj.history) if (h.kind === 'released' && h.userId && h.nodeId && ws.separateFrom.includes(h.nodeId)) out.add(h.userId)
  return out
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
  const members = availableMembers(idx, ws, excludedFor(obj, ws))
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
  if (typeof who !== 'string' || !idx.user.has(who) || excludedFor(obj, ws).has(who)) return false
  assign(sim, obj, tok, who, 'assigned', `Assigned to ${userName(idx, who)} (the ${f!.label.toLowerCase()})`)
  return true
}

function distributeOnArrival(sim: SimState, idx: Index, obj: SimObject, tok: Token, node: NodeOf<'user'>) {
  const ws = workStepOf(idx, tok)!
  tok.state = 'unassigned'
  switch (node.data.distribution) {
    case 'direct':
      if (node.data.userId && !excludedFor(obj, ws).has(node.data.userId)) assign(sim, obj, tok, node.data.userId, 'assigned', `Assigned directly to ${userName(idx, node.data.userId)}`)
      else if (node.data.userId) tok.waitReason = `Separation of duties: ${userName(idx, node.data.userId)} already worked this item; an administrator must reassign it`
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
    // Live (server) mode drives only the engine; the simulation adds arrivals and people.
    if (!idx.live) arrivals(sim, idx)
    timers(sim, idx)
    finishAutomated(sim, idx)
    if (!idx.live) finishWork(sim, idx)
    retryStuck(sim, idx)
    supervise(sim, idx)
    if (!idx.live) pullWork(sim, idx)
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

const RUSH_REASONS = ['Customer escalation', 'Executive request', 'Payment deadline today', 'Safety concern', 'Regulatory deadline']

function generateObject(sim: SimState, idx: Index, wf: Workflow): SimObject | undefined {
  const type = idx.type.get(wf.objectTypeId)
  if (!type) return undefined
  const creator = creatorFor(sim, idx, type, wf)
  // The simulated share of expedited arrivals is a simulation setting: the working copy's applies at once.
  const rate = idx.design.get(wf.id)?.expedite?.simulateRate ?? 0
  const rush = rate > 0 && rand(sim) < rate ? { reason: pick(sim, RUSH_REASONS) } : undefined
  return createObject(sim, idx.ctx, wf.id, (number) => generateData(sim, type, idx.ctx.app.lists, idx.ctx.users, sim.clock, number), creator, idx, { expedite: rush })
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
function timers(sim: SimState, base: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      const idx = indexFor(base, obj)
      if (tok.state === 'waiting' && tok.dueAt !== undefined && tok.dueAt <= sim.clock) {
        tok.state = 'auto'
        tok.waitReason = undefined
        advanceFrom(sim, idx, obj, tok, undefined, 0)
        continue
      }
      const node = idx.node.get(tok.nodeId)?.node
      if (node?.type !== 'user' || tok.escalated || !node.data.escalateAfterHours) continue
      if (tok.state !== 'unassigned' && tok.state !== 'assigned' && tok.state !== 'working') continue
      if (sim.clock - tok.enteredAt < node.data.escalateAfterHours * 60 * speedFactor(idx, obj)) continue
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
  if (esc.notifySupervisors) {
    const names = [...supervisorsOf(idx, obj, tok)].map((id) => userName(idx, id))
    if (names.length) did.push(`supervisors notified (${names.join(', ')})`)
  }
  audit(sim, obj, {
    kind: 'escalated',
    nodeId: node.id,
    tokenId: tok.id,
    text: `Escalated after ${node.data.escalateAfterHours}h at ${node.data.label}${did.length ? `: ${did.join(', ')}` : ''}`,
  })
}

function finishWork(sim: SimState, base: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      if (tok.state !== 'working' || tok.dueAt === undefined || tok.dueAt > sim.clock) continue
      if (tok.userId && base.manual.has(tok.userId)) continue
      const idx = indexFor(base, obj)
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
  idx = indexFor(idx, obj)
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

function retryStuck(sim: SimState, base: Index) {
  for (const obj of activeObjects(sim)) {
    for (const tok of [...obj.tokens]) {
      if (tok.state !== 'stuck' || obj.status !== 'active' || !obj.tokens.includes(tok)) continue
      const idx = indexFor(base, obj)
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

/** Unassigned work by step, kept apart per version (a step's settings can differ between versions). */
function unassignedBySteps(sim: SimState, base: Index): Map<string, { nodeId: Id; idx: Index; tokens: Token[] }> {
  const waiting = new Map<string, { nodeId: Id; idx: Index; tokens: Token[] }>()
  for (const obj of activeObjects(sim)) {
    for (const t of obj.tokens) {
      if (t.state !== 'unassigned') continue
      const idx = indexFor(base, obj)
      const key = `${t.nodeId}|${idx.pins}`
      const group = waiting.get(key) ?? { nodeId: t.nodeId, idx, tokens: [] }
      group.tokens.push(t)
      waiting.set(key, group)
    }
  }
  return waiting
}

function supervise(sim: SimState, base: Index) {
  let loads: Map<Id, number> | undefined
  const urgency = byUrgency((t) => t.enteredAt, objectOf(sim))
  // Dispatch rounds are per step, whichever versions its waiting items run.
  const round = new Map<Id, boolean>()
  const dueRound = (nodeId: Id, every: number) => {
    if (!round.has(nodeId)) {
      const last = sim.lastDistribution[nodeId]
      const due = last !== undefined && sim.clock - last >= Math.max(5, every)
      if (last === undefined || due) sim.lastDistribution[nodeId] = sim.clock
      round.set(nodeId, due)
    }
    return round.get(nodeId)!
  }
  for (const { nodeId, idx, tokens: pending } of unassignedBySteps(sim, base).values()) {
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
      for (const t of pending) {
        const o = sim.objects[t.objectId]!
        if (ws.userId && !excludedFor(o, ws).has(ws.userId)) assign(sim, o, t, ws.userId, 'assigned', `Assigned directly to ${userName(idx, ws.userId)}`)
      }
    } else if (ws.distribution === 'manager' && ws.autoDistribute && !idx.live) {
      if (!dueRound(nodeId, ws.distributeEveryMinutes)) continue
      const members = availableMembers(idx, ws)
      // Dispatchers driven by a real person in the Workspace do it themselves.
      const dispatchers = distributorsOf(idx, ws).filter((id) => !idx.manual.has(id))
      if (!members.length || !dispatchers.length) continue
      for (const t of pending) {
        const o = sim.objects[t.objectId]!
        const ex = excludedFor(o, ws)
        const eligible = ex.size ? members.filter((m) => !ex.has(m.id)) : members
        if (!eligible.length) continue
        const by = userName(idx, pick(sim, dispatchers))
        // A dispatcher's judgment, not an algorithm: favors faster people, so loads end up uneven.
        const u = weightedPick(sim, eligible, (m) => 1 / (m.speed * m.speed))!
        assign(sim, o, t, u.id, 'distributed', `${by} assigned it to ${u.name}`, by)
      }
    }
  }
}

/**
 * Queue steps each person can fetch from (the group members of every queue
 * step, in every version items run). A step one version gives to another group
 * is listed for both groups; take items only through `canFetch`.
 */
function queueStepsByUser(idx: Index): Map<Id, Id[]> {
  const map = new Map<Id, Id[]>()
  for (const { node } of idx.base.steps) {
    if (node.type !== 'user' || node.data.distribution !== 'queue' || !node.data.groupId) continue
    for (const uid of idx.group.get(node.data.groupId)?.memberIds ?? []) {
      const l = map.get(uid) ?? []
      if (!l.includes(node.id)) l.push(node.id)
      map.set(uid, l)
    }
  }
  return map
}

/** May this person take this waiting item from its queue (its own version's group, separation of duties)? */
export function canFetch(sim: SimState, ws: WorkStep | undefined, tok: Token, userId: Id, idx: Index): boolean {
  if (ws?.distribution !== 'queue' || !idx.group.get(ws.groupId ?? '')?.memberIds.includes(userId)) return false
  return !excludedFor(sim.objects[tok.objectId]!, ws).has(userId)
}

export { queueStepsByUser }

function pullWork(sim: SimState, base: Index) {
  const baskets = new Map<Id, Token[]>()
  const queues = new Map<Id, Token[]>()
  const steps = new Map<Token, WorkStep>()
  for (const obj of activeObjects(sim)) {
    for (const t of obj.tokens) {
      if (t.state === 'assigned' && t.userId) {
        const b = baskets.get(t.userId) ?? []
        b.push(t)
        baskets.set(t.userId, b)
      } else if (t.state === 'unassigned') {
        const ws = workStepOf(indexFor(base, obj), t)
        if (ws?.distribution === 'queue') {
          const q = queues.get(t.nodeId) ?? []
          q.push(t)
          queues.set(t.nodeId, q)
          steps.set(t, ws)
        }
      }
    }
  }
  const objOf = objectOf(sim)
  for (const b of baskets.values()) b.sort(byUrgency((t) => t.assignedAt ?? 0, objOf))
  for (const q of queues.values()) q.sort(byUrgency((t) => t.enteredAt, objOf))

  const queueNodesByUser = queueStepsByUser(base)
  const users = base.ctx.users
  const n = users.length
  const offset = n ? Math.floor(sim.clock) % n : 0
  for (let i = 0; i < n; i++) {
    const u = users[(offset + i) % n]!
    if (!u.available || base.manual.has(u.id)) continue
    const st = ustat(sim, u.id)
    if (st.currentId) {
      const cur = findToken(sim, st.currentId)?.tok
      if (cur && cur.state === 'working' && cur.userId === u.id) continue
      st.currentId = undefined
    }
    let next = baskets.get(u.id)?.shift()
    if (!next) {
      // Fetch: take the most urgent, oldest item from any queue this user can work.
      let best: { q: Token[]; at: number } | undefined
      for (const nodeId of queueNodesByUser.get(u.id) ?? []) {
        const q = queues.get(nodeId)
        // The first item this person may take (separation of duties can rule some out).
        const at = q ? q.findIndex((t) => canFetch(sim, steps.get(t), t, u.id, base)) : -1
        if (q && at >= 0 && (!best || byUrgency((t) => t.enteredAt, objOf)(q[at]!, best.q[best.at]!) < 0)) best = { q, at }
      }
      const fetched = best ? best.q.splice(best.at, 1)[0] : undefined
      if (fetched) {
        assign(sim, sim.objects[fetched.objectId]!, fetched, u.id, 'fetched', `${u.name} fetched it from the queue`)
        next = fetched
      }
    }
    if (next) startWork(sim, base, next, u)
  }
}

function startWork(sim: SimState, base: Index, tok: Token, u: User) {
  const obj = sim.objects[tok.objectId]
  const ws = obj && workStepOf(indexFor(base, obj), tok)
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
      obj.data = normalizeData(type!, obj.data)
      audit(sim, obj, { kind: 'field', nodeId, fieldIds: [f.id], redacted: `${f.label} set`, text: `${f.label} set to ${displayValue(idx, type, f.id, value)}` })
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
/** Short "where is it" text for a branch, e.g. "Manager approval (with Marcus Hale)". */
export function describeTokenText(idx: Index, t: Token): string {
  const label = stepOf(idx, t.nodeId)?.node.data.label ?? 'a removed step'
  const who = t.userId ? (idx.user.get(t.userId)?.name ?? 'someone') : undefined
  const state: Record<Token['state'], string> = {
    working: `${who} working`,
    assigned: `with ${who}`,
    unassigned: 'waiting',
    queued: 'queued for a service',
    joining: 'waiting for other branches',
    waiting: 'on a timer',
    stuck: 'stuck',
    auto: 'in progress',
  }
  return `${label} (${state[t.state]})`
}

// ---------- Expedite ----------

/** Due-date / escalation multiplier for an item: the workflow's expedite factor when expedited, else 1. */
export function speedFactor(idx: Index, obj: SimObject): number {
  if (!obj.expedite) return 1
  const f = indexFor(idx, obj).wf.get(obj.workflowId)?.expedite?.slaFactor ?? 0.5
  return Math.min(1, Math.max(0.05, f))
}

/** Flag an item as expedited: front of every queue, tighter due date. */
export function markExpedited(sim: SimState, idx: Index, obj: SimObject, by: string, reason?: string) {
  if (obj.expedite) return
  obj.expedite = { by, at: sim.clock, reason: reason?.trim() || undefined }
  const wf = indexFor(idx, obj).wf.get(obj.workflowId)
  if (wf?.targetHours) obj.dueBy = Math.min(obj.dueBy ?? Infinity, obj.createdAt + wf.targetHours * 60 * speedFactor(idx, obj))
  audit(sim, obj, { kind: 'priority', actor: by, text: `Expedited by ${by}${obj.expedite.reason ? `: ${obj.expedite.reason}` : ''}`, comment: obj.expedite.reason })
}

export function clearExpedited(sim: SimState, idx: Index, obj: SimObject, by: string) {
  if (!obj.expedite) return
  obj.expedite = undefined
  const wf = indexFor(idx, obj).wf.get(obj.workflowId)
  if (wf?.targetHours) obj.dueBy = obj.createdAt + wf.targetHours * 60
  audit(sim, obj, { kind: 'priority', actor: by, text: `No longer expedited (by ${by})` })
}

// ---------- Roles and supervisors ----------

function inAudience(idx: Index, a: { userIds?: Id[]; groupIds?: Id[] } | undefined, userId: Id): boolean {
  if (!a) return false
  if (a.userIds?.includes(userId)) return true
  return !!a.groupIds?.some((g) => idx.group.get(g)?.memberIds.includes(userId))
}

function audienceMembers(idx: Index, a: { userIds?: Id[]; groupIds?: Id[] } | undefined): Id[] {
  if (!a) return []
  return [...new Set([...(a.userIds ?? []), ...(a.groupIds ?? []).flatMap((g) => idx.group.get(g)?.memberIds ?? [])])]
}

export function hasRole(idx: Index, userId: Id, role: 'admin' | 'designer' | 'auditor'): boolean {
  return !!idx.user.get(userId)?.roles?.includes(role)
}

// Authorization across versions: access is the stricter of the version an item
// runs and the live (published) version. Removing a supervisor or adding a lock
// takes effect on items already in flight; adding a supervisor reaches only the
// items it can see in both. Drafts grant and revoke nothing until published.

/**
 * Who supervises a work item: the supervisors of its step, the supervisor of the
 * step's work group, and the process supervisors of its workflow and of every
 * workflow it was called from (a subflow's work is also its parent process's work).
 * They must supervise it in the item's version and in the live version; at a
 * step the live version no longer has, only the live process supervisors qualify.
 */
export function supervisorsOf(idx: Index, obj: SimObject, tok: Token): Set<Id> {
  const own = supervisorsIn(indexFor(idx, obj), obj, tok)
  const live = supervisorsIn(idx.base, obj, tok)
  return new Set([...own].filter((id) => live.has(id)))
}

/** Supervisors of a work item as one index (one set of versions) defines them. */
function supervisorsIn(idx: Index, obj: SimObject, tok: Token): Set<Id> {
  const out = new Set<Id>()
  const node = idx.node.get(tok.nodeId)?.node
  if (node?.type === 'user') {
    for (const id of audienceMembers(idx, node.data.supervisors)) out.add(id)
    const sup = node.data.groupId ? idx.group.get(node.data.groupId)?.supervisorId : undefined
    if (sup) out.add(sup)
  }
  if (node?.type === 'auto' && node.data.fallbackGroupId) {
    const sup = idx.group.get(node.data.fallbackGroupId)?.supervisorId
    if (sup) out.add(sup)
  }
  const flows = new Set<Id>([tok.workflowId, obj.workflowId, ...tok.calls.map((c) => c.workflowId)])
  for (const wfId of flows) for (const id of audienceMembers(idx, idx.wf.get(wfId)?.supervisors)) out.add(id)
  return out
}

/** May this person supervise this work item? Administrators may supervise anything. */
export function canSuperviseToken(idx: Index, obj: SimObject, tok: Token, userId: Id): boolean {
  return hasRole(idx, userId, 'admin') || supervisorsOf(idx, obj, tok).has(userId)
}

/** Process supervisors of a workflow (named users and group members), in this index's version and the live one. */
export function processSupervisors(idx: Index, workflowId: Id): Id[] {
  const live = new Set(audienceMembers(idx, idx.base.wf.get(workflowId)?.supervisors))
  return audienceMembers(idx, idx.wf.get(workflowId)?.supervisors).filter((id) => live.has(id))
}

/** Does this person supervise the process (or is an administrator)? In this index's version and the live one both. */
export function supervisesProcess(idx: Index, workflowId: Id, userId: Id): boolean {
  if (hasRole(idx, userId, 'admin')) return true
  return inAudience(idx, idx.wf.get(workflowId)?.supervisors, userId) && inAudience(idx, idx.base.wf.get(workflowId)?.supervisors, userId)
}

/** Every workflow that runs this one as a subflow, directly or through other subflows. */
function callersOf(idx: Index, wfId: Id, seen = new Set<Id>([wfId])): Workflow[] {
  const out: Workflow[] = []
  for (const w of idx.ctx.app.workflows) {
    if (seen.has(w.id) || !w.nodes.some((n) => n.type === 'subflow' && n.data.workflowId === wfId)) continue
    seen.add(w.id)
    out.push(w, ...callersOf(idx, w.id, seen))
  }
  return out
}

/**
 * Does this person supervise this step (step supervisors, its group's supervisor,
 * or its process)? As the given index defines it and as the live version does; a
 * step the live version no longer has is overseen only by the live process supervisors.
 */
export function supervisesStep(idx: Index, nodeId: Id, userId: Id): boolean {
  const base = idx.base
  const found = stepOf(idx, nodeId)
  if (!found) return false
  const live = base.node.get(nodeId)
  if (!(live ? oversees(base, live, userId) : oversees(base, found, userId, true))) return false
  const own = idx.node.get(nodeId)
  return idx === base || !own || oversees(idx, own, userId)
}

/** The supervision rule for one step as one index defines it (`processOnly`: ignore the step's own supervisors). */
function oversees(idx: Index, found: { node: WfNode; wf: Workflow }, userId: Id, processOnly = false): boolean {
  if (hasRole(idx, userId, 'admin') || inAudience(idx, idx.wf.get(found.wf.id)?.supervisors, userId)) return true
  // A subflow's steps are also overseen by the supervisors of every process that calls it.
  if (callersOf(idx, found.wf.id).some((w) => inAudience(idx, w.supervisors, userId))) return true
  const n = found.node
  if (processOnly || n.type !== 'user') return false
  return inAudience(idx, n.data.supervisors, userId) || (!!n.data.groupId && idx.group.get(n.data.groupId)?.supervisorId === userId)
}

/**
 * Field access on an item under the version it runs and under the live version,
 * the stricter per field: a lock published later applies to items in flight too.
 * `input` builds the access question for one index.
 */
export function itemFieldVerdicts(idx: Index, obj: SimObject, input: (idx: Index) => AccessInput): Record<Id, FieldVerdict> {
  const own = indexFor(idx, obj)
  const mine = fieldVerdicts(input(own))
  return own === own.base ? mine : strictestVerdicts(mine, fieldVerdicts(input(own.base)))
}

// ---------- Live mode: external workers (the "device" protocol) ----------

export interface Job {
  /** The token id; stable for the life of the call. */
  id: Id
  itemId: Id
  itemNumber: string
  serviceId: Id
  operation: string
  attempt: number
  /** Request parameters with {field:<id>} and {number} placeholders resolved. */
  inputs: Record<string, unknown>
}

function resolveInputs(obj: SimObject, inputs: Record<string, string> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, raw] of Object.entries(inputs ?? {})) {
    const whole = /^\{field:([^}]+)\}$/.exec(raw.trim())
    out[k] = whole ? obj.data[whole[1]!] : raw.replace(/\{field:([^}]+)\}/g, (_, f: string) => String(obj.data[f] ?? '')).replace(/\{number\}/g, obj.number)
  }
  return out
}

/** Claim up to `max` jobs for a service. A claimed job is leased to the worker until it completes, fails or the lease runs out. */
export function pollJobs(sim: SimState, ctx: Ctx, serviceId: Id, workerId: string, max = 1, leaseMinutes = 5): Job[] {
  const idx = buildIndex(ctx)
  const jobs: Job[] = []
  const waiting = activeTokens(sim)
    .filter((t) => t.state === 'auto' && !t.manual && t.serviceId === serviceId && (t.leaseUntil === undefined || t.leaseUntil <= sim.clock))
    .sort(byUrgency((t) => t.startedAt ?? t.enteredAt, objectOf(sim)))
  for (const tok of waiting.slice(0, max)) {
    const obj = sim.objects[tok.objectId]!
    const node = indexFor(idx, obj).node.get(tok.nodeId)?.node
    if (node?.type !== 'auto') continue
    const { op } = serviceOf(idx, node.data)
    tok.workerId = workerId
    tok.leaseUntil = sim.clock + leaseMinutes
    jobs.push({ id: tok.id, itemId: obj.id, itemNumber: obj.number, serviceId, operation: op?.name ?? '', attempt: tok.attempt ?? 1, inputs: resolveInputs(obj, node.data.inputs) })
  }
  return jobs
}

function jobAt(sim: SimState, ctx: Ctx, jobId: Id) {
  const found = findToken(sim, jobId)
  const idx = indexFor(buildIndex(ctx), found?.obj)
  const node = found && idx.node.get(found.tok.nodeId)?.node
  if (!found || found.obj.status !== 'active' || node?.type !== 'auto' || !found.tok.serviceId || found.tok.manual) return undefined
  const { svc, op } = serviceOf(idx, node.data)
  return svc && op ? { idx, ...found, node, svc, op } : undefined
}

/** A worker finished a job: outputs are stored on the item and the process continues. */
export function completeJob(sim: SimState, ctx: Ctx, jobId: Id, outputs: Record<string, unknown> = {}): boolean {
  const j = jobAt(sim, ctx, jobId)
  if (!j) return false
  completeCall(sim, j.idx, j.obj, j.tok, j.node, j.svc, j.op, outputs)
  return true
}

/** A worker gave up on a job: it is retried or handled by the step's failure policy. */
export function failJob(sim: SimState, ctx: Ctx, jobId: Id, error = 'failed'): boolean {
  const j = jobAt(sim, ctx, jobId)
  if (!j) return false
  failCall(sim, j.idx, j.obj, j.tok, j.node, j.svc, j.op, error)
  return true
}

export const internals = { toManual, tryDispatch, withdraw, evaluateJoin, dropToken, finishScope }
