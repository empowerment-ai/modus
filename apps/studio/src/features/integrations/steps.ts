import type { App, Design, Id, NodeOf, Workflow, WfNodeType } from '@modus-bpm/core/model/types'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

// Finding steps across every application, and opening one in the designer.
// Shared by the service registry ("Used by") and the Groups tab.

export interface NodeRef<T extends WfNodeType = WfNodeType> {
  app: App
  wf: Workflow
  node: NodeOf<T>
}

/** Every step of one type in every workflow of every application. */
export function nodesOfType<T extends WfNodeType>(design: Design, type: T): Array<NodeRef<T>> {
  const out: Array<NodeRef<T>> = []
  for (const app of design.apps) for (const wf of app.workflows) for (const node of wf.nodes) if (node.type === type) out.push({ app, wf, node: node as NodeOf<T> })
  return out
}

/**
 * The drill-down path to a subflow: a process workflow, then each subflow
 * opened on the way down, ending with the subflow itself. Undefined when no
 * process workflow runs it.
 */
export function pathToSubflow(app: App, subflowId: Id): Id[] | undefined {
  const byId = new Map(app.workflows.map((w) => [w.id, w]))
  const queue: Id[][] = app.workflows.filter((w) => w.kind !== 'subflow').map((w) => [w.id])
  const seen = new Set(queue.map((p) => p[0]!))
  while (queue.length) {
    const path = queue.shift()!
    for (const n of byId.get(path[path.length - 1]!)?.nodes ?? []) {
      const child = n.type === 'subflow' ? n.data.workflowId : undefined
      if (!child || seen.has(child)) continue
      if (child === subflowId) return [...path, child]
      seen.add(child)
      queue.push([...path, child])
    }
  }
  return undefined
}

/** Open the workflow designer on this step, switching application and drilling into subflows as needed. */
export function openStep(appId: Id, workflowId: Id, nodeId: Id) {
  const ui = useUi.getState()
  if (ui.appId !== appId) ui.setApp(appId)
  ui.setView('workflow')
  const app = useDesign.getState().design.apps.find((a) => a.id === appId)
  const wf = app?.workflows.find((w) => w.id === workflowId)
  const path = app && wf?.kind === 'subflow' ? pathToSubflow(app, workflowId) : undefined
  if (path) {
    ui.setWorkflow(path[0])
    for (const id of path.slice(1)) ui.drillInto(id)
  } else ui.setWorkflow(workflowId)
  ui.select({ kind: 'node', id: nodeId })
}

/** "Invoice Processing › Approval" — where a step lives, for lists that span applications. */
export function whereLabel(ref: Pick<NodeRef, 'app' | 'wf'>): string {
  return `${ref.app.name} › ${ref.wf.name}`
}
