import { buildIndex, type Ctx, describeToken, findToken, type SimState, type WorkItem, workNext } from '@modus-bpm/core'
import type { Id } from '@modus-bpm/core/model/types'
import { useUi } from '../../store/ui'
import { perform } from './live'
import { useWorkspace } from './store'

/** Where an item is now, to follow "It’s now …": at “Manager approval”: waiting to be handed out by AP Dispatch. */
export function whereNow(sim: SimState, ctx: Ctx, objectId: Id): string {
  const obj = sim.objects[objectId]
  if (!obj) return 'out of the simulation'
  const idx = buildIndex(ctx)
  const label = (id?: Id) => `“${id ? (idx.node.get(id)?.node.data.label ?? 'a removed step') : 'the end'}”`
  if (obj.status !== 'active') return `${obj.status === 'completed' ? 'finished' : obj.status} at ${label(obj.endNodeId)}`
  const [only, ...more] = obj.tokens
  if (!only) return 'between steps'
  if (!more.length) {
    // "In Kevin’s basket" reads "in Kevin’s basket" mid-sentence; names keep their capital.
    const d = describeToken(sim, ctx, only).replace(/^(In|Waiting|Calling|Stuck|On|Routing|Automated)\b/, (w) => w.toLowerCase())
    return `at ${label(only.nodeId)}: ${d}`
  }
  const labels = obj.tokens.map((t) => label(t.nodeId))
  return `at ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}, in parallel`
}

/** "Get next": pull the most urgent item from any of your queues and open it. */
export function getNext(userId: Id) {
  const r = perform((sim, ctx) => {
    const res = workNext(sim, ctx, userId)
    return res.ok ? { ok: true as const, value: { tokenId: res.value, number: findToken(sim, res.value)?.obj.number ?? 'It' } } : res
  })
  if (!r.ok) return
  useWorkspace.getState().openItem(r.value.tokenId)
  useUi.getState().toast(`${r.value.number} is yours now. It’s open and waiting for you.`, 'success')
}

/** Open an item you found (search, Ask Modus, Supervise): in My work if it's in your basket, otherwise read-only. */
export function openFound(objectId: Id, basket: WorkItem[]) {
  const held = basket.find((i) => i.obj.id === objectId)
  const ws = useWorkspace.getState()
  if (held) ws.openItem(held.token.id)
  else ws.view(objectId)
}
