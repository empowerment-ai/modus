import { ArrowRight, ChevronRight, Layers, Plus, TriangleAlert } from 'lucide-react'
import { Badge, Button, Field, Input, Select, Textarea } from '../../../components/ui'
import { subflowOutcomes } from '@throughline/core/model/templates'
import type { App, NodeOf, Workflow } from '@throughline/core/model/types'
import { formatDuration } from '@throughline/core/model/util'
import { useDesign } from '../../../store/design'
import { useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { blankSubflow, pathForEnding, subflowCallers } from '../model'
import { Body, deleteNode, PanelHeader, Section, useNodeUpdater } from './common'
import { Stat } from './WorkPanel'

const RESULT_TONE = { completed: 'green', rejected: 'red', cancelled: 'slate' } as const

export function SubflowInspector({ app, wf, node }: { app: App; wf: Workflow; node: NodeOf<'subflow'> }) {
  const update = useNodeUpdater<NodeOf<'subflow'>>(app.id, wf.id, node.id)
  const m = useSimView()?.nodes[node.id]
  const d = node.data
  const child = app.workflows.find((w) => w.id === d.workflowId)
  const options = app.workflows.filter((w) => w.kind === 'subflow' && w.objectTypeId === wf.objectTypeId && w.id !== wf.id)
  const endings = subflowOutcomes(child)
  const others = child ? subflowCallers(app, child.id).filter((c) => c.node.id !== node.id) : []
  const steps = child?.nodes.filter((n) => n.type === 'user' || n.type === 'auto' || n.type === 'subflow').length ?? 0

  const createNew = () => {
    const sub = blankSubflow(d.label && d.label !== 'New subflow step' ? d.label : 'New subflow', wf.objectTypeId)
    useDesign.getState().updateApp(app.id, (a) => {
      a.workflows.push(sub)
      const n = a.workflows.find((w) => w.id === wf.id)?.nodes.find((x) => x.id === node.id)
      if (n?.type === 'subflow') n.data.workflowId = sub.id
    })
    useUi.getState().toast(`Created the “${sub.name}” subflow. Open it to add its steps.`, 'success')
  }

  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
            <Layers size={17} />
          </span>
        }
        kind="Subflow step"
        title={d.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        <Section title="Step">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={d.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
            </Field>
            <Field label="Description">
              <Textarea value={d.description ?? ''} className="min-h-[56px]" placeholder="What happens inside?" onChange={(e) => update((n) => void (n.data.description = e.target.value))} />
            </Field>
          </div>
        </Section>

        <Section title="Runs this subflow" hint="Items entering this step work through the whole subflow, then continue here on the path for the way it ended.">
          <div className="space-y-2.5">
            <Select value={d.workflowId ?? ''} onChange={(e) => update((n) => void (n.data.workflowId = e.target.value || undefined))}>
              <option value="">Choose a subflow…</option>
              {options.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
              {child && !options.includes(child) && <option value={child.id}>{child.name} (not a subflow of this type)</option>}
            </Select>
            <div className="flex flex-wrap gap-2">
              {child && (
                <Button size="sm" variant="primary" icon={<ChevronRight size={13} />} onClick={() => useUi.getState().drillInto(child.id)}>
                  Open subflow
                </Button>
              )}
              <Button size="sm" icon={<Plus size={13} />} onClick={createNew}>
                New subflow
              </Button>
            </div>
            {child && (
              <p className="text-[11.5px] leading-snug text-slate-500">
                {steps} step{steps === 1 ? '' : 's'} · {endings.length} ending{endings.length === 1 ? '' : 's'}
                {others.length > 0 && <> · also runs in {others.map((c) => `“${c.node.data.label}”`).join(', ')}. Changes to it apply everywhere it runs.</>}
              </p>
            )}
            {!options.length && !child && <p className="text-[11.5px] text-slate-500">No subflows for this object type yet. Create one, or add a step from a template.</p>}
          </div>
        </Section>

        {child && (
          <Section title="Endings → paths" hint="Each way the subflow can finish continues on its own path. Endings are named on the subflow’s End steps.">
            {endings.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <TriangleAlert size={13} /> The subflow has no End step yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {endings.map((o) => {
                  const edge = pathForEnding(wf, node.id, o)
                  const target = edge && wf.nodes.find((n) => n.id === edge.target)
                  return (
                    <li key={o.key} className="rounded-lg border border-slate-200">
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{o.key}</span>
                        <Badge tone={RESULT_TONE[o.result]}>{o.result}</Badge>
                      </div>
                      <div className="border-t border-slate-100 px-2.5 py-1.5 text-[11px]">
                        {target ? (
                          <button type="button" onClick={() => useUi.getState().select({ kind: 'edge', id: edge.id })} className="flex min-w-0 items-center gap-1 text-slate-600 hover:text-brand-700">
                            <ArrowRight size={11} className="shrink-0" /> <span className="truncate">{target.data.label}</span>
                          </button>
                        ) : o.result === 'completed' ? (
                          <span className="flex items-center gap-1 font-medium text-amber-700">
                            <TriangleAlert size={11} /> Not connected — drag a path from this step
                          </span>
                        ) : (
                          <span className="text-slate-500">No path: ends the whole item as {o.result}</span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        )}

        {m && m.entered > 0 && (
          <Section title="Live">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Inside now" value={m.inside} />
              <Stat label="Avg time" value={formatDuration(m.avgTime)} />
              <Stat label="Stuck" value={m.stuck} tone={m.stuck ? 'red' : undefined} />
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500">
              {m.entered.toLocaleString()} started · {m.exited.toLocaleString()} finished. Open the subflow to see where they are.
            </p>
          </Section>
        )}
      </Body>
    </>
  )
}
