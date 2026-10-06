// Operations people perform on live work: administrators (reassign, move,
// release, retry, cancel…) and end users in the Workspace (claim, get next,
// save, release, delegate, distribute). Each returns a Result so the UI — and
// later the API — can explain a refusal instead of failing silently.

import { blockedBy, blockedFields, type FieldVerdict } from '../model/security'
import { normalizeData } from '../model/tables'
import type { ExpeditePolicy, FieldAccess, FieldDef, Id, Priority, WfNode } from '../model/types'
import {
  ADMIN,
  activeTokens,
  advanceFrom,
  assign,
  audit,
  buildIndex,
  byUrgency,
  canSuperviseToken,
  clearExpedited,
  hasRole,
  indexFor,
  itemFieldVerdicts,
  markExpedited,
  supervisesProcess,
  supervisesStep,
  type Ctx,
  displayValue,
  distributorsOf,
  enterNode,
  excludedFor,
  findToken,
  freeWorker,
  type Index,
  internals,
  loadBalanceToken,
  markStuck,
  nodeLabel,
  openLoads,
  PRIORITY_RANK,
  queueStepsByUser,
  release,
  releaseServiceSlot,
  serviceOf,
  canFetch,
  type SimObject,
  type SimState,
  stat,
  type Token,
  userName,
  type WorkStep,
  workStepOf,
} from './engine'

export type Result<T = true> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): Result<never> => ({ ok: false, error })

function tokenAt(sim: SimState, tokenId: Id): { obj: SimObject; tok: Token } | undefined {
  const found = findToken(sim, tokenId)
  return found && found.obj.status === 'active' ? found : undefined
}

/** An active work item and the index of the workflow versions it runs. */
function itemAt(sim: SimState, ctx: Ctx, tokenId: Id): { idx: Index; obj: SimObject; tok: Token } | { idx: Index; obj?: undefined; tok?: undefined } {
  const found = tokenAt(sim, tokenId)
  const idx = indexFor(buildIndex(ctx), found?.obj)
  return found ? { idx, ...found } : { idx }
}

function isMember(idx: Index, groupId: Id | undefined, userId: Id): boolean {
  return !!groupId && !!idx.group.get(groupId)?.memberIds.includes(userId)
}

// ---------- Administrator ----------

/**
 * Assign or reassign a work item. At an automated step this takes the work away
 * from the automation and gives it to a person to do by hand.
 * `sameGroupOnly` restricts the target to the step's own group (used for
 * supervisors and dispatchers; full administrators may pick anyone).
 */
export function adminAssign(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id, actor = ADMIN, opts: { sameGroupOnly?: boolean } = {}): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj) return fail('That work item is no longer active.')
  const node = idx.node.get(tok.nodeId)?.node
  if (!idx.user.has(userId)) return fail('Unknown person.')
  if (node?.type === 'auto' && !tok.manual) {
    if (opts.sameGroupOnly && !isMember(idx, node.data.fallbackGroupId, userId)) return fail(`Only members of the step’s fallback group can take over “${node.data.label}”.`)
    internals.toManual(sim, idx, obj, tok, node, userId, actor)
    return ok(true)
  }
  const ws = workStepOf(idx, tok)
  if (!ws) return fail('Only work at a people step (or an automated step) can be assigned.')
  if (tok.userId === userId && (tok.state === 'assigned' || tok.state === 'working')) return fail(`Already with ${userName(idx, userId)}.`)
  if (opts.sameGroupOnly && ws.groupId && !isMember(idx, ws.groupId, userId)) return fail(`${userName(idx, userId)} is not in ${idx.group.get(ws.groupId)?.name ?? 'the step’s group'}.`)
  if (opts.sameGroupOnly && excludedFor(obj, ws).has(userId)) return fail(separation(idx, ws, userId))
  const prev = tok.userId
  const text = prev ? `Reassigned from ${userName(idx, prev)} to ${userName(idx, userId)} by ${actor}` : `Assigned to ${userName(idx, userId)} by ${actor}`
  assign(sim, obj, tok, userId, 'reassigned', text, actor)
  return ok(true)
}

export function adminReturnToPool(sim: SimState, ctx: Ctx, tokenId: Id, actor = ADMIN): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj) return fail('That work item is no longer active.')
  if (!workStepOf(idx, tok)) return fail('Only work at a people step can be returned.')
  if (tok.state === 'unassigned') return fail('It is not assigned to anyone.')
  const prev = tok.userId
  unassign(sim, tok)
  audit(sim, obj, { kind: 'returned', nodeId: tok.nodeId, tokenId: tok.id, actor, text: `Taken from ${userName(idx, prev)} and returned to the pool by ${actor}` })
  return ok(true)
}

function unassign(sim: SimState, tok: Token) {
  freeWorker(sim, tok)
  tok.state = 'unassigned'
  tok.userId = undefined
  tok.assignedAt = undefined
  tok.startedAt = undefined
  tok.dueAt = undefined
}

/** Even out everything not yet being worked at a step across its available members. Returns how many moved. */
export function adminRedistribute(sim: SimState, ctx: Ctx, nodeId: Id, actor = ADMIN, only?: (obj: SimObject, tok: Token) => boolean): number {
  const groups = waitingBySteps(sim, buildIndex(ctx), (t) => t.nodeId === nodeId && (t.state === 'assigned' || t.state === 'unassigned') && (!only || only(sim.objects[t.objectId]!, t)))
  if (!groups.length) return 0
  const all = groups.flatMap((g) => g.tokens)
  const before = new Map(all.map((t) => [t.id, t.userId]))
  for (const t of all) unassign(sim, t)
  const loads = openLoads(sim)
  let moved = 0
  for (const { idx, ws, tokens } of groups) {
    for (const t of tokens) {
      if (!loadBalanceToken(sim, idx, sim.objects[t.objectId]!, t, ws, loads, actor)) break
      if (t.userId !== before.get(t.id)) moved++
    }
  }
  return moved
}

/**
 * Work at a people step matching `pick`, most urgent first, grouped by the
 * version it runs (the step's group and settings can differ between versions).
 */
function waitingBySteps(sim: SimState, base: Index, pick: (t: Token) => boolean): Array<{ idx: Index; ws: WorkStep; tokens: Token[] }> {
  const groups = new Map<Index, { idx: Index; ws: WorkStep; tokens: Token[] }>()
  const tokens = activeTokens(sim).filter(pick).sort(byUrgency((t) => t.enteredAt, (t) => sim.objects[t.objectId]))
  for (const t of tokens) {
    const idx = indexFor(base, sim.objects[t.objectId])
    const ws = workStepOf(idx, t)
    if (!ws) continue
    const g = groups.get(idx) ?? { idx, ws, tokens: [] }
    g.tokens.push(t)
    groups.set(idx, g)
  }
  return [...groups.values()]
}

/** Move a work item to another step of the same workflow, skipping the routing rules. */
export function adminMove(sim: SimState, ctx: Ctx, tokenId: Id, nodeId: Id, actor = ADMIN): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj) return fail('That work item is no longer active.')
  const target = idx.node.get(nodeId)
  if (!target) return fail('That step isn’t in the version this item runs.')
  if (tok.nodeId === nodeId) return fail('It is already there.')
  if (target.wf.id !== tok.workflowId) return fail('Items can only be moved within the workflow they are in.')
  const from = nodeLabel(idx, tok.nodeId)
  const s = stat(sim, tok.nodeId)
  s.exited++
  s.timeInStep += sim.clock - tok.enteredAt
  if (tok.state === 'joining') {
    for (const f of tok.forks) {
      const fork = sim.forks[f.forkId]
      if (fork) fork.arrived = fork.arrived.filter((id) => id !== tok.id)
    }
  }
  audit(sim, obj, { kind: 'moved', nodeId: tok.nodeId, tokenId: tok.id, actor, text: `Moved from ${from} to ${nodeLabel(idx, nodeId)} by ${actor}` })
  enterNode(sim, idx, obj, tok, nodeId, 0)
  return ok(true)
}

/** Release on behalf of the assignee (or nobody) with an outcome and comment. */
export function adminRelease(sim: SimState, ctx: Ctx, tokenId: Id, outcomeId: Id, comment: string, actor = ADMIN): Result {
  const { idx, ...found } = itemAt(sim, ctx, tokenId)
  if (!found.obj) return fail('That work item is no longer active.')
  const ws = workStepOf(idx, found.tok)
  if (!ws) return fail('Only work at a people step can be released.')
  const outcome = ws.outcomes.find((o) => o.id === outcomeId)
  if (!outcome) return fail('Pick an outcome.')
  if (outcome.requireComment && !comment.trim()) return fail(`“${outcome.label}” needs a comment.`)
  release(sim, idx, found.obj, found.tok, outcomeId, comment.trim() || undefined, actor)
  return ok(true)
}

/** Try a failed automated call again (or re-run routing for anything else that is stuck). */
export function adminRetry(sim: SimState, ctx: Ctx, tokenId: Id, actor = ADMIN): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj) return fail('That work item is no longer active.')
  const node = idx.node.get(tok.nodeId)?.node
  if (!node) return fail('Its step was removed; move it to another step instead.')
  audit(sim, obj, { kind: 'moved', nodeId: node.id, tokenId: tok.id, actor, text: `${actor} retried ${node.data.label}` })
  if (node.type === 'auto') {
    tok.manual = undefined
    enterNode(sim, idx, obj, tok, node.id, 0)
    return ok(true)
  }
  if (tok.state === 'stuck') {
    tok.state = 'auto'
    advanceFrom(sim, idx, obj, tok, tok.pendingOutcomeId, 0)
    return ok(true)
  }
  return fail('Nothing to retry.')
}

export function adminUpdateData(sim: SimState, ctx: Ctx, objectId: Id, patch: Record<string, unknown>, actor = ADMIN) {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj) return
  writeData(sim, idx, obj, patch, actor)
}

function writeData(sim: SimState, idx: Index, obj: SimObject, patch: Record<string, unknown>, actor: string, nodeId?: Id) {
  const type = idx.type.get(obj.typeId)
  // Computed totals are never written directly; they follow their table.
  const computed = new Set(type?.fields.filter((f) => f.total).map((f) => f.id))
  const before = { ...obj.data }
  for (const [k, v] of Object.entries(patch)) {
    if (computed.has(k)) continue
    if (JSON.stringify(obj.data[k]) === JSON.stringify(v)) continue
    obj.data[k] = v
    const f = type?.fields.find((x) => x.id === k)
    const redacted = `${f?.label} changed by ${actor}`
    if (f && f.type === 'table') audit(sim, obj, { kind: 'field', nodeId, actor, fieldIds: [k], redacted, text: `${f.label} updated by ${actor} (${Array.isArray(v) ? v.length : 0} rows)` })
    else if (f && f.type !== 'attachment') audit(sim, obj, { kind: 'field', nodeId, actor, fieldIds: [k], redacted, text: `${f.label} changed to ${displayValue(idx, type, k, v) || '(blank)'} by ${actor}` })
    else if (f) audit(sim, obj, { kind: 'field', nodeId, actor, fieldIds: [k], redacted, text: `${f.label} updated by ${actor}` })
  }
  if (!type) return
  obj.data = normalizeData(type, obj.data)
  for (const id of computed) {
    if (JSON.stringify(before[id]) === JSON.stringify(obj.data[id])) continue
    const f = type.fields.find((x) => x.id === id)!
    audit(sim, obj, { kind: 'field', nodeId, fieldIds: [id], redacted: `${f.label} recalculated`, text: `${f.label} recalculated: ${displayValue(idx, type, id, obj.data[id])}` })
  }
}

export function adminSetPriority(sim: SimState, ctx: Ctx, objectId: Id, priority: Priority, actor = ADMIN): Result {
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active') return fail('That item is no longer active.')
  if (obj.priority === priority) return fail(`It is already ${priority}.`)
  const was = obj.priority
  obj.priority = priority
  audit(sim, obj, { kind: 'priority', actor, text: `Priority changed from ${was} to ${priority} by ${actor}` })
  void ctx
  return ok(true)
}

/** Cancel the whole item, withdrawing every branch. */
export function adminCancel(sim: SimState, ctx: Ctx, objectId: Id, comment: string, actor = ADMIN): Result {
  const obj = sim.objects[objectId]
  const idx = indexFor(buildIndex(ctx), obj)
  const tok = obj?.tokens[0]
  if (!obj || obj.status !== 'active' || !tok) return fail('That item is no longer active.')
  // Unwind to the top level so the whole item ends, not just a subflow.
  for (const t of obj.tokens) t.calls = []
  audit(sim, obj, { kind: 'withdrawn', actor, comment: comment.trim() || undefined, text: `Cancelled by ${actor}` })
  internals.finishScope(sim, idx, obj, tok, 'cancelled', `Cancelled by ${actor}`)
  return ok(true)
}

// ---------- Workspace: people working their own baskets ----------

/** Claim an item waiting at a step you work (queue fetch, or picking from the pool). */
export function workClaim(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj) return fail('Someone else got to it first, or it moved on.')
  const ws = workStepOf(idx, tok)
  if (!ws || tok.state !== 'unassigned') return fail('It is not waiting to be claimed.')
  if (!isMember(idx, ws.groupId, userId)) return fail(`You are not in ${idx.group.get(ws.groupId ?? '')?.name ?? 'the group'} that works “${ws.label}”.`)
  if (ws.distribution === 'manager') return fail('This step’s work is handed out by its dispatchers.')
  if (excludedFor(obj, ws).has(userId)) return fail(separation(idx, ws, userId))
  assign(sim, obj, tok, userId, 'claimed', `${userName(idx, userId)} claimed it from the queue`, userName(idx, userId))
  return ok(true)
}

/** "Get next": the most urgent, oldest item from any queue this person works. */
export function workNext(sim: SimState, ctx: Ctx, userId: Id): Result<Id> {
  const idx = buildIndex(ctx)
  const steps = new Set(queueStepsByUser(idx).get(userId) ?? [])
  const candidates = activeTokens(sim).filter((t) => {
    if (t.state !== 'unassigned' || !steps.has(t.nodeId)) return false
    const own = indexFor(idx, sim.objects[t.objectId])
    return canFetch(sim, workStepOf(own, t), t, userId, own)
  })
  if (!candidates.length) return fail('Your queues are empty. Nice work.')
  candidates.sort(byUrgency((t) => t.enteredAt, (t) => sim.objects[t.objectId]))
  const tok = candidates[0]!
  const obj = sim.objects[tok.objectId]!
  assign(sim, obj, tok, userId, 'fetched', `${userName(idx, userId)} fetched it from the queue`, userName(idx, userId))
  return ok(tok.id)
}

/** Mark an item in your basket as being worked on now. */
export function workStart(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id): Result {
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found || found.tok.userId !== userId) return fail('It is not in your basket.')
  if (found.tok.state === 'working') return ok(true)
  found.tok.state = 'working'
  found.tok.startedAt = sim.clock
  found.tok.dueAt = undefined
  const s = stat(sim, found.tok.nodeId)
  s.waitTotal += sim.clock - found.tok.enteredAt
  s.waitCount++
  audit(sim, found.obj, { kind: 'started', nodeId: found.tok.nodeId, tokenId, userId, text: `${userName(idx, userId)} started working on it` })
  return ok(true)
}

function securityInput(idx: Index, obj: SimObject, tok: Token, userId: Id) {
  const type = idx.type.get(obj.typeId)!
  const found = idx.node.get(tok.nodeId)
  return { type, wf: found?.wf, node: found && accessNode(found.node, type.fields.map((f) => f.id)), passed: obj.passed, userId, groups: idx.ctx.groups }
}

/**
 * What a person may do with each field at a work item: the stricter of the item's
 * version and the live one. A step the live version no longer has keeps the item's
 * own step access, under the live workflow's locks.
 */
function accessAt(base: Index, obj: SimObject, tok: Token, userId: Id): Record<Id, FieldVerdict> {
  const own = indexFor(base, obj)
  return itemFieldVerdicts(base, obj, (idx) => {
    const input = securityInput(idx, obj, tok, userId)
    if (input.node) return input
    const step = own.node.get(tok.nodeId)
    return { ...input, wf: step ? idx.wf.get(step.wf.id) : input.wf, node: step && accessNode(step.node, input.type.fields.map((f) => f.id)) }
  })
}

/**
 * The node whose field access applies. People doing an automated step by hand may
 * fill in what the service would have returned; everything else is read-only there.
 */
function accessNode(node: WfNode, fieldIds: Id[]): WfNode {
  if (node.type !== 'auto') return node
  const outputs = new Set((node.data.outputs ?? []).map((o) => o.fieldId))
  const fieldAccess: Record<Id, FieldAccess> = Object.fromEntries(fieldIds.map((id) => [id, outputs.has(id) ? 'edit' : 'read']))
  return { id: node.id, type: 'user', position: node.position, data: { label: node.data.label, distribution: 'queue', autoDistribute: false, distributeEveryMinutes: 30, avgMinutes: 1, outcomes: [], fieldAccess } }
}

/** What a person may do with each field of a work item they hold (drives the Workspace form). */
export function accessFor(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id): Record<Id, FieldVerdict> | undefined {
  const found = findToken(sim, tokenId)
  if (!found) return undefined
  return accessAt(buildIndex(ctx), found.obj, found.tok, userId)
}

/** Save changes without releasing. Locked or hidden fields are refused. */
export function workSave(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id, patch: Record<string, unknown>): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj || tok.userId !== userId) return fail('It is not in your basket.')
  const type = idx.type.get(obj.typeId)
  const blocked = blockedBy(type!, accessAt(idx, obj, tok, userId), changedOnly(obj, patch, type))
  if (blocked.length) {
    audit(sim, obj, { kind: 'security', nodeId: tok.nodeId, tokenId, userId, text: `${userName(idx, userId)} tried to change ${blocked.map((b) => b.field.label).join(', ')} (${blocked[0]!.reason}); refused` })
    return fail(`You can’t change ${blocked.map((b) => `${b.field.label} (${b.reason.toLowerCase()})`).join(', ')}.`)
  }
  writeData(sim, idx, obj, changedOnly(obj, patch, type), userName(idx, userId), tok.nodeId)
  return ok(true)
}

function changedOnly(obj: SimObject, patch: Record<string, unknown>, type?: { fields: Array<{ id: Id; total?: unknown }> }): Record<string, unknown> {
  const computed = new Set(type?.fields.filter((f) => f.total).map((f) => f.id))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) if (!computed.has(k) && JSON.stringify(obj.data[k]) !== JSON.stringify(v)) out[k] = v
  return out
}

/** Finish your part: save allowed changes, then release with an outcome (and a comment if required). */
export function workRelease(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id, outcomeId: Id, comment: string, patch: Record<string, unknown> = {}): Result {
  const { idx, obj, tok } = itemAt(sim, ctx, tokenId)
  if (!obj || tok.userId !== userId) return fail('It is not in your basket.')
  const ws = workStepOf(idx, tok)
  const outcome = ws?.outcomes.find((o) => o.id === outcomeId)
  if (!ws || !outcome) return fail('Pick how you are releasing it.')
  if (outcome.requireComment && !comment.trim()) return fail(`“${outcome.label}” needs a comment.`)
  const saved = workSave(sim, ctx, tokenId, userId, patch)
  if (!saved.ok) return saved
  // Required fields you can edit here must be filled before it moves on (rejections excepted).
  const unhappy = /reject|deny|return|cancel|could not/i.test(outcome.label)
  if (!unhappy && ws.node.type === 'user') {
    const access = accessAt(idx, obj, tok, userId)
    const missing = (idx.type.get(obj.typeId)?.fields ?? []).filter((f) => f.required && access[f.id]?.access === 'edit' && isEmpty(obj.data[f.id]))
    if (missing.length) return fail(`Fill in ${missing.map((f) => f.label).join(', ')} first.`)
  }
  release(sim, idx, obj, tok, outcomeId, comment.trim() || undefined, userName(idx, userId))
  return ok(true)
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/** Give it back: to the queue, the pool, or the dispatchers. */
export function workReturn(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id, comment = ''): Result {
  const { idx, ...found } = itemAt(sim, ctx, tokenId)
  if (!found.obj || found.tok.userId !== userId) return fail('It is not in your basket.')
  const ws = workStepOf(idx, found.tok)
  if (!ws) return fail('It can’t be returned from here.')
  if (ws.distribution === 'direct') return fail('This step always goes to you; ask an administrator to reassign it.')
  unassign(sim, found.tok)
  const where = ws.distribution === 'queue' ? 'the queue' : ws.distribution === 'manager' ? 'the dispatchers' : 'the pool'
  audit(sim, found.obj, { kind: 'returned', nodeId: found.tok.nodeId, tokenId, userId, actor: userName(idx, userId), comment: comment.trim() || undefined, text: `${userName(idx, userId)} returned it to ${where}` })
  return ok(true)
}

/** Hand an item in your basket to a colleague in the same group. */
export function workDelegate(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id, toUserId: Id, comment = ''): Result {
  const { idx, ...found } = itemAt(sim, ctx, tokenId)
  if (!found.obj || found.tok.userId !== userId) return fail('It is not in your basket.')
  const ws = workStepOf(idx, found.tok)
  if (!ws) return fail('It can’t be delegated from here.')
  if (!ws.allowDelegate) return fail(`Delegation is turned off for “${ws.label}”.`)
  if (toUserId === userId) return fail('Pick someone else.')
  if (!isMember(idx, ws.groupId, toUserId)) return fail(`${userName(idx, toUserId)} is not in ${idx.group.get(ws.groupId ?? '')?.name ?? 'your group'}.`)
  if (excludedFor(found.obj, ws).has(toUserId)) return fail(separation(idx, ws, toUserId))
  assign(sim, found.obj, found.tok, toUserId, 'delegated', `${userName(idx, userId)} delegated it to ${userName(idx, toUserId)}`, userName(idx, userId))
  if (comment.trim()) found.obj.history[found.obj.history.length - 1]!.comment = comment.trim()
  return ok(true)
}

/** A dispatcher hands an item out to a member of the step's group. */
export function workDistribute(sim: SimState, ctx: Ctx, tokenId: Id, dispatcherId: Id, toUserId: Id): Result {
  const { idx, ...found } = itemAt(sim, ctx, tokenId)
  if (!found.obj) return fail('That item moved on.')
  const ws = workStepOf(idx, found.tok)
  if (!ws) return fail('It is not at a people step.')
  if (!distributorsOf(idx, ws).includes(dispatcherId)) return fail(`You don’t distribute work for “${ws.label}”.`)
  if (!isMember(idx, ws.groupId, toUserId)) return fail(`${userName(idx, toUserId)} is not in ${idx.group.get(ws.groupId ?? '')?.name ?? 'the group'}.`)
  if (found.tok.userId === toUserId) return fail(`Already with ${userName(idx, toUserId)}.`)
  if (excludedFor(found.obj, ws).has(toUserId)) return fail(separation(idx, ws, toUserId))
  const prev = found.tok.userId
  const by = userName(idx, dispatcherId)
  assign(sim, found.obj, found.tok, toUserId, 'distributed', prev ? `${by} moved it from ${userName(idx, prev)} to ${userName(idx, toUserId)}` : `${by} assigned it to ${userName(idx, toUserId)}`, by)
  return ok(true)
}

/** A dispatcher spreads everything waiting at a step evenly across available members. */
export function workDistributeEvenly(sim: SimState, ctx: Ctx, nodeId: Id, dispatcherId: Id): Result<number> {
  const all = waitingBySteps(sim, buildIndex(ctx), (t) => t.nodeId === nodeId && t.state === 'unassigned')
  if (!all.length) return fail('Nothing is waiting to be handed out.')
  const groups = all.filter((g) => distributorsOf(g.idx, g.ws).includes(dispatcherId))
  if (!groups.length) return fail(`You don’t distribute work for “${all[0]!.ws.label}”.`)
  const loads = openLoads(sim)
  let n = 0
  for (const { idx, ws, tokens } of groups) for (const t of tokens) if (loadBalanceToken(sim, idx, sim.objects[t.objectId]!, t, ws, loads, userName(idx, dispatcherId))) n++
  return ok(n)
}

function separation(idx: Index, ws: { separateFrom: Id[]; label: string }, userId: Id): string {
  const steps = ws.separateFrom.map((id) => nodeLabel(idx, id)).join(' or ')
  return `Separation of duties: ${userName(idx, userId)} already did “${steps}” on this item, so someone else must do “${ws.label}”.`
}

/** Can this person create items of this workflow's type? */
export function canCreate(ctx: Ctx, workflowId: Id, userId: Id): boolean {
  const wf = ctx.app.workflows.find((w) => w.id === workflowId)
  const type = ctx.app.objectTypes.find((t) => t.id === wf?.objectTypeId)
  if (!type || wf?.kind === 'subflow') return false
  if (hasRole(buildIndex(ctx), userId, 'admin')) return true
  return Object.entries(type.permissions).some(([gid, p]) => p.create && ctx.groups.find((g) => g.id === gid)?.memberIds.includes(userId))
}

/** Fields in `data` this person may not set on a new item (hidden or locked for them, or set by the workflow). Totals don't count: they are recalculated. */
export function createRefusals(ctx: Ctx, workflowId: Id, userId: Id, data: Record<string, unknown>): Array<{ field: FieldDef; reason: string }> {
  const idx = buildIndex(ctx)
  // New items start on the published version, so its field locks apply.
  const wf = idx.wf.get(workflowId)
  const type = idx.type.get(wf?.objectTypeId ?? '')
  if (!wf || !type) return []
  return blockedFields({ type, wf, userId, groups: ctx.groups, admin: hasRole(idx, userId, 'admin'), creating: true }, data).filter((b) => !b.field.total)
}

/** Raise or lower the priority of an item you are working or created. */
export function workSetPriority(sim: SimState, ctx: Ctx, objectId: Id, userId: Id, priority: Priority): Result {
  const obj = sim.objects[objectId]
  if (!obj) return fail('Unknown item.')
  const idx = buildIndex(ctx)
  const mine = obj.createdBy === userId || obj.tokens.some((t) => t.userId === userId)
  if (!mine) return fail('Only the requester or the person working it can change its priority.')
  if (PRIORITY_RANK[priority] === PRIORITY_RANK[obj.priority]) return fail(`It is already ${priority}.`)
  const was = obj.priority
  obj.priority = priority
  audit(sim, obj, { kind: 'priority', actor: userName(idx, userId), userId, text: `Priority changed from ${was} to ${priority} by ${userName(idx, userId)}` })
  return ok(true)
}

// ---------- Supervisors (of a process or of a step) ----------
// The same levers as an administrator, scoped: only work they supervise, and
// reassignment only within the step's own group (administrators may go wider).

function asSupervisor(sim: SimState, ctx: Ctx, tokenId: Id, byUserId: Id): { idx: Index; obj: SimObject; tok: Token; name: string; admin: boolean } | string {
  const { idx, ...found } = itemAt(sim, ctx, tokenId)
  if (!found.obj) return 'That work item is no longer active.'
  if (!canSuperviseToken(idx, found.obj, found.tok, byUserId)) return `${userName(idx, byUserId)} doesn’t supervise this work.`
  return { idx, ...found, name: userName(idx, byUserId), admin: hasRole(idx, byUserId, 'admin') }
}

export function superviseAssign(sim: SimState, ctx: Ctx, tokenId: Id, toUserId: Id, byUserId: Id): Result {
  const s = asSupervisor(sim, ctx, tokenId, byUserId)
  if (typeof s === 'string') return fail(s)
  return adminAssign(sim, ctx, tokenId, toUserId, s.name, { sameGroupOnly: !s.admin })
}

export function superviseReturn(sim: SimState, ctx: Ctx, tokenId: Id, byUserId: Id): Result {
  const s = asSupervisor(sim, ctx, tokenId, byUserId)
  if (typeof s === 'string') return fail(s)
  return adminReturnToPool(sim, ctx, tokenId, s.name)
}

export function superviseRelease(sim: SimState, ctx: Ctx, tokenId: Id, outcomeId: Id, comment: string, byUserId: Id): Result {
  const s = asSupervisor(sim, ctx, tokenId, byUserId)
  if (typeof s === 'string') return fail(s)
  return adminRelease(sim, ctx, tokenId, outcomeId, comment, s.name)
}

export function superviseRetry(sim: SimState, ctx: Ctx, tokenId: Id, byUserId: Id): Result {
  const s = asSupervisor(sim, ctx, tokenId, byUserId)
  if (typeof s === 'string') return fail(s)
  return adminRetry(sim, ctx, tokenId, s.name)
}

export function superviseRedistribute(sim: SimState, ctx: Ctx, nodeId: Id, byUserId: Id): Result<number> {
  const idx = buildIndex(ctx)
  if (!supervisesStep(idx, nodeId, byUserId)) return fail(`${userName(idx, byUserId)} doesn’t supervise “${idx.node.get(nodeId)?.node.data.label ?? 'that step'}”.`)
  // Only the work they supervise in its own version too (items on older versions may have other supervisors).
  return ok(adminRedistribute(sim, ctx, nodeId, userName(idx, byUserId), (obj, tok) => canSuperviseToken(idx, obj, tok, byUserId)))
}

export function superviseSetPriority(sim: SimState, ctx: Ctx, objectId: Id, priority: Priority, byUserId: Id): Result {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active') return fail('That item is no longer active.')
  if (!supervisesItem(idx, obj, byUserId)) return fail(`${userName(idx, byUserId)} doesn’t supervise ${obj.number}.`)
  return adminSetPriority(sim, ctx, objectId, priority, userName(idx, byUserId))
}

function supervisesItem(idx: Index, obj: SimObject, userId: Id): boolean {
  return supervisesProcess(indexFor(idx, obj), obj.workflowId, userId) || obj.tokens.some((t) => canSuperviseToken(idx, obj, t, userId))
}

// ---------- Expedite ----------

/** May this person flag (or unflag) the item as expedited, under its workflow's policy? */
const WHO_RANK: Record<ExpeditePolicy['who'], number> = { supervisors: 0, requester: 1, anyone: 2 }

/** Who may expedite an item, and whether a reason is needed: the stricter of its version's policy and the live one. */
function expediteRule(idx: Index, obj: SimObject): { who: ExpeditePolicy['who']; requireReason: boolean } {
  const own = indexFor(idx, obj).wf.get(obj.workflowId)?.expedite
  const live = idx.base.wf.get(obj.workflowId)?.expedite
  const a = own?.who ?? 'supervisors'
  const b = live?.who ?? 'supervisors'
  return { who: WHO_RANK[a] <= WHO_RANK[b] ? a : b, requireReason: !!own?.requireReason || !!live?.requireReason }
}

export function canExpedite(sim: SimState, ctx: Ctx, objectId: Id, userId: Id): boolean {
  const obj = sim.objects[objectId]
  const idx = indexFor(buildIndex(ctx), obj)
  if (!obj || obj.status !== 'active') return false
  if (hasRole(idx, userId, 'admin') || supervisesItem(idx, obj, userId)) return true
  const who = expediteRule(idx, obj).who
  if (who === 'supervisors') return false
  if (obj.createdBy === userId) return true
  return who === 'anyone' && obj.tokens.some((t) => t.userId === userId)
}

/** Flag an item as expedited (or take the flag off). Expedited work goes to the front of every queue. */
export function setExpedite(sim: SimState, ctx: Ctx, objectId: Id, userId: Id, on: boolean, reason = ''): Result {
  const obj = sim.objects[objectId]
  const idx = indexFor(buildIndex(ctx), obj)
  if (!obj || obj.status !== 'active') return fail('That item is no longer active.')
  if (!canExpedite(sim, ctx, objectId, userId)) {
    const who = expediteRule(idx, obj).who
    return fail(who === 'supervisors' ? 'Only supervisors can expedite items in this process.' : 'Only the requester or a supervisor can expedite this item.')
  }
  if (on && obj.expedite) return fail(`${obj.number} is already expedited.`)
  if (!on && !obj.expedite) return fail(`${obj.number} isn’t expedited.`)
  if (on && expediteRule(idx, obj).requireReason && !reason.trim()) return fail('Say why it needs to go faster.')
  if (on) markExpedited(sim, idx, obj, userName(idx, userId), reason)
  else clearExpedited(sim, idx, obj, userName(idx, userId))
  return ok(true)
}

export { markStuck, releaseServiceSlot, serviceOf }
