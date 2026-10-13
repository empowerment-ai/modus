// The Monitor's item explorer: filters, text search, order and rows. The Studio
// runs it over its simulation and the server over its live state, so the two
// can't drift.

import { columnAsField } from '../model/conditions'
import { formatFieldValue, objectTitle } from '../model/format'
import { rowsOf, rowText } from '../model/tables'
import type { App, Id, User, WfNode } from '../model/types'
import type { SimObject, SimState } from './state'

export type ExplorerStatus = 'all' | 'active' | 'completed' | 'rejected'

export interface ExplorerFilter {
  /** `rejected` includes cancelled items. */
  status?: ExplorerStatus
  typeId?: Id
  /** At the step, directly or inside a subflow it called. */
  stepId?: Id
  assignee?: Id
  /** Case-insensitive substring of the number or any formatted field value. */
  q?: string
}

/** Where an item sorts: newest first, then by number, then id (unique, so the order is total). */
export interface ExplorerKey {
  createdAt: number
  number: string
  id: Id
}

type Design = { app: App; users: User[] }

/** The explorer's state for an item: its first branch's state while active, else how it finished. */
export function explorerState(o: SimObject): string {
  return o.status === 'active' ? (o.tokens[0]?.state ?? 'auto') : o.status
}

/** Newest first. Negative when `a` comes before `b`. */
export function explorerOrder(a: ExplorerKey, b: ExplorerKey): number {
  return b.createdAt - a.createdAt || b.number.localeCompare(a.number) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
}

// Search text per item, rebuilt only when its history grows (every data change is audited)
// or the design changes. Keyed by the object itself, so a reset simulation reusing ids starts over.
const textCache = new WeakMap<SimObject, { len: number; app: App; users: User[]; text: string }>()

/** Everything `q` matches against, lower case. */
export function explorerText(o: SimObject, { app, users }: Design): string {
  const hit = textCache.get(o)
  if (hit && hit.len === o.history.length && hit.app === app && hit.users === users) return hit.text
  const type = app.objectTypes.find((t) => t.id === o.typeId)
  const parts = [o.number]
  for (const f of type?.fields ?? []) {
    const v = formatFieldValue(f, o.data[f.id], app.lists, users)
    if (v) parts.push(v)
    // Line items are searchable by their contents, not just "3 rows".
    if (f.type === 'table') for (const r of rowsOf(o.data[f.id])) parts.push(rowText(f, r, (c, cv) => formatFieldValue(columnAsField(c), cv, app.lists, users)))
  }
  const text = parts.join(' \u0001 ').toLowerCase()
  textCache.set(o, { len: o.history.length, app, users, text })
  return text
}

/** A predicate for one filter (the query is normalized once). */
export function explorerMatcher(f: ExplorerFilter, design: Design): (o: SimObject) => boolean {
  const q = (f.q ?? '').trim().toLowerCase()
  const status = f.status ?? 'all'
  return (o) => {
    if (status !== 'all' && (status === 'rejected' ? o.status !== 'rejected' && o.status !== 'cancelled' : o.status !== status)) return false
    if (f.typeId && o.typeId !== f.typeId) return false
    if (f.stepId && !o.tokens.some((t) => t.nodeId === f.stepId || t.calls.some((c) => c.nodeId === f.stepId))) return false
    if (f.assignee && !o.tokens.some((t) => t.userId === f.assignee)) return false
    if (q && !explorerText(o, design).includes(q)) return false
    return true
  }
}

/**
 * The matching items, newest first: `limit` of them after `after` (exclusive), the total
 * matching (ignoring `after`), and whether more follow.
 */
export function exploreItems(sim: SimState, design: Design, f: ExplorerFilter, opts: { limit: number; after?: ExplorerKey }): { items: SimObject[]; total: number; more: boolean } {
  const match = explorerMatcher(f, design)
  const matched = Object.values(sim.objects).filter(match)
  const total = matched.length
  const rest = opts.after ? matched.filter((o) => explorerOrder(opts.after!, o) < 0) : matched
  rest.sort(explorerOrder)
  return { items: rest.slice(0, opts.limit), total, more: rest.length > opts.limit }
}

/** Every step by id, including steps the map no longer has where items on older versions can still be. */
export function explorerSteps(app: App): Map<Id, WfNode> {
  const m = new Map<Id, WfNode>()
  for (const wf of app.workflows) for (const n of wf.nodes) m.set(n.id, n)
  for (const wf of app.workflows) for (const v of [...(wf.versions ?? [])].reverse()) for (const n of v.snapshot.nodes) if (!m.has(n.id)) m.set(n.id, n)
  return m
}

/** One explorer row: small and JSON friendly (no history, no raw data). */
export interface ExplorerRow {
  id: Id
  number: string
  typeId: Id
  title: string
  /** The type's summary fields (not its title), formatted; empty ones left out. */
  summary: Record<Id, string>
  status: SimObject['status']
  /** See `explorerState`. */
  state: string
  /** The first branch's step, or the end step it finished at. */
  stepId?: Id
  step?: string
  /** Parallel branches besides the first. */
  more: number
  /** Whoever holds a branch. */
  assignee?: Id
  createdAt: number
  completedAt?: number
  /** Minutes since created, up to now or until finished. */
  age: number
}

export function explorerRow(o: SimObject, design: Design, clock: number, steps = explorerSteps(design.app)): ExplorerRow {
  const { app, users } = design
  const type = app.objectTypes.find((t) => t.id === o.typeId)
  const summary: Record<Id, string> = {}
  for (const f of type?.fields ?? []) {
    if (!f.summary || f.id === type!.titleFieldId) continue
    const v = formatFieldValue(f, o.data[f.id], app.lists, users)
    if (v) summary[f.id] = v
  }
  const stepId = o.tokens[0]?.nodeId ?? o.endNodeId
  const step = steps.get(stepId ?? '')?.data.label
  const assignee = o.tokens.find((t) => t.userId)?.userId
  return {
    id: o.id,
    number: o.number,
    typeId: o.typeId,
    title: objectTitle(type, o.data, app.lists, users),
    summary,
    status: o.status,
    state: explorerState(o),
    ...(stepId ? { stepId } : {}),
    ...(step !== undefined ? { step } : {}),
    more: o.tokens.length > 1 ? o.tokens.length - 1 : 0,
    ...(assignee ? { assignee } : {}),
    createdAt: o.createdAt,
    ...(o.completedAt !== undefined ? { completedAt: o.completedAt } : {}),
    age: (o.completedAt ?? clock) - o.createdAt,
  }
}
