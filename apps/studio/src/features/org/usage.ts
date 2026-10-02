import type { App, Design, Id, WfNode, Workflow } from '@throughline/core/model/types'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

export type UserStepNode = Extract<WfNode, { type: 'user' }>

export interface StepRef {
  app: App
  wf: Workflow
  node: UserStepNode
}

/** Every user step in every application. */
export function allUserSteps(design: Design): StepRef[] {
  const out: StepRef[] = []
  for (const app of design.apps)
    for (const wf of app.workflows)
      for (const node of wf.nodes) if (node.type === 'user') out.push({ app, wf, node })
  return out
}

/** Open the workflow designer with this step selected (switching application if needed). */
export function goToStep(appId: Id, workflowId: Id, nodeId: Id) {
  const ui = useUi.getState()
  if (ui.appId !== appId) ui.setApp(appId)
  useUi.getState().setView('workflow')
  useUi.getState().setWorkflow(workflowId)
  useUi.getState().select({ kind: 'node', id: nodeId })
}

/** Open items (assigned or being worked) for a person across every application's simulation. */
export function openWorkFor(userId: Id): number {
  let n = 0
  for (const sim of Object.values(useSim.getState().sims)) {
    for (const id of sim.activeIds) {
      const o = sim.objects[id]
      if (o && o.userId === userId && (o.state === 'assigned' || o.state === 'working')) n++
    }
  }
  return n
}

/** Why a person cannot be removed from the organization (empty = safe to delete). */
export function userDeleteBlockers(design: Design, userId: Id): string[] {
  const reasons: string[] = []
  for (const { app, node } of allUserSteps(design)) {
    if (node.data.distribution === 'direct' && node.data.userId === userId) reasons.push(`direct assignee of ${app.name} › ${node.data.label}`)
    if (node.data.supervisorId === userId) reasons.push(`supervisor of ${app.name} › ${node.data.label}`)
  }
  for (const g of design.groups) if (g.supervisorId === userId) reasons.push(`supervisor of the ${g.name} group`)
  const open = openWorkFor(userId)
  if (open > 0) reasons.push(`${open} open item${open === 1 ? '' : 's'} in the simulation`)
  return reasons
}

/** Why a group cannot be deleted (empty = safe to delete). */
export function groupDeleteBlockers(design: Design, groupId: Id): string[] {
  const reasons: string[] = []
  for (const { app, node } of allUserSteps(design)) if (node.data.groupId === groupId) reasons.push(`works ${app.name} › ${node.data.label}`)
  for (const app of design.apps)
    for (const t of app.objectTypes) if (t.permissions[groupId]) reasons.push(`has permissions on ${app.name} › ${t.pluralName}`)
  return reasons
}
