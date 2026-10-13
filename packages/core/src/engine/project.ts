// Projections: the rows SQL storage keeps beside each application's state, so
// worklists and search (M3) can query items and open work without loading the
// whole state. Pure: the same function feeds the memory and Postgres adapters.

import { objectTitle } from '../model/format'
import type { Id, Priority } from '../model/types'
import { buildIndex } from './engine'
import type { Ctx, SimState, TokenState } from './state'
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

export function projectItem(sim: SimState, ctx: Ctx, itemId: Id): ProjectedItem | undefined {
  const obj = sim.objects[itemId]
  if (!obj) return undefined
  const idx = buildIndex(ctx)
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
