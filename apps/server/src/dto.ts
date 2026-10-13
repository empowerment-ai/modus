// DTOs: what goes over the wire, for the REST routes and the assistant's tools
// alike. Everything a person receives passes through here, so this is where
// field security is applied to reads: fields hidden from that person (and the
// audit lines that would reveal their values) never leave the server.

import { accessFor, canReadItem, type Ctx, type Design, type Id, itemReadVerdicts, type ObjectType, type SearchHit, type ServiceDef, type SimObject, type SimState, visibleHistory, type WorkItem } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'

/** Field ids this person may not see on this item (sensitive fields, workflow locks). */
function hiddenFields(obj: SimObject, ctx: Ctx, userId: Id | undefined, sim?: SimState): Set<Id> {
  if (!userId) return new Set()
  const held = sim ? obj.tokens.find((t) => t.userId === userId) : undefined
  const verdicts = (held && sim && accessFor(sim, ctx, held.id, userId)) || itemReadVerdicts(ctx, obj, userId)
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
  if (titleField && hiddenFields(obj, ctx, userId).has(titleField.id)) return ''
  return objectTitle(type, obj.data, ctx.app.lists, ctx.users)
}

/** May this person see the item at all (type permissions, involvement, supervision, roles)? Core decides. */
export function canRead(_sim: SimState, ctx: Ctx, obj: SimObject, userId: Id): boolean {
  return canReadItem(ctx, obj, userId)
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
  const verdicts = (held && accessFor(sim, ctx, held.id, userId)) || itemReadVerdicts(ctx, obj, userId)
  const data: Record<string, unknown> = {}
  const access: Record<string, string> = {}
  const hidden = new Set<Id>()
  for (const f of type.fields) {
    const v = verdicts[f.id]
    if (v?.access === 'hidden') {
      hidden.add(f.id)
      continue
    }
    data[f.id] = obj.data[f.id]
    access[f.id] = v?.access ?? 'read'
  }
  // Audit lines that show a hidden field's value come back redacted.
  const history = visibleHistory(ctx, obj, userId, hidden)
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

/** A service as people see it: what the diagram and the Monitor's services panel draw. No address, credentials or owner. */
export type ServiceDto = Pick<ServiceDef, 'id' | 'name' | 'kind' | 'description' | 'concurrency' | 'status' | 'operations'>

/** Copy only the listed keys that are present, so a field added to the design later stays on the server until named here. */
function pick<T extends object, K extends keyof T>(from: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const k of keys) if (from[k] !== undefined) out[k] = from[k]
  return out
}

const SERVICE_KEYS = ['id', 'name', 'kind', 'description', 'concurrency', 'status'] as const
const OPERATION_KEYS = ['id', 'name', 'description', 'avgMinutes', 'successRate'] as const
const OUTPUT_KEYS = ['key', 'label', 'type', 'trueRate', 'min', 'max', 'options'] as const

/** The published design, with each service reduced to an allowlist: connection details stay on the server. */
export function designDto(design: Design): Omit<Design, 'services'> & { services: ServiceDto[] } {
  return {
    ...design,
    services: design.services.map((s) => ({
      ...pick(s, SERVICE_KEYS),
      operations: s.operations.map((o) => ({ ...pick(o, OPERATION_KEYS), outputs: o.outputs.map((x) => pick(x, OUTPUT_KEYS)) })),
    })),
  }
}
