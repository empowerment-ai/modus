// Operations people perform on live work: administrators (reassign, move,
// release, retry, cancel…) and end users in the Workspace (claim, get next,
// save, release, delegate, distribute). Each returns a Result so the UI — and
// later the API — can explain a refusal instead of failing silently.

import { blockedFields, type FieldVerdict, fieldVerdicts } from '../model/security'
import { normalizeData } from '../model/tables'
import type { FieldAccess, FieldDef, Id, Priority, WfNode } from '../model/types'
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
  type SimObject,
  type SimState,
  stat,
  type Token,
  userName,
  workStepOf,
} from './engine'

export type Result<T = true> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const fail = (error: string): Result<never> => ({ ok: false, error })

function tokenAt(sim: SimState, tokenId: Id): { obj: SimObject; tok: Token } | undefined {
  const found = findToken(sim, tokenId)
  return found && found.obj.status === 'active' ? found : undefined
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('That work item is no longer active.')
  const { obj, tok } = found
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('That work item is no longer active.')
  const { obj, tok } = found
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
export function adminRedistribute(sim: SimState, ctx: Ctx, nodeId: Id, actor = ADMIN): number {
  const idx = buildIndex(ctx)
  const movable = activeTokens(sim)
    .filter((t) => t.nodeId === nodeId && (t.state === 'assigned' || t.state === 'unassigned') && workStepOf(idx, t))
    .sort(byUrgency((t) => t.enteredAt, (t) => sim.objects[t.objectId]))
  const ws = movable[0] && workStepOf(idx, movable[0])
  if (!ws) return 0
  const before = new Map(movable.map((t) => [t.id, t.userId]))
  for (const t of movable) unassign(sim, t)
  const loads = openLoads(sim)
  let moved = 0
  for (const t of movable) {
    if (!loadBalanceToken(sim, idx, sim.objects[t.objectId]!, t, ws, loads, actor)) break
    if (t.userId !== before.get(t.id)) moved++
  }
  return moved
}

/** Move a work item to another step of the same workflow, skipping the routing rules. */
export function adminMove(sim: SimState, ctx: Ctx, tokenId: Id, nodeId: Id, actor = ADMIN): Result {
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('That work item is no longer active.')
  const { obj, tok } = found
  const target = idx.node.get(nodeId)
  if (!target) return fail('That step no longer exists.')
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('That work item is no longer active.')
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('That work item is no longer active.')
  const { obj, tok } = found
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
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('Someone else got to it first, or it moved on.')
  const { obj, tok } = found
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
    const ws = workStepOf(idx, t)
    return !ws || !excludedFor(sim.objects[t.objectId]!, ws).has(userId)
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
  const idx = buildIndex(ctx)
  const found = findToken(sim, tokenId)
  if (!found) return undefined
  return fieldVerdicts(securityInput(idx, found.obj, found.tok, userId))
}

/** Save changes without releasing. Locked or hidden fields are refused. */
export function workSave(sim: SimState, ctx: Ctx, tokenId: Id, userId: Id, patch: Record<string, unknown>): Result {
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found || found.tok.userId !== userId) return fail('It is not in your basket.')
  const { obj, tok } = found
  const type = idx.type.get(obj.typeId)
  const blocked = blockedFields(securityInput(idx, obj, tok, userId), changedOnly(obj, patch, type))
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found || found.tok.userId !== userId) return fail('It is not in your basket.')
  const { obj, tok } = found
  const ws = workStepOf(idx, tok)
  const outcome = ws?.outcomes.find((o) => o.id === outcomeId)
  if (!ws || !outcome) return fail('Pick how you are releasing it.')
  if (outcome.requireComment && !comment.trim()) return fail(`“${outcome.label}” needs a comment.`)
  const saved = workSave(sim, ctx, tokenId, userId, patch)
  if (!saved.ok) return saved
  // Required fields you can edit here must be filled before it moves on (rejections excepted).
  const input = securityInput(idx, obj, tok, userId)
  const unhappy = /reject|deny|return|cancel|could not/i.test(outcome.label)
  if (!unhappy && ws.node.type === 'user') {
    const missing = input.type.fields.filter((f) => f.required && (ws.node.type === 'user' ? (ws.node.data.fieldAccess[f.id] ?? 'edit') === 'edit' : false) && isEmpty(obj.data[f.id]))
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found || found.tok.userId !== userId) return fail('It is not in your basket.')
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found || found.tok.userId !== userId) return fail('It is not in your basket.')
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return fail('That item moved on.')
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
  const idx = buildIndex(ctx)
  const waiting = activeTokens(sim).filter((t) => t.nodeId === nodeId && t.state === 'unassigned')
  const ws = waiting[0] && workStepOf(idx, waiting[0])
  if (!ws) return fail('Nothing is waiting to be handed out.')
  if (!distributorsOf(idx, ws).includes(dispatcherId)) return fail(`You don’t distribute work for “${ws.label}”.`)
  waiting.sort(byUrgency((t) => t.enteredAt, (t) => sim.objects[t.objectId]))
  const loads = openLoads(sim)
  let n = 0
  for (const t of waiting) if (loadBalanceToken(sim, idx, sim.objects[t.objectId]!, t, ws, loads, userName(idx, dispatcherId))) n++
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
  const wf = ctx.app.workflows.find((w) => w.id === workflowId)
  const type = ctx.app.objectTypes.find((t) => t.id === wf?.objectTypeId)
  if (!wf || !type) return []
  return blockedFields({ type, wf, userId, groups: ctx.groups, admin: hasRole(buildIndex(ctx), userId, 'admin'), creating: true }, data).filter((b) => !b.field.total)
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
  const idx = buildIndex(ctx)
  const found = tokenAt(sim, tokenId)
  if (!found) return 'That work item is no longer active.'
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
  return ok(adminRedistribute(sim, ctx, nodeId, userName(idx, byUserId)))
}

export function superviseSetPriority(sim: SimState, ctx: Ctx, objectId: Id, priority: Priority, byUserId: Id): Result {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active') return fail('That item is no longer active.')
  if (!supervisesItem(idx, obj, byUserId)) return fail(`${userName(idx, byUserId)} doesn’t supervise ${obj.number}.`)
  return adminSetPriority(sim, ctx, objectId, priority, userName(idx, byUserId))
}

function supervisesItem(idx: Index, obj: SimObject, userId: Id): boolean {
  return supervisesProcess(idx, obj.workflowId, userId) || obj.tokens.some((t) => canSuperviseToken(idx, obj, t, userId))
}

// ---------- Expedite ----------

/** May this person flag (or unflag) the item as expedited, under its workflow's policy? */
export function canExpedite(sim: SimState, ctx: Ctx, objectId: Id, userId: Id): boolean {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active') return false
  if (hasRole(idx, userId, 'admin') || supervisesItem(idx, obj, userId)) return true
  const who = idx.wf.get(obj.workflowId)?.expedite?.who ?? 'supervisors'
  if (who === 'supervisors') return false
  if (obj.createdBy === userId) return true
  return who === 'anyone' && obj.tokens.some((t) => t.userId === userId)
}

/** Flag an item as expedited (or take the flag off). Expedited work goes to the front of every queue. */
export function setExpedite(sim: SimState, ctx: Ctx, objectId: Id, userId: Id, on: boolean, reason = ''): Result {
  const idx = buildIndex(ctx)
  const obj = sim.objects[objectId]
  if (!obj || obj.status !== 'active') return fail('That item is no longer active.')
  if (!canExpedite(sim, ctx, objectId, userId)) {
    const who = idx.wf.get(obj.workflowId)?.expedite?.who ?? 'supervisors'
    return fail(who === 'supervisors' ? 'Only supervisors can expedite items in this process.' : 'Only the requester or a supervisor can expedite this item.')
  }
  if (on && obj.expedite) return fail(`${obj.number} is already expedited.`)
  if (!on && !obj.expedite) return fail(`${obj.number} isn’t expedited.`)
  if (on && idx.wf.get(obj.workflowId)?.expedite?.requireReason && !reason.trim()) return fail('Say why it needs to go faster.')
  if (on) markExpedited(sim, idx, obj, userName(idx, userId), reason)
  else clearExpedited(sim, idx, obj, userName(idx, userId))
  return ok(true)
}

export { markStuck, releaseServiceSlot, serviceOf }
