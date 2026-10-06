// Field-level security. Three layers decide what a person can do with a field;
// the most restrictive one wins:
//   1. Object type  — sensitive fields visible only to some groups (FieldDef.restrictedTo)
//   2. Workflow     — locks that apply everywhere, or once the item passed a step (Workflow.fieldLocks)
//   3. Step         — edit / read / hidden for the people working that step (UserStepData.fieldAccess)
// The engine enforces the same answer the forms display, so a locked field can't be
// changed through the UI or the API.

import type { FieldAccess, FieldDef, Group, Id, ObjectType, WfNode, Workflow } from './types'

const RANK: Record<FieldAccess, number> = { edit: 0, read: 1, hidden: 2 }

export function stricter(a: FieldAccess, b: FieldAccess): FieldAccess {
  return RANK[a] >= RANK[b] ? a : b
}

export interface AccessInput {
  type: ObjectType
  /** The workflow whose locks apply (where the work item is). */
  wf?: Workflow
  /** The step the person is working. Omit for the create form or a read-only view. */
  node?: WfNode
  /** Steps the item has already left. */
  passed?: Id[]
  /** Who is looking. Omit to ignore group-based rules (designer previews). */
  userId?: Id
  groups: Group[]
  /** Administrators bypass step and workflow rules (still audited). */
  admin?: boolean
  /** Creating a new item: system fields are not shown, everything else is editable. */
  creating?: boolean
}

export interface FieldVerdict {
  access: FieldAccess
  /** Plain-language reason when not editable. */
  reason?: string
}

function memberOf(groups: Group[], userId: Id | undefined, groupIds: Id[] | undefined): boolean {
  if (!userId || !groupIds?.length) return false
  return groups.some((g) => groupIds.includes(g.id) && g.memberIds.includes(userId))
}

/** The access a person has to every field of an item at a given step, with reasons. */
export function fieldVerdicts(input: AccessInput): Record<Id, FieldVerdict> {
  const { type, wf, node, passed = [], userId, groups, admin, creating } = input
  const out: Record<Id, FieldVerdict> = {}
  for (const f of type.fields) {
    let v: FieldVerdict = { access: 'edit' }
    const tighten = (access: FieldAccess, reason: string) => {
      if (RANK[access] > RANK[v.access]) v = { access, reason }
    }

    // 1. Sensitive data.
    if (f.restrictedTo?.length && userId && !admin && !memberOf(groups, userId, f.restrictedTo)) {
      const names = groups.filter((g) => f.restrictedTo!.includes(g.id)).map((g) => g.name)
      tighten('hidden', `Restricted to ${names.join(', ') || 'specific groups'}`)
    }

    if (!admin) {
      // 2. Workflow locks.
      for (const lock of wf?.fieldLocks ?? []) {
        if (lock.fieldId !== f.id) continue
        if (lock.when === 'after' && (!lock.afterNodeId || !passed.includes(lock.afterNodeId))) continue
        if (userId && memberOf(groups, userId, lock.exemptGroupIds)) continue
        const after = lock.when === 'after' ? wf?.nodes.find((n) => n.id === lock.afterNodeId)?.data.label : undefined
        tighten(lock.access, after ? `Locked after “${after}”` : `Locked in ${wf?.name ?? 'this workflow'}`)
      }

      // 3. Step access.
      if (node?.type === 'user') {
        const a = node.data.fieldAccess[f.id] ?? 'edit'
        if (a !== 'edit') tighten(a, a === 'read' ? `Read-only at “${node.data.label}”` : `Hidden at “${node.data.label}”`)
      } else if (!node && !creating) {
        tighten('read', 'Not at a step you are working')
      }
    }

    if (creating && f.system) tighten('hidden', 'Set by the workflow')
    out[f.id] = v
  }
  // Totals are computed; a table that feeds a read-only total can't be edited either,
  // or the total could be changed through its rows.
  for (const f of type.fields) {
    if (!f.total) continue
    const total = out[f.id]
    const table = out[f.total.tableFieldId]
    if (!total || !table) continue
    if (total.access !== 'edit' && RANK[total.access] > RANK[table.access]) {
      out[f.total.tableFieldId] = { access: total.access === 'hidden' ? 'read' : total.access, reason: `Feeds ${f.label}, which is ${total.reason?.toLowerCase() ?? 'locked'}` }
    }
    if (total.access === 'edit') out[f.id] = { access: 'read', reason: `Calculated from ${type.fields.find((x) => x.id === f.total!.tableFieldId)?.label ?? 'a table'}` }
  }
  return out
}

/** Just the access levels, in the shape FormRenderer takes. */
export function fieldAccessMap(input: AccessInput): Record<Id, FieldAccess> {
  const v = fieldVerdicts(input)
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.access]))
}

/** Fields in `patch` the person may not change, with reasons. Empty = allowed. */
export function blockedFields(input: AccessInput, patch: Record<string, unknown>): Array<{ field: FieldDef; reason: string }> {
  return blockedBy(input.type, fieldVerdicts(input), patch)
}

/** Fields in `patch` these verdicts don't let the person change, with reasons. */
export function blockedBy(type: ObjectType, verdicts: Record<Id, FieldVerdict>, patch: Record<string, unknown>): Array<{ field: FieldDef; reason: string }> {
  const blocked: Array<{ field: FieldDef; reason: string }> = []
  for (const key of Object.keys(patch)) {
    const f = type.fields.find((x) => x.id === key)
    if (!f) continue
    const verdict = verdicts[key]
    if (verdict && verdict.access !== 'edit') blocked.push({ field: f, reason: verdict.reason ?? 'Not editable' })
  }
  return blocked
}

/** The strictest verdict for each field across several sets (hidden over read over edit). */
export function strictestVerdicts(...sets: Array<Record<Id, FieldVerdict>>): Record<Id, FieldVerdict> {
  const out: Record<Id, FieldVerdict> = {}
  for (const set of sets) for (const [id, v] of Object.entries(set)) if (!out[id] || RANK[v.access] > RANK[out[id].access]) out[id] = v
  return out
}

/** One row per field, one column per step: the security matrix administrators review. */
export function securityMatrix(type: ObjectType, wf: Workflow, groups: Group[]): Array<{ field: FieldDef; cells: Record<Id, FieldVerdict> }> {
  const steps = wf.nodes.filter((n) => n.type === 'user')
  return type.fields.map((field) => {
    const cells: Record<Id, FieldVerdict> = {}
    for (const node of steps) {
      // Locks that apply "after" a step are shown on steps that can only be reached after it.
      const passed = wf.fieldLocks?.filter((l) => l.when === 'after' && l.afterNodeId && reachable(wf, l.afterNodeId, node.id)).map((l) => l.afterNodeId!) ?? []
      cells[node.id] = fieldVerdicts({ type, wf, node, passed, groups })[field.id]!
    }
    return { field, cells }
  })
}

/** Is `to` reachable from `from` (excluding `from` itself)? */
export function reachable(wf: Workflow, from: Id, to: Id): boolean {
  const seen = new Set<Id>()
  const queue = wf.edges.filter((e) => e.source === from).map((e) => e.target)
  while (queue.length) {
    const id = queue.shift()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of wf.edges) if (e.source === id) queue.push(e.target)
  }
  return false
}
