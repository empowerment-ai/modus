// Work across workflow versions. Items run the version they started on (see
// model/versions.ts); these operations show who runs what, and move items to
// another version: one item, or everything on an old version. Steps that exist
// in both versions keep their work where it is; work at a step the target
// version removed goes where the administrator maps it, or the item stays on
// its version and the result says why.

import type { Id, WfNode } from '../model/types'
import { itemVersion, publishedVersion, versionOf } from '../model/versions'
import { ADMIN, activeObjects, audit, buildIndex, type Ctx, enterNode, type Index, indexFor, nodeLabel, type SimObject, type SimState, stat, stepOf, type Token } from './engine'
import type { Result } from './ops'

/** Is the item running this workflow now: its process, or a subflow one of its branches is inside? */
export function runsIn(obj: SimObject, workflowId: Id): boolean {
  return obj.workflowId === workflowId || obj.tokens.some((t) => t.workflowId === workflowId || t.calls.some((c) => c.workflowId === workflowId))
}

/**
 * Pin every item in flight to the versions it runs now. Items created before a
 * workflow had versions carry no pin and would follow the next publish; call
 * this before publishing so they stay where they are. Returns how many changed.
 */
export function pinInFlight(sim: SimState, ctx: Ctx): number {
  const idx = buildIndex(ctx)
  let changed = 0
  for (const obj of activeObjects(sim)) {
    let did = false
    const flows = new Set<Id>([obj.workflowId, ...obj.tokens.flatMap((t) => [t.workflowId, ...t.calls.map((c) => c.workflowId)])])
    for (const wfId of flows) {
      const live = publishedVersion(idx.design.get(wfId))
      if (live === undefined || obj.versions?.[wfId] !== undefined) continue
      ;(obj.versions ??= {})[wfId] = live
      did = true
    }
    if (did) changed++
  }
  return changed
}

export interface VersionUsage {
  /** Items in flight on each version, by version number. */
  counts: Record<number, number>
  /** Items in flight in all. */
  total: number
  /** Steps items are at that the working copy doesn't have. */
  missing: MissingStep[]
  /** Items at one of those steps. */
  missingItems: number
}

export interface MissingStep {
  nodeId: Id
  label: string
  type: WfNode['type']
  /** Items there. */
  count: number
  objectIds: Id[]
  /** The versions those items run. */
  versions: number[]
  /** A subflow step the items are inside: they can only move once they come out of the subflow. */
  inside?: boolean
}

/** Who runs which version of a workflow, and who sits at steps its working copy no longer has. */
export function versionUsage(sim: SimState, ctx: Ctx, workflowId: Id): VersionUsage {
  const idx = buildIndex(ctx)
  const wf = idx.design.get(workflowId)
  const counts: Record<number, number> = {}
  let total = 0
  for (const obj of activeObjects(sim)) {
    if (!runsIn(obj, workflowId)) continue
    total++
    const v = itemVersion(wf, obj)
    if (v !== undefined) counts[v] = (counts[v] ?? 0) + 1
  }
  const missing = missingSteps(sim, ctx, workflowId, wf?.nodes ?? [])
  return { counts, total, missing, missingItems: new Set(missing.flatMap((m) => m.objectIds)).size }
}

/**
 * Steps of this workflow that items are at (or inside, for subflow steps) and
 * that `target` doesn't have, e.g. the steps a draft removes. Narrow it to the
 * items on one version, or to some items.
 */
export function missingSteps(sim: SimState, ctx: Ctx, workflowId: Id, target: WfNode[], filter: { version?: number; objectIds?: Id[] } = {}): MissingStep[] {
  const idx = buildIndex(ctx)
  const wf = idx.design.get(workflowId)
  const keep = new Map(target.map((n) => [n.id, n.type]))
  const out = new Map<Id, MissingStep>()
  const note = (obj: SimObject, own: Index, nodeId: Id, inside: boolean) => {
    const node = stepOf(own, nodeId)?.node
    const m = out.get(nodeId) ?? { nodeId, label: node?.data.label ?? 'A removed step', type: node?.type ?? 'user', count: 0, objectIds: [], versions: [], ...(inside ? { inside } : {}) }
    if (!m.objectIds.includes(obj.id)) {
      m.objectIds.push(obj.id)
      m.count++
    }
    const v = itemVersion(wf, obj)
    if (v !== undefined && !m.versions.includes(v)) m.versions.push(v)
    out.set(nodeId, m)
  }
  for (const obj of activeObjects(sim)) {
    if (filter.objectIds && !filter.objectIds.includes(obj.id)) continue
    if (filter.version !== undefined && itemVersion(wf, obj) !== filter.version) continue
    const own = indexFor(idx, obj)
    for (const t of obj.tokens) {
      if (t.workflowId === workflowId && keep.get(t.nodeId) !== own.node.get(t.nodeId)?.node.type) note(obj, own, t.nodeId, false)
      for (const c of t.calls) if (c.workflowId === workflowId && keep.get(c.nodeId) !== 'subflow') note(obj, own, c.nodeId, true)
    }
  }
  return [...out.values()]
}

export interface Migration {
  moved: number
  skipped: Array<{ objectId: Id; number: string; reason: string }>
}

/**
 * Move items to another version of a workflow: every item on another version,
 * or just `objectIds`. Work at a step the target version also has stays put;
 * work at a step it doesn't have moves to `stepMap[step]` (handed out again,
 * like an administrator's move), or the item is skipped with the reason.
 */
export function migrateItems(
  sim: SimState,
  ctx: Ctx,
  workflowId: Id,
  toVersion: number,
  opts: { objectIds?: Id[]; stepMap?: Record<Id, Id>; actor?: string } = {},
): Result<Migration> {
  const base = buildIndex(ctx)
  const wf = base.design.get(workflowId)
  if (!wf) return { ok: false, error: 'That workflow no longer exists.' }
  if (!versionOf(wf, toVersion)) return { ok: false, error: `${wf.name} has no version ${toVersion}.` }
  const actor = opts.actor ?? ADMIN
  const result: Migration = { moved: 0, skipped: [] }
  for (const obj of activeObjects(sim)) {
    if (opts.objectIds && !opts.objectIds.includes(obj.id)) continue
    if (itemVersion(wf, obj) === toVersion) continue
    const pins = { ...obj.versions, [workflowId]: toVersion }
    if (!runsIn(obj, workflowId)) {
      // Done with this subflow for now; if it comes back, it runs the new version.
      if (obj.versions?.[workflowId] !== undefined) obj.versions = pins
      continue
    }
    const own = indexFor(base, obj)
    const next = indexFor(base, { versions: pins })
    const moves: Array<{ tok: Token; to: Id }> = []
    let reason: string | undefined
    for (const t of obj.tokens) {
      for (const c of t.calls) {
        if (c.workflowId === workflowId && next.node.get(c.nodeId)?.node.type !== 'subflow') reason ??= `It is inside “${nodeLabel(own, c.nodeId)}”, which version ${toVersion} doesn’t have; move it once it comes out.`
      }
      if (t.workflowId !== workflowId) continue
      const now = own.node.get(t.nodeId)?.node
      if (next.node.get(t.nodeId)?.node.type === now?.type) continue
      const to = opts.stepMap?.[t.nodeId]
      const target = to ? next.node.get(to) : undefined
      if (target && target.wf.id === workflowId && target.node.type !== 'start') moves.push({ tok: t, to: target.node.id })
      else reason ??= `“${nodeLabel(own, t.nodeId)}” isn’t in version ${toVersion}; choose a step for it.`
    }
    if (reason) {
      result.skipped.push({ objectId: obj.id, number: obj.number, reason })
      continue
    }
    const from = itemVersion(wf, obj)
    obj.versions = pins
    const which = wf.id === obj.workflowId ? '' : ` of ${wf.name}`
    audit(sim, obj, { kind: 'moved', actor, text: `Moved to version ${toVersion}${which} by ${actor}${from !== undefined ? ` (was on version ${from})` : ''}` })
    for (const { tok, to } of moves) {
      const s = stat(sim, tok.nodeId)
      s.exited++
      s.timeInStep += sim.clock - tok.enteredAt
      if (tok.state === 'joining') {
        for (const f of tok.forks) {
          const fork = sim.forks[f.forkId]
          if (fork) fork.arrived = fork.arrived.filter((id) => id !== tok.id)
        }
      }
      audit(sim, obj, { kind: 'moved', nodeId: tok.nodeId, tokenId: tok.id, actor, text: `Moved from ${nodeLabel(own, tok.nodeId)} to ${nodeLabel(next, to)} by ${actor}` })
      if (obj.status === 'active' && obj.tokens.includes(tok)) enterNode(sim, next, obj, tok, to, 0)
    }
    result.moved++
  }
  return { ok: true, value: result }
}
