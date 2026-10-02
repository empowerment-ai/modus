// Workflow-designer helpers: new node defaults, connection rules, and validation.

import type { App, Group, Id, User, WfEdge, WfNode, WfNodeType, Workflow, XY } from '@throughline/core/model/types'
import { uid } from '@throughline/core/model/util'

export function newNode(type: WfNodeType, position: XY, groups: Group[]): WfNode {
  const id = uid('n')
  switch (type) {
    case 'start':
      return { id, type, position, data: { label: 'Created' } }
    case 'end':
      return { id, type, position, data: { label: 'Done', result: 'completed' } }
    case 'decision':
      return { id, type, position, data: { label: 'New decision' } }
    case 'split':
      return { id, type, position, data: { label: 'Parallel split', mode: 'all' } }
    case 'join':
      return { id, type, position, data: { label: 'Join', mode: 'all' } }
    case 'subflow':
      return { id, type, position, data: { label: 'New subflow step' } }
    case 'wait':
      return { id, type, position, data: { label: 'Wait', minutes: 60 } }
    case 'auto':
      return { id, type, position, data: { label: 'New automated step', avgMinutes: 2, actions: [] } }
    case 'user':
      return {
        id,
        type,
        position,
        data: {
          label: 'New user step',
          distribution: 'load-balance',
          groupId: groups[0]?.id,
          autoDistribute: true,
          distributeEveryMinutes: 30,
          avgMinutes: 15,
          slaHours: 24,
          outcomes: [
            { id: uid('o'), label: 'Approve', weight: 90, actions: [] },
            { id: uid('o'), label: 'Reject', weight: 10, requireComment: true, actions: [] },
          ],
          fieldAccess: {},
        },
      }
  }
}

/** Sensible defaults for a freshly drawn connection, based on what it leaves. */
export function newEdge(wf: Workflow, app: App, source: Id, target: Id, sourceHandle?: string | null, targetHandle?: string | null): WfEdge {
  const src = wf.nodes.find((n) => n.id === source)
  const siblings = wf.edges.filter((e) => e.source === source)
  const edge: WfEdge = { id: uid('e'), source, target, sourceHandle, targetHandle, data: {} }
  if (src?.type === 'user') {
    const used = new Set(siblings.map((e) => e.data.outcomeId))
    edge.data.outcomeId = src.data.outcomes.find((o) => !used.has(o.id))?.id ?? src.data.outcomes[0]?.id
  } else if (src?.type === 'decision') {
    const hasDefault = siblings.some((e) => e.data.isDefault)
    if (siblings.length > 0 && !hasDefault) {
      edge.data.isDefault = true
      edge.data.order = 99
    } else {
      const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
      const field = type?.fields.find((f) => f.type === 'currency' || f.type === 'number') ?? type?.fields[0]
      edge.data.order = siblings.filter((e) => !e.data.isDefault).length
      edge.data.condition = {
        match: 'all',
        rules: field ? [{ id: uid('r'), fieldId: field.id, op: field.type === 'currency' || field.type === 'number' ? 'gt' : 'eq', value: field.type === 'currency' ? 1000 : '' }] : [],
      }
    }
  }
  return edge
}

export function canConnect(wf: Workflow, source: Id | null, target: Id | null): boolean {
  if (!source || !target || source === target) return false
  const s = wf.nodes.find((n) => n.id === source)
  const t = wf.nodes.find((n) => n.id === target)
  if (!s || !t) return false
  if (s.type === 'end' || t.type === 'start') return false
  return true
}

export interface Issue {
  level: 'error' | 'warn'
  text: string
  nodeId?: Id
  edgeId?: Id
}

export function validate(wf: Workflow, app: App, groups: Group[], users: User[]): Issue[] {
  const issues: Issue[] = []
  const starts = wf.nodes.filter((n) => n.type === 'start')
  if (starts.length === 0) issues.push({ level: 'error', text: 'Add a Start step so new objects know where to begin.' })
  if (starts.length > 1) issues.push({ level: 'error', text: 'Only one Start step is allowed.', nodeId: starts[1]!.id })
  if (!wf.nodes.some((n) => n.type === 'end')) issues.push({ level: 'error', text: 'Add at least one End step.' })
  if (!app.objectTypes.some((t) => t.id === wf.objectTypeId)) issues.push({ level: 'error', text: 'Pick the object type this workflow processes.' })

  // Reachability from start.
  const reach = new Set<Id>()
  const queue = starts.map((s) => s.id)
  while (queue.length) {
    const id = queue.shift()!
    if (reach.has(id)) continue
    reach.add(id)
    for (const e of wf.edges) if (e.source === id) queue.push(e.target)
  }

  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  for (const n of wf.nodes) {
    const out = wf.edges.filter((e) => e.source === n.id)
    const label = n.data.label
    if (starts.length && !reach.has(n.id)) issues.push({ level: 'warn', text: `“${label}” can’t be reached from the start.`, nodeId: n.id })
    if (n.type !== 'end' && out.length === 0) issues.push({ level: 'error', text: `“${label}” has no path out — work would get stuck there.`, nodeId: n.id })
    if (n.type === 'decision') {
      if (out.length && !out.some((e) => e.data.isDefault || !e.data.condition?.rules.length))
        issues.push({ level: 'warn', text: `“${label}” has no “Otherwise” path; anything that matches no rule will stop there.`, nodeId: n.id })
      for (const e of out) {
        for (const r of e.data.condition?.rules ?? []) {
          if (!type?.fields.some((f) => f.id === r.fieldId)) issues.push({ level: 'error', text: `A rule in “${label}” uses a field that no longer exists.`, edgeId: e.id })
        }
      }
    }
    if (n.type === 'user') {
      const d = n.data
      if (d.distribution === 'direct' && !users.some((u) => u.id === d.userId)) issues.push({ level: 'error', text: `“${label}” needs a person to assign to.`, nodeId: n.id })
      if (d.distribution !== 'direct') {
        const g = groups.find((x) => x.id === d.groupId)
        if (!g) issues.push({ level: 'error', text: `“${label}” needs a group.`, nodeId: n.id })
        else if (!g.memberIds.some((id) => users.find((u) => u.id === id)?.available))
          issues.push({ level: 'warn', text: `No one in ${g.name} is available for “${label}”.`, nodeId: n.id })
        if (d.distribution === 'manager' && !(d.supervisorId ?? g?.supervisorId)) issues.push({ level: 'warn', text: `“${label}” uses supervisor distribution but has no supervisor.`, nodeId: n.id })
      }
      if (out.length > 1) {
        for (const o of d.outcomes) {
          if (!out.some((e) => e.data.outcomeId === o.id)) issues.push({ level: 'warn', text: `Outcome “${o.label}” of “${label}” isn’t connected to a path.`, nodeId: n.id })
        }
        for (const e of out) if (!d.outcomes.some((o) => o.id === e.data.outcomeId)) issues.push({ level: 'error', text: `A path out of “${label}” has no outcome.`, edgeId: e.id })
      }
      if (d.outcomes.length === 0) issues.push({ level: 'error', text: `“${label}” needs at least one outcome to release with.`, nodeId: n.id })
    }
  }
  return issues
}
