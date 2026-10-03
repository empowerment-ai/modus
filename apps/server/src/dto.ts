// DTOs: what goes over the wire, for the REST routes and the assistant's tools
// alike. Everything a person receives passes through here, so this is where
// field security is applied to reads: fields hidden from that person (and the
// audit lines that would reveal their values) never leave the server.

import { accessFor, buildIndex, type Ctx, fieldVerdicts, hasRole, type Id, type ObjectType, type SearchHit, searchItems, type SimObject, type SimState, type WorkItem } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'

/** Field ids this person may not see on this item (sensitive fields, workflow locks). */
function hiddenFields(obj: SimObject, type: ObjectType, ctx: Ctx, userId: Id | undefined, sim?: SimState): Set<Id> {
  if (!userId) return new Set()
  const held = sim ? obj.tokens.find((t) => t.userId === userId) : undefined
  const verdicts =
    (held && sim && accessFor(sim, ctx, held.id, userId)) ||
    fieldVerdicts({ type, wf: ctx.app.workflows.find((w) => w.id === obj.workflowId), passed: obj.passed, userId, groups: ctx.groups, admin: hasRole(buildIndex(ctx), userId, 'admin') })
  return new Set(
    Object.entries(verdicts)
      .filter(([, v]) => v.access === 'hidden')
      .map(([id]) => id),
  )
}

function typeOf(obj: SimObject, ctx: Ctx): ObjectType | undefined {
  return ctx.app.objectTypes.find((t) => t.id === obj.typeId)
}

/** The item's title, unless the title field is hidden from this person. */
function titleFor(obj: SimObject, ctx: Ctx, userId: Id | undefined): string {
  const type = typeOf(obj, ctx)
  if (!type) return ''
  const titleField = type.fields.find((f) => f.id === type.titleFieldId) ?? type.fields.find((f) => f.summary)
  if (titleField && hiddenFields(obj, type, ctx, userId).has(titleField.id)) return ''
  return objectTitle(type, obj.data, ctx.app.lists, ctx.users)
}

/**
 * May this person find the item at all (type permissions, involvement, supervision, roles)?
 * Core decides; we ask it through search instead of copying the rule.
 */
export function canRead(sim: SimState, ctx: Ctx, obj: SimObject, userId: Id): boolean {
  return searchItems(sim, ctx, `number:${obj.number}`, { userId, limit: Number.MAX_SAFE_INTEGER }).hits.some((h) => h.obj.id === obj.id)
}

/** An item by id or number (case-insensitive). */
export function findItem(sim: SimState, ref: string): SimObject | undefined {
  const lower = ref.toLowerCase()
  return sim.objects[ref] ?? Object.values(sim.objects).find((o) => o.number.toLowerCase() === lower)
}

export function workItemDto(i: WorkItem, ctx: Ctx, viewer?: Id) {
  return {
    id: i.token.id,
    itemId: i.obj.id,
    number: i.obj.number,
    title: titleFor(i.obj, ctx, viewer),
    step: { id: i.node.id, label: i.node.data.label, instructions: i.node.type === 'user' ? i.node.data.description : undefined },
    workflow: i.wf.name,
    path: i.path,
    state: i.token.state,
    assignee: i.token.userId,
    priority: i.priority,
    expedited: i.expedited,
    escalated: !!i.token.escalated,
    due: i.due,
    overdue: i.overdue,
    ageMinutes: Math.round(i.age),
    outcomes: i.step.outcomes.map((o) => ({ id: o.id, label: o.label, requireComment: !!o.requireComment })),
  }
}

/** An item as a given person may see it: hidden fields are left out, the rest marked editable or not. */
export function itemDto(obj: SimObject, ctx: Ctx, userId: Id, sim: SimState, opts: { historyLimit?: number } = {}) {
  const type = typeOf(obj, ctx)!
  const held = obj.tokens.find((t) => t.userId === userId)
  const verdicts =
    (held && accessFor(sim, ctx, held.id, userId)) ||
    fieldVerdicts({ type, wf: ctx.app.workflows.find((w) => w.id === obj.workflowId), passed: obj.passed, userId, groups: ctx.groups, admin: hasRole(buildIndex(ctx), userId, 'admin') })
  const data: Record<string, unknown> = {}
  const access: Record<string, string> = {}
  const hiddenLabels: string[] = []
  for (const f of type.fields) {
    const v = verdicts[f.id]
    if (v?.access === 'hidden') {
      hiddenLabels.push(`${f.label} `)
      continue
    }
    data[f.id] = obj.data[f.id]
    access[f.id] = v?.access ?? 'read'
  }
  // Field audit lines read "<Label> changed to <value> …": drop the ones about hidden fields.
  const history = obj.history.filter((h) => h.kind !== 'field' || !hiddenLabels.some((l) => h.text.startsWith(l)))
  return {
    id: obj.id,
    number: obj.number,
    type: type.name,
    title: objectTitle(type, data, ctx.app.lists, ctx.users),
    status: obj.status,
    priority: obj.priority,
    expedited: obj.expedite ? { by: obj.expedite.by, at: obj.expedite.at, reason: obj.expedite.reason } : undefined,
    dueBy: obj.dueBy,
    createdAt: obj.createdAt,
    createdBy: obj.createdBy,
    branches: obj.tokens.map((t) => ({ workItemId: t.id, stepId: t.nodeId, state: t.state, assignee: t.userId })),
    fields: type.fields.filter((f) => f.id in data).map((f) => ({ id: f.id, label: f.label, type: f.type, access: access[f.id] })),
    data,
    history: opts.historyLimit ? history.slice(-opts.historyLimit) : history,
  }
}

/** A search hit. Snippets come from core, which only matches fields the person may see. */
export function hitDto(h: SearchHit, sim: SimState, ctx: Ctx, userId: Id) {
  const o = h.obj
  return {
    id: o.id,
    number: o.number,
    title: titleFor(o, ctx, userId),
    type: typeOf(o, ctx)?.name,
    where: h.where,
    status: o.status,
    priority: o.priority,
    expedited: !!o.expedite,
    due: o.dueBy,
    overdue: o.status === 'active' && o.dueBy !== undefined && sim.clock > o.dueBy,
    matches: h.matches,
  }
}

export type HitDto = ReturnType<typeof hitDto>
