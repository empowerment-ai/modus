import { Ban, CircleCheck, CircleX, GitFork, Layers, Play, Plus, Zap } from 'lucide-react'
import { Button, Field, Input, Select, Toggle } from '../../../components/ui'
import type { App, TriggerKind, WfNode, Workflow } from '@modus-bpm/core/model/types'
import { useDesign } from '../../../store/design'
import { useSim, useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { TRIGGER } from '../kinds'
import { subflowCallers } from '../model'
import { showStep } from '../navigate'
import { BranchList } from './BranchList'
import { Body, deleteNode, NumberInput, PanelHeader, Section, useNodeUpdater } from './common'

type N<T extends WfNode['type']> = Extract<WfNode, { type: T }>

export function StartInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'start'> }) {
  const update = useNodeUpdater<N<'start'>>(app.id, wf.id, node.id)
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const m = useSimView()?.nodes[node.id]
  const trigger = node.data.trigger ?? 'form'
  const info = TRIGGER[trigger]
  // Event streams can bring hundreds of items an hour.
  const max = trigger === 'event' ? 600 : 80
  const callers = wf.kind === 'subflow' ? subflowCallers(app, wf.id) : []

  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Play size={14} fill="currentColor" />
          </span>
        }
        kind="Start"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        {wf.kind === 'subflow' ? (
          <Section title="Start" hint="A subflow never starts on its own: it starts when an item reaches a step that runs it.">
            <Field label="Name">
              <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
            </Field>
            <div className="mt-3">
              <span className="mb-1 block text-xs font-medium text-slate-600">Runs inside</span>
              {callers.length === 0 ? (
                <p className="text-xs text-amber-700">No step runs this subflow yet.</p>
              ) : (
                <ul className="space-y-1">
                  {callers.map((c) => (
                    <li key={c.node.id}>
                      <button
                        type="button"
                        onClick={() => showStep(c.wf.id, c.node.id)}
                        className="flex w-full items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-left text-xs hover:bg-slate-50"
                      >
                        <Layers size={13} className="shrink-0 text-teal-600" />
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{c.node.data.label}</span>
                        <span className="shrink-0 text-slate-500">{c.wf.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        ) : (
          <>
            <Section title="Trigger">
              <div className="space-y-3">
                <Field label="Name">
                  <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
                </Field>
                <Field label="New items come from" hint={info.help}>
                  <Select value={trigger} onChange={(e) => update((n) => void (n.data.trigger = e.target.value as TriggerKind))}>
                    {(Object.keys(TRIGGER) as TriggerKind[]).map((k) => (
                      <option key={k} value={k}>
                        {TRIGGER[k].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {trigger !== 'form' && (
                  <Field label="Source">
                    <Input
                      value={node.data.source ?? ''}
                      placeholder={info.placeholder}
                      className="font-mono text-xs"
                      onChange={(e) => update((n) => void (n.data.source = e.target.value || undefined))}
                    />
                  </Field>
                )}
                <Field label="Each one creates a new" hint="Every new object of this type enters the workflow here.">
                  <Select value={wf.objectTypeId} onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.objectTypeId = e.target.value))}>
                    {app.objectTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Section>
            <Section title="Simulated arrivals" hint={`How many new ${type?.pluralName.toLowerCase() ?? 'items'} arrive each hour while the simulation runs.`}>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={max}
                  value={Math.min(max, wf.arrivalsPerHour)}
                  onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.arrivalsPerHour = Number(e.target.value)))}
                  className="flex-1 accent-brand-600"
                  aria-label="Arrivals per hour"
                />
                <NumberInput
                  className="w-[104px]"
                  value={wf.arrivalsPerHour}
                  min={0}
                  suffix="/ hour"
                  onChange={(v) => updateWorkflow(app.id, wf.id, (w) => void (w.arrivalsPerHour = Math.max(0, v ?? 0)))}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => useUi.getState().openCreate(wf.id)}>
                  New {type?.name ?? 'item'}…
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Zap size={13} />}
                  onClick={() => {
                    const n = useSim.getState().burst(wf.id, 25)
                    useUi.getState().toast(`${n} ${type?.pluralName.toLowerCase() ?? 'items'} arrived at once.`, 'success')
                  }}
                >
                  Burst of 25
                </Button>
              </div>
              {(m?.entered ?? 0) > 0 && <p className="mt-3 text-xs text-slate-500">{m!.entered.toLocaleString()} created so far in this simulation.</p>}
            </Section>
          </>
        )}
      </Body>
    </>
  )
}

export function EndInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'end'> }) {
  const update = useNodeUpdater<N<'end'>>(app.id, wf.id, node.id)
  const m = useSimView()?.nodes[node.id]
  const result = node.data.result
  const Icon = result === 'completed' ? CircleCheck : result === 'rejected' ? CircleX : Ban
  const isSubflow = wf.kind === 'subflow'
  const scope = isSubflow ? 'subflow' : 'item'
  const terminate = node.data.terminate ?? result !== 'completed'
  return (
    <>
      <PanelHeader
        icon={
          <span className={`flex h-8 w-8 items-center justify-center rounded-full text-white ${result === 'completed' ? 'bg-emerald-600' : result === 'rejected' ? 'bg-rose-600' : 'bg-slate-500'}`}>
            <Icon size={16} />
          </span>
        }
        kind="End"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        <Section title="Finish">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
            </Field>
            <Field label="Result" hint="Counts toward Completed or Rejected on the dashboard.">
              <Select value={result} onChange={(e) => update((n) => void (n.data.result = e.target.value as N<'end'>['data']['result']))}>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </Field>
            {isSubflow && (
              <Field label="Ending name" hint={`The step running this subflow follows the path for this name, so give each way of finishing its own (“Approved”, “Returned”). Empty uses “${result}”.`}>
                <Input value={node.data.outcome ?? ''} placeholder={result} onChange={(e) => update((n) => void (n.data.outcome = e.target.value || undefined))} />
              </Field>
            )}
          </div>
          {(m?.entered ?? 0) > 0 && <p className="mt-3 text-xs text-slate-500">{m!.entered.toLocaleString()} finished here.</p>}
        </Section>
        <Section title="Parallel branches">
          <Toggle checked={terminate} onChange={(on) => update((n) => void (n.data.terminate = on))} label={<span className="text-sm">Stop every branch here</span>} />
          <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
            {terminate
              ? `Reaching this end finishes the ${scope} at once and withdraws any branches still running in parallel.`
              : `Only this branch finishes. Branches running in parallel carry on; the ${scope} is done when the last one ends.`}{' '}
            By default this is on for rejected and cancelled ends and off for completed ones.
          </p>
        </Section>
      </Body>
    </>
  )
}

export function DecisionInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'decision'> }) {
  const update = useNodeUpdater<N<'decision'>>(app.id, wf.id, node.id)
  const m = useSimView()?.nodes[node.id]
  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <GitFork size={17} />
          </span>
        }
        kind="Decision"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        <Section title="Decision">
          <Field label="Question">
            <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
          </Field>
          {(m?.stuck ?? 0) > 0 && <p className="mt-2 text-xs font-medium text-rose-600">{m!.stuck} item(s) matched no branch and are stuck here. Add an “Otherwise” path.</p>}
        </Section>
        <Section title="Branches" hint="Checked from top to bottom using the object’s field values; the first match wins. Drag from the diamond’s edge to add a branch.">
          <BranchList app={app} wf={wf} nodeId={node.id} />
        </Section>
      </Body>
    </>
  )
}
