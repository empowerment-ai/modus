// Templates and subflows: save any workflow as a reusable template, stamp a
// template into an application (mapping its fields onto the target object type),
// and blow a single step out into its own subflow.

import { type Condition, type FieldDef, type Group, type Id, type ListDef, type NodeOf, type Template, type User, type WfEdge, type WfNode, type Workflow, AUTO_FAILURE, AUTO_SUCCESS, type App } from './types'
import { uid } from './util'

// ---------- Which fields does a workflow use? ----------

/** Field ids a workflow's rules, actions, outputs, locks and editable step fields refer to. */
export function fieldsUsedBy(wf: Pick<Workflow, 'nodes' | 'edges'> & { fieldLocks?: Workflow['fieldLocks'] }): Set<Id> {
  const used = new Set<Id>()
  const cond = (c?: Condition) => c?.rules.forEach((r) => used.add(r.fieldId))
  for (const e of wf.edges) cond(e.data.condition)
  for (const n of wf.nodes) {
    if (n.type === 'user') {
      for (const [fid, a] of Object.entries(n.data.fieldAccess)) if (a === 'edit') used.add(fid)
      if (n.data.assigneeFieldId) used.add(n.data.assigneeFieldId)
      for (const o of n.data.outcomes) for (const a of o.actions) actionFields(a, used)
    }
    if (n.type === 'auto') {
      for (const a of n.data.actions) actionFields(a, used)
      for (const o of n.data.outputs ?? []) used.add(o.fieldId)
    }
  }
  for (const l of wf.fieldLocks ?? []) used.add(l.fieldId)
  return used
}

function actionFields(a: NodeOf<'auto'>['data']['actions'][number], used: Set<Id>) {
  if (a.kind === 'setField') used.add(a.fieldId)
  if (a.kind === 'integration' && a.resultFieldId) used.add(a.resultFieldId)
}

// ---------- Save as template ----------

export function templateFromWorkflow(app: App, wf: Workflow, meta: { name: string; description: string; category: string; createdBy?: string; tags?: string[] }): Template {
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const used = fieldsUsedBy(wf)
  // Linked-list fields need their parent fields too.
  let grew = true
  while (grew) {
    grew = false
    for (const f of type?.fields ?? []) {
      if (used.has(f.id) && f.parentFieldId && !used.has(f.parentFieldId)) {
        used.add(f.parentFieldId)
        grew = true
      }
    }
  }
  const fields = (type?.fields ?? []).filter((f) => used.has(f.id)).map((f) => structuredClone(f))
  const listIds = new Set(fields.map((f) => f.listId).filter(Boolean) as Id[])
  const lists = app.lists.filter((l) => listIds.has(l.id)).map((l) => structuredClone(l))
  const nodes = structuredClone(wf.nodes).map((n) => {
    // Nested subflows don't travel with a template; the step keeps its name and asks to be pointed at one.
    if (n.type === 'subflow') n.data.workflowId = undefined
    if (n.type === 'user') n.data.fieldAccess = Object.fromEntries(Object.entries(n.data.fieldAccess).filter(([fid]) => used.has(fid)))
    return n
  })
  return {
    id: uid('tpl'),
    name: meta.name,
    description: meta.description,
    category: meta.category,
    tags: meta.tags,
    fields,
    lists,
    nodes,
    edges: structuredClone(wf.edges),
    createdBy: meta.createdBy,
    createdAt: new Date().toISOString(),
  }
}

// ---------- Use a template ----------

export type FieldBinding = Record<Id, Id | 'new'>

const COMPATIBLE: Record<string, string[]> = {
  text: ['text', 'textarea', 'email'],
  textarea: ['textarea', 'text'],
  email: ['email', 'text'],
  number: ['number', 'currency'],
  currency: ['currency', 'number'],
}

export function compatible(a: FieldDef, b: FieldDef): boolean {
  if (a.type === b.type) return a.type !== 'choice' || a.level === b.level
  return (COMPATIBLE[a.type] ?? []).includes(b.type)
}

/** Map each template field to an existing field with the same name and a compatible type, else "new". */
export function suggestBinding(template: Template, targetFields: FieldDef[]): FieldBinding {
  const binding: FieldBinding = {}
  for (const f of template.fields) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const match = targetFields.find((t) => norm(t.label) === norm(f.label) && compatible(f, t))
    binding[f.id] = match?.id ?? 'new'
  }
  return binding
}

export interface Instantiated {
  workflow: Workflow
  /** Fields to add to the object type ("new" in the binding). */
  newFields: FieldDef[]
  /** Lists to add to the application. */
  newLists: ListDef[]
}

/**
 * Stamp a template into an application as a new subflow for `objectTypeId`.
 * Every id is fresh, so the same template can be used many times.
 */
export function instantiateTemplate(
  app: App,
  template: Template,
  opts: { objectTypeId: Id; name?: string; binding: FieldBinding; groups: Group[]; users: User[]; kind?: Workflow['kind'] },
): Instantiated {
  const type = app.objectTypes.find((t) => t.id === opts.objectTypeId)
  const fieldMap = new Map<Id, Id>()
  const newFields: FieldDef[] = []
  const newLists: ListDef[] = []
  const listMap = new Map<Id, Id>()

  for (const l of template.lists ?? []) {
    const existing = app.lists.find((x) => x.id === l.id) ?? app.lists.find((x) => x.name === l.name)
    if (existing) listMap.set(l.id, existing.id)
    else {
      const copy = structuredClone(l)
      copy.id = uid('l')
      const itemMap = new Map<Id, Id>()
      for (const it of copy.items) itemMap.set(it.id, uid('li'))
      copy.items = copy.items.map((it) => ({ ...it, id: itemMap.get(it.id)!, parentId: it.parentId ? (itemMap.get(it.parentId) ?? null) : null }))
      listMap.set(l.id, copy.id)
      newLists.push(copy)
    }
  }

  for (const f of template.fields) {
    const target = opts.binding[f.id]
    if (target && target !== 'new' && type?.fields.some((x) => x.id === target)) fieldMap.set(f.id, target)
    else fieldMap.set(f.id, uid('f'))
  }
  for (const f of template.fields) {
    if (opts.binding[f.id] && opts.binding[f.id] !== 'new' && type?.fields.some((x) => x.id === opts.binding[f.id])) continue
    newFields.push({
      ...structuredClone(f),
      id: fieldMap.get(f.id)!,
      listId: f.listId ? (listMap.get(f.listId) ?? f.listId) : undefined,
      parentFieldId: f.parentFieldId ? fieldMap.get(f.parentFieldId) : undefined,
      restrictedTo: f.restrictedTo?.filter((g) => opts.groups.some((x) => x.id === g)),
    })
  }
  const fid = (id: Id) => fieldMap.get(id) ?? id
  const group = (id?: Id) => (id && opts.groups.some((g) => g.id === id) ? id : undefined)
  const user = (id?: Id) => (id && opts.users.some((u) => u.id === id) ? id : undefined)

  const nodeMap = new Map<Id, Id>()
  const outcomeMap = new Map<Id, Id>()
  const nodes: WfNode[] = structuredClone(template.nodes).map((n) => {
    const id = uid('n')
    nodeMap.set(n.id, id)
    n.id = id
    if (n.type === 'user') {
      const d = n.data
      d.groupId = group(d.groupId)
      d.distributorGroupId = group(d.distributorGroupId)
      d.supervisorId = user(d.supervisorId)
      d.userId = user(d.userId)
      d.assigneeFieldId = d.assigneeFieldId && fid(d.assigneeFieldId)
      d.fieldAccess = Object.fromEntries(Object.entries(d.fieldAccess).map(([k, v]) => [fid(k), v]))
      d.outcomes = d.outcomes.map((o) => {
        const nid = uid('o')
        outcomeMap.set(o.id, nid)
        return { ...o, id: nid, actions: o.actions.map((a) => remapAction(a, fid)) }
      })
    }
    if (n.type === 'auto') {
      n.data.fallbackGroupId = group(n.data.fallbackGroupId)
      n.data.actions = n.data.actions.map((a) => remapAction(a, fid))
      n.data.outputs = n.data.outputs?.map((o) => ({ ...o, fieldId: fid(o.fieldId) }))
    }
    return n
  })
  const edges: WfEdge[] = structuredClone(template.edges)
    .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map((e) => ({
      ...e,
      id: uid('e'),
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      data: {
        ...e.data,
        outcomeId: e.data.outcomeId ? (outcomeMap.get(e.data.outcomeId) ?? e.data.outcomeId) : undefined,
        condition: e.data.condition ? { ...e.data.condition, rules: e.data.condition.rules.map((r) => ({ ...r, id: uid('r'), fieldId: fid(r.fieldId) })) } : undefined,
      },
    }))
  const workflow: Workflow = {
    id: uid('w'),
    name: opts.name ?? template.name,
    description: template.description,
    kind: opts.kind ?? 'subflow',
    objectTypeId: opts.objectTypeId,
    nodes,
    edges,
    arrivalsPerHour: opts.kind === 'process' ? 4 : 0,
    templateId: template.id,
  }
  return { workflow, newFields, newLists }
}

function remapAction<A extends NodeOf<'auto'>['data']['actions'][number]>(a: A, fid: (id: Id) => Id): A {
  const copy = { ...a, id: uid('a') }
  if (copy.kind === 'setField') copy.fieldId = fid(copy.fieldId)
  if (copy.kind === 'integration' && copy.resultFieldId) copy.resultFieldId = fid(copy.resultFieldId)
  return copy
}

// ---------- Subflow outcomes ----------

export interface SubflowOutcome {
  /** What paths leaving the subflow step use as `outcomeId`. */
  key: string
  result: 'completed' | 'rejected' | 'cancelled'
}

/** The ways a subflow can finish: one per distinct end step (its outcome name, else its result). */
export function subflowOutcomes(child: Workflow | undefined): SubflowOutcome[] {
  const seen = new Map<string, SubflowOutcome>()
  for (const n of child?.nodes ?? []) {
    if (n.type !== 'end') continue
    const key = n.data.outcome?.trim() || n.data.result
    if (!seen.has(key)) seen.set(key, { key, result: n.data.result })
  }
  return [...seen.values()]
}

// ---------- Blow a step out into a subflow ----------

const UNHAPPY = /reject|deny|decline|cancel|fail|could not/i

/**
 * Replace a step with a subflow step that runs a new subflow containing the
 * original step, so it can grow into its own process. Paths leaving the step
 * keep working: each outcome becomes a named ending of the subflow.
 */
export function expandToSubflow(app: App, wf: Workflow, nodeId: Id, name?: string): { parent: Workflow; child: Workflow } | undefined {
  const node = wf.nodes.find((n) => n.id === nodeId)
  if (!node || (node.type !== 'user' && node.type !== 'auto')) return undefined
  const childStart = uid('n')
  const inner = structuredClone(node)
  inner.id = uid('n')
  inner.position = { x: 260, y: 160 }
  const ends: WfNode[] = []
  const edges: WfEdge[] = [{ id: uid('e'), source: childStart, target: inner.id, sourceHandle: 'r', targetHandle: 'l', data: {} }]
  const keyFor = new Map<Id, string>()
  const outcomes = node.type === 'user' ? node.data.outcomes.map((o) => ({ id: o.id, label: o.label })) : [
    { id: AUTO_SUCCESS, label: 'Succeeded' },
    { id: AUTO_FAILURE, label: 'Failed' },
  ]
  outcomes.forEach((o, i) => {
    const endId = uid('n')
    const result = UNHAPPY.test(o.label) ? 'rejected' : 'completed'
    ends.push({ id: endId, type: 'end', position: { x: 640, y: 60 + i * 140 }, data: { label: o.label, result, outcome: o.label, terminate: true } })
    edges.push({ id: uid('e'), source: inner.id, target: endId, sourceHandle: 'r', targetHandle: 'l', data: { outcomeId: inner.type === 'user' ? o.id : o.id } })
    keyFor.set(o.id, o.label)
  })
  const child: Workflow = {
    id: uid('w'),
    name: name ?? `${node.data.label} (subflow)`,
    description: `Expanded from the “${node.data.label}” step of ${wf.name}.`,
    kind: 'subflow',
    objectTypeId: wf.objectTypeId,
    nodes: [{ id: childStart, type: 'start', position: { x: 0, y: 186 }, data: { label: 'Begin' } }, inner, ...ends],
    edges,
    arrivalsPerHour: 0,
  }
  const parent = structuredClone(wf)
  const at = parent.nodes.findIndex((n) => n.id === nodeId)
  parent.nodes[at] = { id: nodeId, type: 'subflow', position: node.position, data: { label: node.data.label, description: node.data.description, workflowId: child.id } }
  for (const e of parent.edges) {
    if (e.source !== nodeId) continue
    if (e.data.outcomeId) e.data.outcomeId = keyFor.get(e.data.outcomeId) ?? e.data.outcomeId
    else if (node.type === 'auto') e.data.outcomeId = 'Succeeded'
  }
  void app
  return { parent, child }
}
