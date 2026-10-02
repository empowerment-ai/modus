import { buildIndex, serviceOf, type NodeMetrics, type SimView } from '@modus-bpm/core'
import type { App, Design, Id, ServiceDef, WfNode, Workflow } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useUi } from '../../store/ui'

export interface Bottleneck {
  node: WfNode
  wf: Workflow
  m: NodeMetrics
  /** Service the step waits for (automated steps). */
  svc?: ServiceDef
  /** Why it counts as the bottleneck, in plain words. */
  why: string
}

/** The live bottleneck with a one-line reason: queue length and age. */
export function describeBottleneck(view: SimView | undefined, app: App, design: Pick<Design, 'users' | 'groups' | 'services'>): Bottleneck | undefined {
  if (!view?.bottleneckId) return undefined
  const idx = buildIndex({ app, users: design.users, groups: design.groups, services: design.services })
  const found = idx.node.get(view.bottleneckId)
  const m = view.nodes[view.bottleneckId]
  if (!found || !m) return undefined
  if (found.node.type === 'auto') {
    const { svc } = serviceOf(idx, found.node.data)
    const why = `${m.queued} waiting for ${svc?.name ?? 'its service'}${svc?.concurrency ? ` (${svc.concurrency} at a time)` : ''}, oldest ${formatDuration(m.oldestAge)}`
    return { ...found, m, svc, why }
  }
  const why = `${m.total} in step with ${m.availableMembers} ${m.availableMembers === 1 ? 'person' : 'people'} available, oldest ${formatDuration(m.oldestAge)}`
  return { ...found, m, why }
}

/** Open a step in the designer. Steps inside a subflow open through a step that runs it, so the breadcrumb leads back. */
export function openStep(app: App, workflowId: Id, nodeId: Id) {
  const ui = useUi.getState()
  const wf = app.workflows.find((w) => w.id === workflowId)
  const parent = wf?.kind === 'subflow' ? app.workflows.find((w) => w.nodes.some((n) => n.type === 'subflow' && n.data.workflowId === workflowId)) : undefined
  ui.setView('workflow')
  if (parent) {
    ui.setWorkflow(parent.id)
    ui.drillInto(workflowId)
  } else {
    ui.setWorkflow(workflowId)
  }
  ui.select({ kind: 'node', id: nodeId })
}
