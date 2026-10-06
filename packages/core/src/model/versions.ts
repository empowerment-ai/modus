// Versions of a workflow. A workflow's own nodes, edges and settings are its
// working copy: the draft a designer edits. Publishing copies the working copy
// into a numbered version, and new items start on it. Items record the version
// they started on and run it to the end, unless an administrator moves them
// (see engine/versions.ts). A workflow with no versions runs its working copy
// directly, as every workflow did before versions existed.

import type { App, Design, Id, WfEdge, WfNode, Workflow, WorkflowSnapshot, WorkflowVersion } from './types'

// JSON, not structuredClone: it also copies immer drafts, and drops undefined keys the way saving does.
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** The working copy's runtime parts (what a version keeps), copied. */
export function snapshotOf(wf: WorkflowSnapshot): WorkflowSnapshot {
  return copy({ nodes: wf.nodes, edges: wf.edges, targetHours: wf.targetHours, fieldLocks: wf.fieldLocks, supervisors: wf.supervisors, expedite: wf.expedite })
}

/** The version new items start on (undefined when the workflow has no versions). */
export function publishedVersion(wf: Workflow | undefined): number | undefined {
  const all = wf?.versions
  if (!wf || !all?.length) return undefined
  return wf.published !== undefined && all.some((v) => v.version === wf.published) ? wf.published : all[all.length - 1]!.version
}

export function latestVersion(wf: Workflow | undefined): number {
  return Math.max(0, ...(wf?.versions ?? []).map((v) => v.version))
}

export function versionOf(wf: Workflow | undefined, version: number | undefined): WorkflowVersion | undefined {
  return version === undefined ? undefined : wf?.versions?.find((v) => v.version === version)
}

function withSnapshot(wf: Workflow, s: WorkflowSnapshot): Workflow {
  return { ...wf, nodes: s.nodes, edges: s.edges, targetHours: s.targetHours, fieldLocks: s.fieldLocks, supervisors: s.supervisors, expedite: s.expedite }
}

/**
 * The workflow as an item on `version` runs it: that version's snapshot (the
 * published one when no version is given). Unversioned workflows run as drawn.
 */
export function runnable(wf: Workflow, version?: number): Workflow {
  if (!wf.versions?.length) return wf
  const v = versionOf(wf, version) ?? versionOf(wf, publishedVersion(wf))
  return v ? withSnapshot(wf, v.snapshot) : wf
}

/** The application as an item with these pins runs it; other workflows run their published version. */
export function runnableApp(app: App, pins?: Record<Id, number>): App {
  if (!app.workflows.some((w) => w.versions?.length)) return app
  return { ...app, workflows: app.workflows.map((w) => runnable(w, pins?.[w.id])) }
}

/** The version of a workflow an item runs: its pin, else the published one (undefined when unversioned). */
export function itemVersion(wf: Workflow | undefined, item: { versions?: Record<Id, number> }): number | undefined {
  const live = publishedVersion(wf)
  if (live === undefined) return undefined
  const pin = item.versions?.[wf!.id]
  return pin !== undefined && versionOf(wf, pin) ? pin : live
}

/** A step by id: from a working copy, else from the newest version that has it. */
export function findStep(app: App, nodeId: Id): { node: WfNode; wf: Workflow } | undefined {
  for (const wf of app.workflows) {
    const node = wf.nodes.find((n) => n.id === nodeId)
    if (node) return { node, wf }
  }
  for (const wf of app.workflows) {
    for (const v of [...(wf.versions ?? [])].reverse()) {
      const node = v.snapshot.nodes.find((n) => n.id === nodeId)
      if (node) return { node, wf }
    }
  }
  return undefined
}

// ---------- Publishing ----------

/** Copy the working copy into the next version and make it the one new items start on. */
export function publishWorkflow(wf: Workflow, opts: { at?: number; note?: string } = {}): Workflow {
  const version = latestVersion(wf) + 1
  const note = opts.note?.trim()
  const v: WorkflowVersion = { version, publishedAt: opts.at ?? 0, ...(note ? { note } : {}), snapshot: snapshotOf(wf) }
  return { ...wf, versions: [...(wf.versions ?? []), v], published: version }
}

/** Replace the working copy with a version's snapshot (the draft starts over from it). */
export function restoreDraft(wf: Workflow, version: number): Workflow {
  const v = versionOf(wf, version)
  if (!v) return wf
  const s = copy(v.snapshot)
  // The simulated share of expedited arrivals is a simulation setting, not part of the process.
  if (s.expedite && wf.expedite?.simulateRate !== undefined) s.expedite.simulateRate = wf.expedite.simulateRate
  return withSnapshot(wf, s)
}

/**
 * Give every workflow that has no versions a version 1 made from its working
 * copy, published. Workflows that already have versions are left alone.
 */
export function ensureVersions(design: Design, at = 0): Design {
  const done = (w: Workflow) => !!w.versions?.length
  if (design.apps.every((a) => a.workflows.every(done))) return design
  return {
    ...design,
    apps: design.apps.map((a) =>
      a.workflows.every(done)
        ? a
        : { ...a, workflows: a.workflows.map((w) => (done(w) ? w : { ...w, versions: [{ version: 1, publishedAt: at, note: 'First version', snapshot: snapshotOf(w) }], published: 1 })) },
    ),
  }
}

// ---------- What changed ----------

export interface StepChange {
  id: Id
  label: string
  type: WfNode['type']
  /** What changed, in plain words ("renamed from “Approve”", "group, handling time"). */
  detail?: string
}

export interface PathChange {
  id: Id
  /** "Manager approval → Pay". */
  label: string
  detail?: string
}

export interface WorkflowDiff {
  steps: { added: StepChange[]; removed: StepChange[]; changed: StepChange[] }
  paths: { added: PathChange[]; removed: PathChange[]; changed: PathChange[] }
  /** Workflow-wide settings that changed, described. */
  settings: string[]
  /** How many changes in all. */
  count: number
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const blank = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.values(v).every(blank))

/** Deep equality where missing, empty and undefined values are all the same. */
function same(a: unknown, b: unknown): boolean {
  if (a === b || (blank(a) && blank(b))) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) return false
    return true
  }
  return false
}

const STEP_WORDS: Record<string, string> = {
  description: 'description',
  distribution: 'how work is handed out',
  groupId: 'group',
  userId: 'assignee',
  assigneeFieldId: 'assignee field',
  supervisorId: 'dispatcher',
  distributorGroupId: 'dispatchers',
  autoDistribute: 'dispatching',
  distributeEveryMinutes: 'dispatching',
  avgMinutes: 'handling time',
  slaHours: 'service level',
  escalateAfterHours: 'escalation',
  escalation: 'escalation',
  allowDelegate: 'delegation',
  supervisors: 'supervisors',
  separateFrom: 'separation of duties',
  outcomes: 'outcomes',
  fieldAccess: 'field access',
  actions: 'actions',
  serviceId: 'service',
  operationId: 'service',
  inputs: 'service inputs',
  outputs: 'service results',
  retries: 'retries',
  onFailure: 'failure handling',
  fallbackGroupId: 'fallback group',
  mode: 'mode',
  count: 'branches needed',
  cancelRemaining: 'withdrawing branches',
  workflowId: 'subflow',
  minutes: 'timer',
  result: 'result',
  outcome: 'ending name',
  terminate: 'ending',
  trigger: 'trigger',
  source: 'trigger source',
}

const PATH_WORDS: Record<string, string> = { outcomeId: 'outcome', condition: 'rule', isDefault: '“Otherwise”', order: 'rule order' }

function stepDetail(a: WfNode, b: WfNode): string | undefined {
  const words: string[] = []
  if (a.type !== b.type) words.push('type')
  if (a.data.label !== b.data.label) words.push(`renamed from “${a.data.label}”`)
  const da = a.data as unknown as Obj
  const db = b.data as unknown as Obj
  for (const k of new Set([...Object.keys(da), ...Object.keys(db)])) {
    if (k === 'label' || same(da[k], db[k])) continue
    const w = STEP_WORDS[k] ?? 'settings'
    if (!words.includes(w)) words.push(w)
  }
  return words.length ? words.join(', ') : undefined
}

function pathDetail(a: WfEdge, b: WfEdge): string | undefined {
  const words: string[] = []
  if (a.source !== b.source || a.target !== b.target) words.push('reconnected')
  for (const k of new Set([...Object.keys(a.data), ...Object.keys(b.data)])) {
    if (same((a.data as Obj)[k], (b.data as Obj)[k])) continue
    const w = PATH_WORDS[k] ?? 'settings'
    if (!words.includes(w)) words.push(w)
  }
  return words.length ? words.join(', ') : undefined
}

const hours = (h?: number) => (h ? `${h} h` : 'none')

/**
 * What changed from `a` to `b` (e.g. the published version to the draft):
 * steps and paths added, removed or changed, and workflow-wide settings.
 * Layout (where boxes sit, which side a line leaves from) doesn't count.
 */
export function diffWorkflow(a: WorkflowSnapshot, b: WorkflowSnapshot): WorkflowDiff {
  const aNodes = new Map(a.nodes.map((n) => [n.id, n]))
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]))
  const step = (n: WfNode, detail?: string): StepChange => ({ id: n.id, label: n.data.label, type: n.type, ...(detail ? { detail } : {}) })
  const steps: WorkflowDiff['steps'] = { added: [], removed: [], changed: [] }
  for (const n of b.nodes) {
    const was = aNodes.get(n.id)
    if (!was) steps.added.push(step(n))
    else {
      const detail = stepDetail(was, n)
      if (detail) steps.changed.push(step(n, detail))
    }
  }
  for (const n of a.nodes) if (!bNodes.has(n.id)) steps.removed.push(step(n))

  const aEdges = new Map(a.edges.map((e) => [e.id, e]))
  const bEdges = new Map(b.edges.map((e) => [e.id, e]))
  const label = (e: WfEdge, nodes: Map<Id, WfNode>) => `${nodes.get(e.source)?.data.label ?? 'a step'} → ${nodes.get(e.target)?.data.label ?? 'a step'}`
  const paths: WorkflowDiff['paths'] = { added: [], removed: [], changed: [] }
  for (const e of b.edges) {
    const was = aEdges.get(e.id)
    if (!was) paths.added.push({ id: e.id, label: label(e, bNodes) })
    else {
      const detail = pathDetail(was, e)
      if (detail) paths.changed.push({ id: e.id, label: label(e, bNodes), detail })
    }
  }
  for (const e of a.edges) if (!bEdges.has(e.id)) paths.removed.push({ id: e.id, label: label(e, aNodes) })

  const settings: string[] = []
  if (!same(a.targetHours, b.targetHours)) settings.push(`Target time ${hours(a.targetHours)} → ${hours(b.targetHours)}`)
  if (!same(a.fieldLocks, b.fieldLocks)) settings.push('Field security')
  if (!same(a.supervisors, b.supervisors)) settings.push('Process supervisors')
  // The simulated share of expedited arrivals is a simulation setting, not part of the process.
  if (!same({ ...a.expedite, simulateRate: undefined }, { ...b.expedite, simulateRate: undefined })) settings.push('Expedite policy')

  const count = steps.added.length + steps.removed.length + steps.changed.length + paths.added.length + paths.removed.length + paths.changed.length + settings.length
  return { steps, paths, settings, count }
}

/** What the draft changes compared with the published version (undefined when the workflow has no versions). */
export function draftChanges(wf: Workflow): WorkflowDiff | undefined {
  const live = versionOf(wf, publishedVersion(wf))
  return live ? diffWorkflow(live.snapshot, wf) : undefined
}

/** Does the working copy differ from the published version? */
export function hasDraftChanges(wf: Workflow): boolean {
  return (draftChanges(wf)?.count ?? 0) > 0
}
