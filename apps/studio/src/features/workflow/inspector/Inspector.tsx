import { CircleAlert, CircleCheck, GitBranch, TriangleAlert, Workflow as WorkflowIcon } from 'lucide-react'
import { useMemo } from 'react'
import { DISTRIBUTION } from '../../../components/icons'
import { cx, Field, Input, Select } from '../../../components/ui'
import type { App, Workflow } from '@throughline/core/model/types'
import { formatDuration } from '@throughline/core/model/util'
import { useDesign } from '../../../store/design'
import { useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { validate } from '../model'
import { Section } from './common'
import { EdgeInspector } from './EdgeInspector'
import { AutoInspector, DecisionInspector, EndInspector, StartInspector } from './SimpleInspectors'
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
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const issues = useMemo(() => validate(wf, app, groups, users), [wf, app, groups, users])
  const view = useSimView()
  const userSteps = wf.nodes.filter((n) => n.type === 'user')
  const errors = issues.filter((i) => i.level === 'error').length

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <WorkflowIcon size={17} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Workflow</div>
          <div className="truncate text-sm font-semibold text-slate-900">{wf.name}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Settings">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={wf.name} onChange={(e) => updateWorkflow(app.id, wf.id, (w) => void (w.name = e.target.value))} />
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
              <GitBranch size={14} className="text-slate-400" /> Click any step or path to edit it; Delete removes it.
            </li>
          </ul>
        </Section>
      </div>
    </>
  )
}
