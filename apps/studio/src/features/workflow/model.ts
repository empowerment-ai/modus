// Workflow-designer helpers: new node defaults, connection rules, and validation.

import { subflowOutcomes } from '@throughline/core/model/templates'
import { AUTO_FAILURE, AUTO_SUCCESS } from '@throughline/core/model/types'
import type { App, Group, Id, NodeOf, ObjectType, ServiceDef, User, WfEdge, WfNode, WfNodeType, Workflow, XY } from '@throughline/core/model/types'
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

/** A new, empty subflow: Start → End ("Done"). */
export function blankSubflow(name: string, objectTypeId: Id): Workflow {
  const s = uid('n')
  const e = uid('n')
  return {
    id: uid('w'),
    name,
    kind: 'subflow',
    objectTypeId,
    arrivalsPerHour: 0,
    nodes: [
      { id: s, type: 'start', position: { x: 0, y: 100 }, data: { label: 'Begin' } },
      { id: e, type: 'end', position: { x: 520, y: 100 }, data: { label: 'Done', result: 'completed', outcome: 'Done' } },
    ],
    edges: [{ id: uid('e'), source: s, target: e, sourceHandle: 'r', targetHandle: 'l', data: {} }],
  }
}

/** Does this split choose its paths by rules (rather than running all of them)? */
export function isRuled(node: WfNode | undefined): node is NodeOf<'decision'> | NodeOf<'split'> {
  return node?.type === 'decision' || (node?.type === 'split' && node.data.mode === 'inclusive')
}

/** Sensible defaults for a freshly drawn connection, based on what it leaves. */
export function newEdge(wf: Workflow, app: App, source: Id, target: Id, sourceHandle?: string | null, targetHandle?: string | null): WfEdge {
  const src = wf.nodes.find((n) => n.id === source)
  const siblings = wf.edges.filter((e) => e.source === source)
  const edge: WfEdge = { id: uid('e'), source, target, sourceHandle, targetHandle, data: {} }
  if (src?.type === 'user') {
    const used = new Set(siblings.map((e) => e.data.outcomeId))
    edge.data.outcomeId = src.data.outcomes.find((o) => !used.has(o.id))?.id ?? src.data.outcomes[0]?.id
  } else if (src?.type === 'auto') {
    // The first path is the normal one; the next one catches failures.
    const hasNormal = siblings.some((e) => !e.data.outcomeId || e.data.outcomeId === AUTO_SUCCESS)
    const hasFailed = siblings.some((e) => e.data.outcomeId === AUTO_FAILURE)
    if (hasNormal && !hasFailed) edge.data.outcomeId = AUTO_FAILURE
  } else if (src?.type === 'subflow') {
    const used = new Set(siblings.map((e) => e.data.outcomeId))
    const child = app.workflows.find((w) => w.id === src.data.workflowId)
    edge.data.outcomeId = subflowOutcomes(child).find((o) => !used.has(o.key))?.key
  } else if (isRuled(src)) {
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

// ---------- Subflow relationships ----------

/** Subflow steps (in any workflow of the app) that run this workflow. */
export function subflowCallers(app: App, workflowId: Id): Array<{ wf: Workflow; node: NodeOf<'subflow'> }> {
  const out: Array<{ wf: Workflow; node: NodeOf<'subflow'> }> = []
  for (const wf of app.workflows) for (const n of wf.nodes) if (n.type === 'subflow' && n.data.workflowId === workflowId) out.push({ wf, node: n })
  return out
}

/** Does running `fromId` ever (through nested subflow steps) run `targetId`? */
export function runsWorkflow(app: App, fromId: Id, targetId: Id, seen = new Set<Id>()): boolean {
  if (seen.has(fromId)) return false
  seen.add(fromId)
  const wf = app.workflows.find((w) => w.id === fromId)
  for (const n of wf?.nodes ?? []) {
    if (n.type !== 'subflow' || !n.data.workflowId) continue
    if (n.data.workflowId === targetId || runsWorkflow(app, n.data.workflowId, targetId, seen)) return true
  }
  return false
}

/** Which path a subflow ending takes out of the step running it (mirrors the engine). */
export function pathForEnding(wf: Workflow, nodeId: Id, ending: { key: string; result: string }): WfEdge | undefined {
  const out = wf.edges.filter((e) => e.source === nodeId)
  const generic = out.filter((e) => !e.data.outcomeId)
  return out.find((e) => e.data.outcomeId === ending.key) ?? out.find((e) => e.data.outcomeId === ending.result) ?? (ending.result === 'completed' && generic.length === 1 ? generic[0] : undefined)
}

// ---------- Validation ----------

export interface Issue {
  level: 'error' | 'warn'
  text: string
  nodeId?: Id
  edgeId?: Id
}

export function validate(wf: Workflow, app: App, groups: Group[], users: User[], services: ServiceDef[] = []): Issue[] {
  const issues: Issue[] = []
  const isSubflow = wf.kind === 'subflow'
  const starts = wf.nodes.filter((n) => n.type === 'start')
  if (starts.length === 0) issues.push({ level: 'error', text: isSubflow ? 'Add a Start step so the subflow knows where to begin.' : 'Add a Start step so new objects know where to begin.' })
  if (starts.length > 1) issues.push({ level: 'error', text: 'Only one Start step is allowed.', nodeId: starts[1]!.id })
  if (!wf.nodes.some((n) => n.type === 'end')) issues.push({ level: 'error', text: 'Add at least one End step.' })
  if (!app.objectTypes.some((t) => t.id === wf.objectTypeId)) issues.push({ level: 'error', text: 'Pick the object type this workflow processes.' })
  if (isSubflow && subflowCallers(app, wf.id).length === 0) issues.push({ level: 'warn', text: 'No step runs this subflow yet. Point a Subflow step in another workflow at it.' })

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
  const ctx: CheckCtx = { wf, app, type, groups, users, services, issues }
  for (const n of wf.nodes) {
    const out = wf.edges.filter((e) => e.source === n.id)
    const label = n.data.label
    if (starts.length && !reach.has(n.id)) issues.push({ level: 'warn', text: `“${label}” can’t be reached from the start.`, nodeId: n.id })
    if (n.type !== 'end' && out.length === 0) issues.push({ level: 'error', text: `“${label}” has no path out — work would get stuck there.`, nodeId: n.id })
    if ((n.type === 'start' || n.type === 'join' || n.type === 'wait') && out.length > 1)
      issues.push({ level: 'warn', text: `Only the first path out of “${label}” is used. Add a Decision or a Parallel split to branch.`, nodeId: n.id })
    switch (n.type) {
      case 'decision':
        checkRules(ctx, n, out)
        break
      case 'split':
        if (n.data.mode === 'inclusive') checkRules(ctx, n, out)
        else if (out.length === 1) issues.push({ level: 'warn', text: `“${label}” has only one path. Add another to run them at the same time.`, nodeId: n.id })
        break
      case 'join':
        checkJoin(ctx, n)
        break
      case 'subflow':
        checkSubflow(ctx, n, out)
        break
      case 'auto':
        checkAuto(ctx, n, out)
        break
      case 'user':
        checkUser(ctx, n, out)
        break
    }
  }
  return issues
}

interface CheckCtx {
  wf: Workflow
  app: App
  type?: ObjectType
  groups: Group[]
  users: User[]
  services: ServiceDef[]
  issues: Issue[]
}

/** Decisions and inclusive splits: rules on existing fields, and something for items that match none. */
function checkRules({ type, issues }: CheckCtx, n: NodeOf<'decision'> | NodeOf<'split'>, out: WfEdge[]) {
  const label = n.data.label
  for (const e of out) {
    for (const r of e.data.condition?.rules ?? []) {
      if (!type?.fields.some((f) => f.id === r.fieldId)) issues.push({ level: 'error', text: `A rule in “${label}” uses a field that no longer exists.`, edgeId: e.id })
    }
  }
  const unruled = out.filter((e) => !e.data.isDefault && !e.data.condition?.rules.length)
  const hasDefault = out.some((e) => e.data.isDefault)
  if (n.type === 'decision') {
    if (out.length && !hasDefault && !unruled.length) issues.push({ level: 'warn', text: `“${label}” has no “Otherwise” path; anything that matches no rule will stop there.`, nodeId: n.id })
    return
  }
  // The engine uses the default path, else the first path without a rule, as the fallback; other rule-less paths never run.
  for (const e of unruled.slice(hasDefault ? 0 : 1))
    issues.push({ level: 'warn', text: `A path out of “${label}” has no rule, so it never runs. Give it a rule or make it the “Otherwise” path.`, edgeId: e.id })
  if (out.length && !hasDefault && !unruled.length) issues.push({ level: 'warn', text: `“${label}” has no “Otherwise” path; items that match no rule will stop there.`, nodeId: n.id })
}

function checkJoin({ wf, issues }: CheckCtx, n: NodeOf<'join'>) {
  const label = n.data.label
  const incoming = wf.edges.filter((e) => e.target === n.id).length
  if (incoming < 2) issues.push({ level: 'warn', text: `“${label}” has ${incoming === 1 ? 'only one path' : 'no paths'} coming in; a join brings parallel branches back together.`, nodeId: n.id })
  if (n.data.mode === 'count') {
    if (!n.data.count || n.data.count < 1) issues.push({ level: 'error', text: `Set how many branches “${label}” waits for.`, nodeId: n.id })
    else if (incoming >= 2 && n.data.count > incoming) issues.push({ level: 'warn', text: `“${label}” waits for ${n.data.count} branches but only ${incoming} lead into it.`, nodeId: n.id })
  }
}

function checkSubflow({ wf, app, issues }: CheckCtx, n: NodeOf<'subflow'>, out: WfEdge[]) {
  const label = n.data.label
  const child = app.workflows.find((w) => w.id === n.data.workflowId)
  if (!child) {
    issues.push({ level: 'error', text: n.data.workflowId ? `“${label}” runs a subflow that no longer exists.` : `Choose the subflow “${label}” runs.`, nodeId: n.id })
    return
  }
  if (child.objectTypeId !== wf.objectTypeId) issues.push({ level: 'error', text: `“${label}” runs “${child.name}”, which handles a different kind of item.`, nodeId: n.id })
  if (!child.nodes.some((x) => x.type === 'start')) issues.push({ level: 'error', text: `Subflow “${child.name}” has no Start step.`, nodeId: n.id })
  if (!child.nodes.some((x) => x.type === 'end')) issues.push({ level: 'error', text: `Subflow “${child.name}” has no End step, so “${label}” would never finish.`, nodeId: n.id })
  if (child.id === wf.id || runsWorkflow(app, child.id, wf.id))
    issues.push({ level: 'error', text: `“${label}” runs “${child.name}”, which leads back into this workflow and would never finish.`, nodeId: n.id })
  const endings = subflowOutcomes(child)
  // Rejected or cancelled endings without a path end this item the same way, which is fine.
  for (const o of endings) {
    if (o.result === 'completed' && !pathForEnding(wf, n.id, o))
      issues.push({ level: 'warn', text: `The “${o.key}” ending of “${label}” has no path; items finishing that way would stop.`, nodeId: n.id })
  }
  for (const e of out) {
    const k = e.data.outcomeId
    if (k && !endings.some((o) => o.key === k || o.result === k))
      issues.push({ level: 'warn', text: `A path out of “${label}” waits for a “${k}” ending that “${child.name}” doesn’t have.`, edgeId: e.id })
  }
  if (out.filter((e) => !e.data.outcomeId).length > 1) issues.push({ level: 'warn', text: `“${label}” has several paths without an ending; pick one for each.`, nodeId: n.id })
}

function checkAuto({ type, groups, services, issues }: CheckCtx, n: NodeOf<'auto'>, out: WfEdge[]) {
  const d = n.data
  const label = d.label
  const svc = d.serviceId ? services.find((s) => s.id === d.serviceId) : undefined
  const op = svc?.operations.find((o) => o.id === d.operationId)
  if (d.serviceId && !svc) issues.push({ level: 'error', text: `“${label}” calls a service that is no longer registered.`, nodeId: n.id })
  if (svc && !op) issues.push({ level: 'warn', text: `Pick which ${svc.name} operation “${label}” calls.`, nodeId: n.id })
  if (svc?.status === 'offline') issues.push({ level: 'warn', text: `${svc.name} is offline; work at “${label}” waits until it is back.`, nodeId: n.id })
  for (const o of d.outputs ?? []) {
    if (!type?.fields.some((f) => f.id === o.fieldId)) issues.push({ level: 'error', text: `“${label}” stores a result in a field that no longer exists.`, nodeId: n.id })
    else if (op && !op.outputs.some((x) => x.key === o.key)) issues.push({ level: 'warn', text: `“${label}” stores “${o.key}”, which ${op.name} doesn’t return.`, nodeId: n.id })
  }
  const policy = d.onFailure ?? 'route'
  const fallback = groups.find((g) => g.id === d.fallbackGroupId)
  const failedPath = out.some((e) => e.data.outcomeId === AUTO_FAILURE)
  if (svc && policy === 'manual' && !fallback) issues.push({ level: 'warn', text: `“${label}” hands failures to a person but has no fallback group.`, nodeId: n.id })
  if (svc && policy === 'route' && !failedPath)
    issues.push({ level: 'warn', text: `“${label}” has no “Failed” path; failed calls ${fallback ? `go to ${fallback.name}` : 'will get stuck'}.`, nodeId: n.id })
  const generic = out.filter((e) => !e.data.outcomeId)
  if (!out.some((e) => e.data.outcomeId === AUTO_SUCCESS) && generic.length > 1)
    issues.push({ level: 'error', text: `“${label}” has more than one plain path; mark one of them “Failed”.`, nodeId: n.id })
  if (out.length && !generic.length && !out.some((e) => e.data.outcomeId === AUTO_SUCCESS)) issues.push({ level: 'error', text: `“${label}” has no path for when it succeeds.`, nodeId: n.id })
  for (const e of out) {
    if (e.data.outcomeId && e.data.outcomeId !== AUTO_SUCCESS && e.data.outcomeId !== AUTO_FAILURE)
      issues.push({ level: 'warn', text: `A path out of “${label}” isn’t set to Succeeded or Failed.`, edgeId: e.id })
  }
}

function checkUser({ type, groups, users, issues }: CheckCtx, n: NodeOf<'user'>, out: WfEdge[]) {
  const d = n.data
  const label = d.label
  if (d.distribution === 'direct' && !users.some((u) => u.id === d.userId)) issues.push({ level: 'error', text: `“${label}” needs a person to assign to.`, nodeId: n.id })
  if (d.distribution === 'field' && type?.fields.find((f) => f.id === d.assigneeFieldId)?.type !== 'user')
    issues.push({ level: 'error', text: `“${label}” takes the person from a field — pick which person field.`, nodeId: n.id })
  if (d.distribution !== 'direct') {
    const g = groups.find((x) => x.id === d.groupId)
    if (!g) {
      if (d.distribution === 'field') issues.push({ level: 'warn', text: `“${label}” needs a group to fall back on when the field is empty.`, nodeId: n.id })
      else issues.push({ level: 'error', text: `“${label}” needs a group.`, nodeId: n.id })
    } else if (!g.memberIds.some((id) => users.find((u) => u.id === id)?.available)) issues.push({ level: 'warn', text: `No one in ${g.name} is available for “${label}”.`, nodeId: n.id })
    if (d.distribution === 'manager') {
      const dg = groups.find((x) => x.id === d.distributorGroupId)
      if (!dg?.memberIds.length && !(d.supervisorId ?? g?.supervisorId))
        issues.push({ level: 'warn', text: `“${label}” needs a distribution group or a supervisor to hand out the work.`, nodeId: n.id })
    }
  }
  if (out.length > 1) {
    for (const o of d.outcomes) {
      if (!out.some((e) => e.data.outcomeId === o.id)) issues.push({ level: 'warn', text: `Outcome “${o.label}” of “${label}” isn’t connected to a path.`, nodeId: n.id })
    }
    for (const e of out) if (!d.outcomes.some((o) => o.id === e.data.outcomeId)) issues.push({ level: 'error', text: `A path out of “${label}” has no outcome.`, edgeId: e.id })
  }
  if (d.outcomes.length === 0) issues.push({ level: 'error', text: `“${label}” needs at least one outcome to release with.`, nodeId: n.id })
}
