import { describeCondition } from '@modus-bpm/core/model/conditions'
import { subflowOutcomes } from '@modus-bpm/core/model/templates'
import { AUTO_FAILURE, AUTO_SUCCESS } from '@modus-bpm/core/model/types'
import type { App, User, WfEdge, Workflow } from '@modus-bpm/core/model/types'
import { isRuled } from './model'

export type EdgeTone = 'outcome-ok' | 'outcome-bad' | 'outcome' | 'rule' | 'default' | 'warn' | 'plain'

export interface EdgeLabel {
  text: string
  tone: EdgeTone
  /** 1-based evaluation order for decision branches. */
  order?: number
}

const BAD = /reject|deny|return|cancel|fail/i
const GOOD = /approv|resolv|order|accept|complete|done|ok/i

/** Rule branches of a decision (or inclusive split): ruled paths in order, then the default. */
export function decisionBranches(wf: Workflow, nodeId: string): WfEdge[] {
  const out = wf.edges.filter((e) => e.source === nodeId)
  return out.sort((a, b) => {
    if (!!a.data.isDefault !== !!b.data.isDefault) return a.data.isDefault ? 1 : -1
    return (a.data.order ?? 0) - (b.data.order ?? 0)
  })
}

export function edgeLabel(app: App, wf: Workflow, edge: WfEdge, users: User[]): EdgeLabel | undefined {
  const src = wf.nodes.find((n) => n.id === edge.source)
  if (!src) return undefined
  if (src.type === 'user') {
    const outcome = src.data.outcomes.find((o) => o.id === edge.data.outcomeId)
    const siblings = wf.edges.filter((e) => e.source === src.id)
    if (!outcome) return siblings.length > 1 ? { text: 'Pick an outcome', tone: 'warn' } : undefined
    return { text: outcome.label, tone: BAD.test(outcome.label) ? 'outcome-bad' : GOOD.test(outcome.label) ? 'outcome-ok' : 'outcome' }
  }
  if (src.type === 'auto') {
    if (edge.data.outcomeId === AUTO_FAILURE) return { text: 'Failed', tone: 'outcome-bad' }
    if (edge.data.outcomeId === AUTO_SUCCESS) return { text: 'Succeeded', tone: 'outcome-ok' }
    // A plain path is the success path; name it only when a Failed path sits beside it.
    return wf.edges.some((e) => e.source === src.id && e.data.outcomeId === AUTO_FAILURE) ? { text: 'Succeeded', tone: 'outcome-ok' } : undefined
  }
  if (src.type === 'subflow') {
    const key = edge.data.outcomeId
    if (!key) return undefined
    const child = app.workflows.find((w) => w.id === src.data.workflowId)
    const ending = subflowOutcomes(child).find((o) => o.key === key || o.result === key)
    if (child && !ending) return { text: `${key} (no such ending)`, tone: 'warn' }
    return { text: key, tone: (ending && ending.result !== 'completed') || BAD.test(key) ? 'outcome-bad' : 'outcome-ok' }
  }
  if (isRuled(src)) {
    const branches = decisionBranches(wf, src.id)
    const order = src.type === 'decision' ? branches.indexOf(edge) + 1 : undefined
    if (edge.data.isDefault) return { text: 'Otherwise', tone: 'default' }
    const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
    if (!type || !edge.data.condition || edge.data.condition.rules.length === 0) return { text: 'Set a rule', tone: 'warn', order }
    return { text: describeCondition(edge.data.condition, { type, lists: app.lists, users }), tone: 'rule', order }
  }
  return undefined
}
