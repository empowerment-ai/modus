// Projections: the rows SQL storage keeps beside each application's state, so
// worklists and search (M3) can query items and open work without loading the
// whole state. Pure: the same function feeds the memory and Postgres adapters.

import { objectTitle } from '../model/format'
import type { Id, Priority } from '../model/types'
import { buildIndex, type Index } from './engine'
import type { AuditEntry, Ctx, SimObject, SimState, Token, TokenState } from './state'
import { workItemOf } from './view'

export interface ItemRow {
  itemId: Id
  number: string
  title: string
  status: 'active' | 'completed' | 'rejected' | 'cancelled'
  priority: Priority
  expedited: boolean
  /** Simulated minutes, like the audit trail. */
  dueAt?: number
  createdAt: number
  endedAt?: number
  /** The item's live data object, not a copy: storage must copy or serialize it. */
  data: Record<string, unknown>
}

/** One open thread of an item: where it is and who or what has it. */
export interface WorkItemRow {
  tokenId: Id
  itemId: Id
  stepId: Id
  state: TokenState
  assignee?: Id
  groupId?: Id
  serviceId?: Id
  enteredAt: number
  dueAt?: number
  priority: Priority
}

export interface ProjectedItem {
  item: ItemRow
  /** Every row the item has now; storage replaces the item's old rows with these. */
  workItems: WorkItemRow[]
}

/** Pass `idx` when projecting many items, so the index is built once. */
export function projectItem(sim: SimState, ctx: Ctx, itemId: Id, idx: Index = buildIndex(ctx)): ProjectedItem | undefined {
  const obj = sim.objects[itemId]
  if (!obj) return undefined
  const type = ctx.app.objectTypes.find((t) => t.id === obj.typeId)
  const item: ItemRow = {
    itemId: obj.id,
    number: obj.number,
    title: objectTitle(type, obj.data, ctx.app.lists, ctx.users),
    status: obj.status,
    priority: obj.priority,
    expedited: !!obj.expedite,
    dueAt: obj.dueBy,
    createdAt: obj.createdAt,
    endedAt: obj.status === 'active' ? undefined : obj.completedAt,
    data: obj.data,
  }
  const workItems = obj.tokens.map((t): WorkItemRow => {
    const wi = workItemOf(sim, idx, t)
    return {
      tokenId: t.id,
      itemId: obj.id,
      stepId: t.nodeId,
      state: t.state,
      assignee: t.userId,
      groupId: wi?.step.groupId,
      serviceId: t.serviceId,
      enteredAt: t.enteredAt,
      dueAt: wi?.due ?? obj.dueBy,
      priority: obj.priority,
    }
  })
  return { item, workItems }
}

export interface OutboxMessage {
  itemId: Id
  /** `job.ready`: a worker can take this call. `notify`: someone should hear about this entry. */
  kind: 'job.ready' | 'notify'
  payload: Record<string, unknown>
}

export interface Changes {
  /** Items whose projection rows must be rewritten, in id order. */
  itemIds: Id[]
  /** Audit entries added per item, oldest first. */
  entries: Array<{ itemId: Id; itemNumber: string; entries: AuditEntry[] }>
  outbox: OutboxMessage[]
}

// Per step and attempt, so a call that leads straight into another service step is a new job.
// A loop back into the same step within one command is not distinguished.
const jobKey = (t: Token) => `${t.id}#${t.nodeId}#${t.attempt ?? 1}`
const isJob = (t: Token) => t.state === 'auto' && !!t.serviceId && !t.manual
/** What projections show of a token; any difference means the item's rows change. */
const tokenSig = (o: SimObject) => o.tokens.map((t) => `${t.id}|${t.nodeId}|${t.state}|${t.userId ?? ''}|${t.serviceId ?? ''}|${t.enteredAt}`).join(',')

/**
 * What a command changed: the audit entries to log, the items to re-project, and messages for the outbox.
 * `before` must be a deep snapshot (structuredClone); a shallow copy shares the objects and reports nothing.
 */
export function changesBetween(before: SimState, after: SimState): Changes {
  const out: Changes = { itemIds: [], entries: [], outbox: [] }
  const ids = new Set<Id>([...after.activeIds, ...before.activeIds])
  // Also items outside both active lists that gained entries (e.g. a note on a finished item).
  for (const [id, o] of Object.entries(after.objects)) if (o.history.length !== (before.objects[id]?.history.length ?? 0)) ids.add(id)
  for (const id of [...ids].sort()) {
    const now = after.objects[id]
    if (!now) continue
    const was = before.objects[id]
    const added = now.history.slice(was?.history.length ?? 0)
    const ready = new Set((was?.tokens ?? []).filter(isJob).map(jobKey))
    const jobs = now.tokens.filter((t) => isJob(t) && !ready.has(jobKey(t)))
    // A projected field that can change without an audit entry or a token change must be added here.
    const moved = !was || added.length > 0 || tokenSig(was) !== tokenSig(now) || was.status !== now.status || was.priority !== now.priority
    if (!moved) continue
    out.itemIds.push(id)
    if (added.length) out.entries.push({ itemId: id, itemNumber: now.number, entries: added })
    for (const t of jobs) out.outbox.push({ itemId: id, kind: 'job.ready', payload: { tokenId: t.id, serviceId: t.serviceId, nodeId: t.nodeId, attempt: t.attempt ?? 1 } })
    for (const e of added) if (e.kind === 'notify' || e.kind === 'escalated') out.outbox.push({ itemId: id, kind: 'notify', payload: { ...e } })
  }
  return out
}
