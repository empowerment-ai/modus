import type { FieldDef, Id, ListDef, ListItem, ObjectType } from './types'

export function itemDepth(list: ListDef, item: ListItem): number {
  let depth = 0
  let cur: ListItem | undefined = item
  const byId = new Map(list.items.map((i) => [i.id, i]))
  while (cur && cur.parentId) {
    depth++
    cur = byId.get(cur.parentId)
  }
  return depth
}

export function childrenOf(list: ListDef, parentId: Id | null): ListItem[] {
  return list.items.filter((i) => i.parentId === parentId)
}

/**
 * Options for a choice field given the current form values. Level 0 fields show
 * the top of the list; deeper levels show only the children of whatever the
 * parent field currently holds (the Model Year -> Make -> Model behavior).
 */
export function optionsForField(field: FieldDef, list: ListDef | undefined, values: Record<string, unknown>): ListItem[] {
  if (!list) return []
  const level = field.level ?? 0
  if (level === 0) return childrenOf(list, null)
  if (!field.parentFieldId) return []
  const parentValue = values[field.parentFieldId]
  if (typeof parentValue !== 'string' || !parentValue) return []
  return childrenOf(list, parentValue)
}

export function itemLabel(list: ListDef | undefined, itemId: unknown): string {
  if (!list || typeof itemId !== 'string') return ''
  return list.items.find((i) => i.id === itemId)?.label ?? ''
}

/** Fields that depend (directly or transitively) on the given field. Cleared when it changes. */
export function dependentFields(type: ObjectType, fieldId: Id): FieldDef[] {
  const out: FieldDef[] = []
  const queue = [fieldId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const f of type.fields) {
      if (f.parentFieldId === cur && !out.includes(f)) {
        out.push(f)
        queue.push(f.id)
      }
    }
  }
  return out
}

export function countAtLevel(list: ListDef, level: number): number {
  return list.items.filter((i) => itemDepth(list, i) === level).length
}

/** Remove an item and everything beneath it. */
export function withoutItemTree(list: ListDef, itemId: Id): ListItem[] {
  const doomed = new Set([itemId])
  let grew = true
  while (grew) {
    grew = false
    for (const i of list.items) {
      if (i.parentId && doomed.has(i.parentId) && !doomed.has(i.id)) {
        doomed.add(i.id)
        grew = true
      }
    }
  }
  return list.items.filter((i) => !doomed.has(i.id))
}
