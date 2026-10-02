import { describeCondition } from '@throughline/core/model/conditions'
import type { App, User, WfEdge, Workflow } from '@throughline/core/model/types'

export type EdgeTone = 'outcome-ok' | 'outcome-bad' | 'outcome' | 'rule' | 'default' | 'warn' | 'plain'

export interface EdgeLabel {
  text: string
  tone: EdgeTone
  /** 1-based evaluation order for decision branches. */
  order?: number
}

const BAD = /reject|deny|return|cancel/i
const GOOD = /approv|resolv|order|accept|complete|done|ok/i

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
  if (src.type === 'decision') {
    const branches = decisionBranches(wf, src.id)
    const order = branches.indexOf(edge) + 1
    if (edge.data.isDefault) return { text: 'Otherwise', tone: 'default' }
    const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
    if (!type || !edge.data.condition || edge.data.condition.rules.length === 0) return { text: 'Set a rule', tone: 'warn', order }
    return { text: describeCondition(edge.data.condition, { type, lists: app.lists, users }), tone: 'rule', order }
  }
  return undefined
}
