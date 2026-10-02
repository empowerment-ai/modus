import type { ListDef, ListItem, Outcome, TypePermission } from './types'

// Small builders shared by the sample applications and templates.

export const P = (create: boolean, read: boolean, update: boolean, del: boolean): TypePermission => ({ create, read, update, delete: del })

export function flatList(id: string, name: string, level: string, labels: string[]): ListDef {
  return { id, name, levels: [level], items: labels.map((label, i) => ({ id: `${id}_${i}`, label, parentId: null })) }
}

export interface Tree {
  [label: string]: Tree | string[]
}

/** Build a linked (cascading) list from a nested object: { "2025": { "Ford": ["F-150", ...] } }. */
export function treeList(id: string, name: string, levels: string[], tree: Tree): ListDef {
  const items: ListItem[] = []
  let n = 0
  const walk = (node: Tree | string[], parentId: string | null) => {
    if (Array.isArray(node)) {
      for (const label of node) items.push({ id: `${id}_${n++}`, label, parentId })
      return
    }
    for (const [label, child] of Object.entries(node)) {
      const itemId = `${id}_${n++}`
      items.push({ id: itemId, label, parentId })
      walk(child, itemId)
    }
  }
  walk(tree, null)
  return { id, name, levels, items }
}

export function outcome(id: string, label: string, weight: number, extra: Partial<Outcome> = {}): Outcome {
  return { id, label, weight, actions: [], ...extra }
}
