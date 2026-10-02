import { Ban, Bot, CircleCheck, CircleX, GitFork, Play, Plus, Zap } from 'lucide-react'
import { Button, Field, Input, Select, Textarea } from '../../../components/ui'
import type { App, WfNode, Workflow } from '@throughline/core/model/types'
import { useDesign } from '../../../store/design'
import { useSim, useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { decisionBranches, edgeLabel } from '../edgeLabels'
import { ActionsEditor } from './ActionsEditor'
import { deleteNode, NumberInput, PanelHeader, Section, useNodeUpdater } from './common'

type N<T extends WfNode['type']> = Extract<WfNode, { type: T }>

function Body({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
}

export function StartInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'start'> }) {
  const update = useNodeUpdater<N<'start'>>(app.id, wf.id, node.id)
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const m = useSimView()?.nodes[node.id]
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
        <Section title="Trigger">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
            </Field>
            <Field label="Starts when this is created" hint="Every new object of this type enters the workflow here.">
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
        <Section title="Simulated arrivals" hint={`How many new ${type?.pluralName.toLowerCase() ?? 'items'} arrive each hour while the simulation runs (e.g. uploaded or scanned).`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={80}
              value={wf.arrivalsPerHour}
              onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.arrivalsPerHour = Number(e.target.value)))}
              className="flex-1 accent-brand-600"
              aria-label="Arrivals per hour"
            />
            <NumberInput className="w-[104px]" value={wf.arrivalsPerHour} min={0} suffix="/ hour" onChange={(v) => updateWorkflow(app.id, wf.id, (w) => void (w.arrivalsPerHour = Math.max(0, v ?? 0)))} />
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
      </Body>
    </>
  )
}

export function EndInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'end'> }) {
  const update = useNodeUpdater<N<'end'>>(app.id, wf.id, node.id)
  const m = useSimView()?.nodes[node.id]
  const result = node.data.result
  const Icon = result === 'completed' ? CircleCheck : result === 'rejected' ? CircleX : Ban
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
          </div>
          {(m?.entered ?? 0) > 0 && <p className="mt-3 text-xs text-slate-500">{m!.entered.toLocaleString()} finished here.</p>}
        </Section>
      </Body>
    </>
  )
}

export function AutoInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'auto'> }) {
  const update = useNodeUpdater<N<'auto'>>(app.id, wf.id, node.id)
  const users = useDesign((s) => s.design.users)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const m = useSimView()?.nodes[node.id]
  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <Bot size={17} />
          </span>
        }
        kind="Automated step"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        <Section title="Step">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
            </Field>
            <Field label="Description">
              <Textarea value={node.data.description ?? ''} className="min-h-[56px]" onChange={(e) => update((n) => void (n.data.description = e.target.value))} />
            </Field>
            <Field label="Average processing time" hint="Simulated time the server takes per item.">
              <NumberInput value={node.data.avgMinutes} min={0} suffix="min" onChange={(v) => update((n) => void (n.data.avgMinutes = Math.max(0, v ?? 0)))} />
            </Field>
          </div>
          {(m?.total ?? 0) > 0 && <p className="mt-3 text-xs text-slate-500">{m!.total} being processed now.</p>}
        </Section>
        <Section title="Actions" hint="Run in order by the server; later decisions can route on the values they set.">
          <ActionsEditor actions={node.data.actions} type={type} users={users} onChange={(actions) => update((n) => void (n.data.actions = actions))} />
        </Section>
      </Body>
    </>
  )
}

export function DecisionInspector({ app, wf, node }: { app: App; wf: Workflow; node: N<'decision'> }) {
  const update = useNodeUpdater<N<'decision'>>(app.id, wf.id, node.id)
  const users = useDesign((s) => s.design.users)
  const counts = useSim((s) => s.sims[app.id]?.edgeCounts)
  useSim((s) => s.version)
  const branches = decisionBranches(wf, node.id)
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
          {branches.length === 0 ? (
            <p className="text-xs text-slate-500">No branches yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {branches.map((e) => {
                const label = edgeLabel(app, wf, e, users)
                const target = wf.nodes.find((n) => n.id === e.target)
                const total = branches.reduce((s, b) => s + (counts?.[b.id] ?? 0), 0)
                const c = counts?.[e.id] ?? 0
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => useUi.getState().select({ kind: 'edge', id: e.id })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:border-amber-300 hover:bg-amber-50/40"
                    >
                      <div className="flex items-center gap-1.5 text-xs">
                        {label?.order !== undefined && <span className="rounded bg-amber-200/70 px-1 text-[10px] font-bold text-amber-900">{label.order}</span>}
                        <span className={e.data.isDefault ? 'text-slate-500 italic' : 'font-medium text-slate-800'}>{label?.text ?? 'Always'}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>→ {target?.data.label}</span>
                        {total > 0 && (
                          <span className="tabular-nums">
                            {c} · {Math.round((c / total) * 100)}%
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </Section>
      </Body>
    </>
  )
}
