import { Layers } from 'lucide-react'
import { Button } from '../../../components/ui'
import { expandToSubflow } from '@modus-bpm/core/model/templates'
import type { App, Id, Workflow } from '@modus-bpm/core/model/types'
import { useDesign } from '../../../store/design'
import { useSim } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { Section } from './common'

/**
 * "Blow out" a user or automated step: it becomes a subflow step running a new
 * subflow that holds the original step, so it can grow into its own process.
 */
export function ExpandToSubflow({ app, wf, nodeId }: { app: App; wf: Workflow; nodeId: Id }) {
  const expand = () => {
    const node = wf.nodes.find((n) => n.id === nodeId)
    const total = useSim.getState().views[app.id]?.nodes[nodeId]?.total ?? 0
    if (total > 0) {
      useUi.getState().toast(`“${node?.data.label}” has ${total} item${total === 1 ? '' : 's'} in progress. Let them move on (or move them) first.`, 'warn')
      return
    }
    const result = expandToSubflow(app, wf, nodeId)
    if (!result) return
    useDesign.getState().updateApp(app.id, (a) => {
      const i = a.workflows.findIndex((w) => w.id === wf.id)
      if (i >= 0) a.workflows[i] = result.parent
      a.workflows.push(result.child)
    })
    useUi.getState().drillInto(result.child.id)
    useUi.getState().toast(`“${node?.data.label}” now runs its own subflow. Add steps here; each ending is a path out of the step.`, 'success')
  }
  return (
    <Section title="Grow it" hint="Turn this step into a subflow: it stays on this map, and the work inside it gets a process of its own. Paths out of it keep working.">
      <Button size="sm" icon={<Layers size={13} />} onClick={expand}>
        Blow out into a subflow
      </Button>
    </Section>
  )
}
