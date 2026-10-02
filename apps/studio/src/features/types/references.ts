import type { ActionDef, App, FieldDef, FieldType, Id, ObjectType } from '@throughline/core/model/types'

function actionUses(a: ActionDef, fieldId: Id): boolean {
  return (a.kind === 'setField' && a.fieldId === fieldId) || (a.kind === 'integration' && a.resultFieldId === fieldId)
}

/** Places in this type's workflows that read or write the field (rules and actions). */
export function workflowReferences(app: App, type: ObjectType, fieldId: Id): string[] {
  const refs: string[] = []
  for (const wf of app.workflows) {
    if (wf.objectTypeId !== type.id) continue
    const label = (id: Id) => wf.nodes.find((n) => n.id === id)?.data.label ?? 'a step'
    for (const e of wf.edges) {
      if (e.data.condition?.rules.some((r) => r.fieldId === fieldId)) refs.push(`the rule on ${label(e.source)} → ${label(e.target)}`)
    }
    for (const n of wf.nodes) {
      if (n.type === 'auto' && n.data.actions.some((a) => actionUses(a, fieldId))) refs.push(`an action in “${n.data.label}”`)
      if (n.type === 'user') {
        for (const o of n.data.outcomes) if (o.actions.some((a) => actionUses(a, fieldId))) refs.push(`the “${o.label}” outcome of “${n.data.label}”`)
      }
    }
  }
  return refs
}

/** Every reference that should block deleting the field. */
export function blockingReferences(app: App, type: ObjectType, fieldId: Id): string[] {
  const children = type.fields.filter((f) => f.parentFieldId === fieldId).map((f) => `the linked field “${f.label}”`)
  return [...children, ...workflowReferences(app, type, fieldId)]
}

export function describeRefs(refs: string[]): string {
  if (refs.length <= 3) return refs.join('; ')
  return `${refs.slice(0, 3).join('; ')} and ${refs.length - 3} more`
}

/** Choice fields that can act as the parent of `field` (same list, one level up). */
export function parentCandidates(fields: FieldDef[], field: FieldDef): FieldDef[] {
  const level = field.level ?? 0
  if (field.type !== 'choice' || level === 0) return []
  return fields.filter((x) => x.id !== field.id && x.type === 'choice' && x.listId === field.listId && (x.level ?? 0) === level - 1)
}

/** Drop parent links that no longer make sense after an edit (different list, wrong level, removed field). */
export function sanitizeParents(t: ObjectType) {
  for (const f of t.fields) {
    if (!f.parentFieldId) continue
    const p = t.fields.find((x) => x.id === f.parentFieldId)
    if (!p || f.type !== 'choice' || p.type !== 'choice' || p.listId !== f.listId || (p.level ?? 0) !== (f.level ?? 0) - 1) delete f.parentFieldId
  }
}

export const FIELD_TYPE_HELP: Record<FieldType, string> = {
  text: 'A single line of text',
  textarea: 'Paragraphs, notes and descriptions',
  number: 'Whole or decimal numbers',
  currency: 'Dollar amounts, ideal for routing rules',
  date: 'A calendar date',
  boolean: 'A Yes / No switch',
  choice: 'Pick from a list, flat or linked',
  user: 'Pick a person from the organization',
  email: 'An email address',
  attachment: 'Upload documents or images',
}

export const FIELD_TYPE_ORDER: FieldType[] = ['text', 'textarea', 'number', 'currency', 'date', 'boolean', 'choice', 'user', 'email', 'attachment']
