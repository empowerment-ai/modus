import type { Id } from '@throughline/core/model/types'
import { useUi } from '../../store/ui'

/** Open a workflow (going back up the subflow trail when it is on it) and select one of its steps. */
export function showStep(workflowId: Id, nodeId: Id) {
  const ui = useUi.getState()
  const i = ui.trail.indexOf(workflowId)
  if (i >= 0) ui.drillTo(i)
  else if (ui.workflowId !== workflowId) ui.setWorkflow(workflowId)
  useUi.getState().select({ kind: 'node', id: nodeId })
}
