import { Bot, CircleAlert, CircleCheck, GitBranch, Layers, Lock, TriangleAlert, Workflow as WorkflowIcon } from 'lucide-react'
import { useMemo } from 'react'
import { DISTRIBUTION } from '../../../components/icons'
import { cx, Field, Input, Select, Textarea, Toggle } from '../../../components/ui'
import type { App, ExpeditePolicy, Workflow } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useDesign } from '../../../store/design'
import { useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { SERVICE_KIND } from '../kinds'
import { subflowCallers, validate } from '../model'
import { showStep } from '../navigate'
import { AutoInspector } from './AutoInspector'
import { AudiencePicker } from './AudiencePicker'
import { ChoiceCard, NumberInput, Section } from './common'
import { EdgeInspector } from './EdgeInspector'
import { JoinInspector, SplitInspector, WaitInspector } from './FlowInspectors'
import { DecisionInspector, EndInspector, StartInspector } from './SimpleInspectors'
import { SubflowInspector } from './SubflowInspector'
import { UserStepInspector } from './UserStepInspector'

export function Inspector({ app, wf }: { app: App; wf: Workflow }) {
  const selection = useUi((s) => s.selection)
  const node = selection?.kind === 'node' ? wf.nodes.find((n) => n.id === selection.id) : undefined
  const edge = selection?.kind === 'edge' ? wf.edges.find((e) => e.id === selection.id) : undefined

  let body: React.ReactNode
  if (node) {
    switch (node.type) {
      case 'user':
        body = <UserStepInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'auto':
        body = <AutoInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'decision':
        body = <DecisionInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'split':
        body = <SplitInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'join':
        body = <JoinInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'subflow':
        body = <SubflowInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'wait':
        body = <WaitInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'start':
        body = <StartInspector key={node.id} app={app} wf={wf} node={node} />
        break
      case 'end':
        body = <EndInspector key={node.id} app={app} wf={wf} node={node} />
        break
    }
  } else if (edge) {
    body = <EdgeInspector key={edge.id} app={app} wf={wf} edge={edge} />
  } else {
    body = <WorkflowOverview app={app} wf={wf} />
  }

  return <aside className="flex w-[372px] shrink-0 flex-col border-l border-slate-200 bg-white">{body}</aside>
}

function WorkflowOverview({ app, wf }: { app: App; wf: Workflow }) {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const services = useDesign((s) => s.design.services)
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const issues = useMemo(() => validate(wf, app, groups, users, services), [wf, app, groups, users, services])
  const view = useSimView()
  const userSteps = wf.nodes.filter((n) => n.type === 'user')
  const autoSteps = wf.nodes.filter((n) => n.type === 'auto')
  const errors = issues.filter((i) => i.level === 'error').length
  const isSubflow = wf.kind === 'subflow'
  const callers = isSubflow ? subflowCallers(app, wf.id) : []
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', isSubflow ? 'bg-teal-50 text-teal-600' : 'bg-brand-50 text-brand-600')}>
          {isSubflow ? <Layers size={17} /> : <WorkflowIcon size={17} />}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">{isSubflow ? 'Subflow' : 'Workflow'}</div>
          <div className="truncate text-sm font-semibold text-slate-900">{wf.name}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Settings">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={wf.name} onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.name = e.target.value))} />
            </Field>
            <Field label="Description">
              <Textarea
                value={wf.description ?? ''}
                className="min-h-[52px]"
                placeholder="What this process is for"
                onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.description = e.target.value || undefined))}
              />
            </Field>
            <Field label="Processes" hint="The object type whose fields the decisions and forms use.">
              <Select value={wf.objectTypeId} onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.objectTypeId = e.target.value))}>
                {app.objectTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            {isSubflow ? (
              <div>
                <span className="mb-1 block text-xs font-medium text-slate-600">Runs inside</span>
                {callers.length === 0 ? (
                  <p className="text-xs text-amber-700">No step runs this subflow yet. Point a Subflow step at it.</p>
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
            ) : (
              <Field label="Target time" hint="Sets each new item’s due date; items past it show as overdue.">
                <NumberInput value={wf.targetHours} min={0} step={0.5} suffix="hours" onChange={(v) => updateWorkflow(app.id, wf.id, (w) => void (w.targetHours = v || undefined))} />
              </Field>
            )}
          </div>
        </Section>

        <Section title={issues.length ? `Check (${issues.length})` : 'Check'}>
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <CircleCheck size={15} /> Every step is connected and configured.
            </p>
          ) : (
            <ul className="space-y-1">
              {issues.map((i, k) => (
                <li key={k}>
                  <button
                    type="button"
                    disabled={!i.nodeId && !i.edgeId}
                    onClick={() => useUi.getState().select(i.nodeId ? { kind: 'node', id: i.nodeId } : { kind: 'edge', id: i.edgeId! })}
                    className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs text-slate-700 enabled:hover:bg-slate-50"
                  >
                    {i.level === 'error' ? <CircleAlert size={14} className="mt-px shrink-0 text-rose-500" /> : <TriangleAlert size={14} className="mt-px shrink-0 text-amber-500" />}
                    <span>{i.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors > 0 && <p className="mt-2 text-[11px] text-slate-500">Work that reaches a broken spot is parked as “stuck” and resumes on its own once you fix the map.</p>}
        </Section>

        <Section
          title="Process supervisors"
          hint={`They oversee every item in this ${isSubflow ? 'subflow' : 'workflow and the subflows it runs'}: reassign work, release it on someone’s behalf, change priority, expedite, and hear about escalations.`}
        >
          <AudiencePicker
            value={wf.supervisors}
            onChange={(a) => updateWorkflow(app.id, wf.id, (w) => void (w.supervisors = a))}
            users={users}
            groups={groups}
            emptyText="No process supervisors: only administrators and each step’s supervisors can step in."
          />
        </Section>

        {!isSubflow && <ExpediteSection app={app} wf={wf} />}

        <Section title="Field security" hint="Workflow-wide locks. Edit them in People & Security › Field security.">
          {(wf.fieldLocks ?? []).length === 0 ? (
            <p className="text-xs text-slate-500">No fields are locked across this workflow.</p>
          ) : (
            <ul className="space-y-1.5">
              {(wf.fieldLocks ?? []).map((l) => {
                const field = type?.fields.find((f) => f.id === l.fieldId)
                const after = wf.nodes.find((n) => n.id === l.afterNodeId)
                const exempt = (l.exemptGroupIds ?? []).map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean)
                return (
                  <li key={l.id} className="flex items-start gap-2 text-xs">
                    <Lock size={12} className="mt-0.5 shrink-0 text-slate-400" />
                    <span className="text-slate-700">
                      <b className="font-semibold text-slate-800">{field?.label ?? 'A removed field'}</b> is {l.access === 'read' ? 'read-only' : 'hidden'}{' '}
                      {l.when === 'always' ? 'everywhere' : `after “${after?.data.label ?? 'a removed step'}”`}
                      {exempt.length > 0 && <span className="text-slate-500"> · except {exempt.join(', ')}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {userSteps.length > 0 && (
          <Section title="People steps">
            <ul className="space-y-1.5">
              {userSteps.map((n) => {
                if (n.type !== 'user') return null
                const m = view?.nodes[n.id]
                const dist = DISTRIBUTION[n.data.distribution]
                const Icon = dist.icon
                const heat = m?.heat ?? 0
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => useUi.getState().select({ kind: 'node', id: n.id })}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:bg-slate-50"
                    >
                      <span className={cx('h-2 w-2 shrink-0 rounded-full', ['bg-slate-300', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'][heat])} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-slate-800">{n.data.label}</span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Icon size={11} /> {dist.short}
                          {m && m.avgWait > 0 ? ` · avg wait ${formatDuration(m.avgWait)}` : ''}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-slate-700 tabular-nums">{m?.total ?? 0}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}

        {autoSteps.length > 0 && (
          <Section title="Automated steps">
            <ul className="space-y-1.5">
              {autoSteps.map((n) => {
                if (n.type !== 'auto') return null
                const m = view?.nodes[n.id]
                const svc = services.find((s) => s.id === n.data.serviceId)
                const Icon = svc ? SERVICE_KIND[svc.kind].icon : Bot
                const heat = m?.heat ?? 0
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => useUi.getState().select({ kind: 'node', id: n.id })}
                      className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:bg-slate-50"
                    >
                      <span className={cx('h-2 w-2 shrink-0 rounded-full', ['bg-slate-300', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'][heat])} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-slate-800">{n.data.label}</span>
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Icon size={11} className="shrink-0" /> <span className="truncate">{svc?.name ?? 'Built-in actions'}</span>
                          {m && m.queued > 0 ? <span className="shrink-0 text-amber-700"> · {m.queued} queued</span> : null}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-slate-700 tabular-nums">{m?.total ?? 0}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )}

        <Section title="How to read the map">
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">4</span>
              Items at a step right now
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">9</span>
              Building up (several per person, or past SLA)
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">23</span>
              Backed up — a bottleneck
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 items-end gap-[2px]">
                {[8, 12, 9, 13].map((h, i) => (
                  <span key={i} className="w-[5px] rounded-[1px] bg-brand-200" style={{ height: h }} />
                ))}
              </span>
              Each bar is one person’s share of the step’s work
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-600 ring-[3px] ring-brand-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-rose-600 ring-[3px] ring-rose-200" />
              Work moving along a path (red: rejected)
            </li>
            <li className="flex items-center gap-2">
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="absolute inset-[3px] rotate-45 rounded-[3px] border-2 border-indigo-400 bg-indigo-50" />
              </span>
              Parallel split and join: paths that run at the same time
            </li>
            <li className="flex items-center gap-2">
              <Layers size={14} className="text-teal-600" /> A subflow step: double-click it to open the process inside
            </li>
            <li className="flex items-center gap-2">
              <GitBranch size={14} className="text-slate-400" /> Click any step or path to edit it; Delete removes it.
            </li>
          </ul>
        </Section>
      </div>
    </>
  )
}

const SPEEDS: Array<{ factor: number; label: string }> = [
  { factor: 1, label: 'Same due dates' },
  { factor: 0.75, label: '1.3× faster' },
  { factor: 0.5, label: '2× faster' },
  { factor: 0.33, label: '3× faster' },
  { factor: 0.25, label: '4× faster' },
]

const WHO: Array<{ value: ExpeditePolicy['who']; title: string; text: string }> = [
  { value: 'supervisors', title: 'Supervisors only', text: 'Process and step supervisors, and administrators.' },
  { value: 'requester', title: 'The requester and supervisors', text: 'Whoever asked for the item can flag it as urgent too.' },
  { value: 'anyone', title: 'Anyone working on it', text: 'Also the people holding it at a step, besides the requester and supervisors.' },
]

/** Who may flag an item to go faster, how much faster, and how often it happens in the simulation. */
function ExpediteSection({ app, wf }: { app: App; wf: Workflow }) {
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const policy = wf.expedite
  const set = (patch: Partial<ExpeditePolicy>) => updateWorkflow(app.id, wf.id, (w) => void (w.expedite = { ...(w.expedite ?? { who: 'supervisors', slaFactor: 0.5 }), ...patch }))
  // Keep a custom factor (set elsewhere) selectable.
  const speeds = policy && !SPEEDS.some((s) => s.factor === policy.slaFactor) ? [...SPEEDS, { factor: policy.slaFactor, label: `${(1 / policy.slaFactor).toFixed(1)}× faster` }] : SPEEDS
  return (
    <Section title="Expedite" hint="Expedited items jump every queue and basket (even urgent work), get tighter due dates, and can take a fast lane through rules on “Expedited”.">
      <Toggle
        checked={!!policy}
        onChange={(on) => updateWorkflow(app.id, wf.id, (w) => void (w.expedite = on ? { who: 'supervisors', slaFactor: 0.5, requireReason: true } : undefined))}
        label={<span className="text-sm">Set an expedite policy for this process</span>}
      />
      {policy ? (
        <div className="mt-3 space-y-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Who can expedite</span>
            <div className="space-y-1.5">
              {WHO.map((o) => (
                <ChoiceCard key={o.value} active={policy.who === o.value} title={o.title} text={o.text} onClick={() => set({ who: o.value })} />
              ))}
            </div>
          </div>
          <Field label="How much faster" hint="Expedited items get their due dates and step SLAs shortened by this much.">
            <Select value={String(policy.slaFactor)} onChange={(e) => set({ slaFactor: Number(e.target.value) })}>
              {speeds.map((s) => (
                <option key={s.factor} value={String(s.factor)}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Toggle checked={!!policy.requireReason} onChange={(on) => set({ requireReason: on || undefined })} label={<span className="text-xs">Ask for a reason when someone expedites</span>} />
          <Field label="Simulated share of new items expedited" hint="Only shapes the simulation. Leave at 0 to expedite by hand.">
            <NumberInput
              className="w-[120px]"
              value={Math.round((policy.simulateRate ?? 0) * 100)}
              min={0}
              max={50}
              suffix="%"
              onChange={(v) => set({ simulateRate: v ? Math.min(50, Math.max(0, v)) / 100 : undefined })}
            />
          </Field>
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-slate-500">Without a policy, supervisors and administrators can still expedite; those items get due dates twice as fast.</p>
      )}
    </Section>
  )
}
