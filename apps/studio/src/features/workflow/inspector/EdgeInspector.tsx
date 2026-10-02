import { ArrowDown, ArrowRight, ArrowUp, Route } from 'lucide-react'
import { Field, IconButton, Select, Toggle } from '../../../components/ui'
import { describeCondition } from '@throughline/core/model/conditions'
import type { App, WfEdge, Workflow } from '@throughline/core/model/types'
import { useDesign } from '../../../store/design'
import { useSim } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { decisionBranches } from '../edgeLabels'
import { ConditionEditor } from './ConditionEditor'
import { PanelHeader, Section } from './common'

export function EdgeInspector({ app, wf, edge }: { app: App; wf: Workflow; edge: WfEdge }) {
  const users = useDesign((s) => s.design.users)
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const count = useSim((s) => s.sims[app.id]?.edgeCounts[edge.id] ?? 0)
  const src = wf.nodes.find((n) => n.id === edge.source)
  const dst = wf.nodes.find((n) => n.id === edge.target)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)

  const update = (fn: (e: WfEdge, w: Workflow) => void) =>
    updateWorkflow(app.id, wf.id, (w) => {
      const e = w.edges.find((x) => x.id === edge.id)
      if (e) fn(e, w)
    })

  const remove = () => {
    updateWorkflow(app.id, wf.id, (w) => {
      w.edges = w.edges.filter((e) => e.id !== edge.id)
    })
    useUi.getState().select(null)
  }

  const branches = src?.type === 'decision' ? decisionBranches(wf, src.id) : []
  const ruled = branches.filter((b) => !b.data.isDefault)
  const pos = ruled.findIndex((b) => b.id === edge.id)

  const move = (dir: -1 | 1) => {
    const swap = ruled[pos + dir]
    if (!swap) return
    updateWorkflow(app.id, wf.id, (w) => {
      // Renumber all rule branches in their new order.
      const order = ruled.map((b) => b.id)
      ;[order[pos], order[pos + dir]] = [order[pos + dir]!, order[pos]!]
      order.forEach((id, i) => {
        const e = w.edges.find((x) => x.id === id)
        if (e) e.data.order = i
      })
    })
  }

  return (
    <>
      <PanelHeader icon={<Route size={18} className="text-slate-500" />} kind="Path" title={`${src?.data.label ?? '?'} → ${dst?.data.label ?? '?'}`} onDelete={remove} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Route">
          <div className="flex items-center gap-2 text-sm">
            <button type="button" className="truncate rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700 hover:bg-slate-200" onClick={() => src && useUi.getState().select({ kind: 'node', id: src.id })}>
              {src?.data.label}
            </button>
            <ArrowRight size={14} className="shrink-0 text-slate-400" />
            <button type="button" className="truncate rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700 hover:bg-slate-200" onClick={() => dst && useUi.getState().select({ kind: 'node', id: dst.id })}>
              {dst?.data.label}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500 tabular-nums">{count === 0 ? 'No simulated work has taken this path yet.' : `${count.toLocaleString()} item${count === 1 ? ' has' : 's have'} taken this path.`}</p>
        </Section>

        {src?.type === 'user' && (
          <Section title="Outcome" hint={`When someone releases “${src.data.label}” with this outcome, the work follows this path.`}>
            <Field label="Release outcome">
              <Select value={edge.data.outcomeId ?? ''} onChange={(e) => update((x) => void (x.data.outcomeId = e.target.value || undefined))}>
                <option value="">Choose…</option>
                {src.data.outcomes.map((o) => {
                  const taken = wf.edges.some((x) => x.id !== edge.id && x.source === src.id && x.data.outcomeId === o.id)
                  return (
                    <option key={o.id} value={o.id}>
                      {o.label}
                      {taken ? ' (already has a path)' : ''}
                    </option>
                  )
                })}
              </Select>
            </Field>
          </Section>
        )}

        {src?.type === 'decision' && type && (
          <Section
            title="Rule"
            hint={
              edge.data.isDefault
                ? 'Taken when no other branch of this decision matches.'
                : `Branches are checked top to bottom; the first match wins. This one is checked ${pos + 1} of ${ruled.length}.`
            }
            action={
              !edge.data.isDefault && ruled.length > 1 ? (
                <div className="flex">
                  <IconButton label="Check earlier" disabled={pos <= 0} onClick={() => move(-1)}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton label="Check later" disabled={pos >= ruled.length - 1} onClick={() => move(1)}>
                    <ArrowDown size={14} />
                  </IconButton>
                </div>
              ) : undefined
            }
          >
            <div className="mb-3">
              <Toggle
                checked={!!edge.data.isDefault}
                onChange={(on) =>
                  update((x, w) => {
                    if (on) for (const other of w.edges) if (other.source === x.source && other.id !== x.id) other.data.isDefault = false
                    x.data.isDefault = on
                    if (!on && !x.data.condition) x.data.condition = { match: 'all', rules: [] }
                    if (!on) x.data.order = ruled.length
                  })
                }
                label={<span className="text-sm">“Otherwise” path (default)</span>}
              />
            </div>
            {!edge.data.isDefault && (
              <>
                <ConditionEditor
                  condition={edge.data.condition ?? { match: 'all', rules: [] }}
                  onChange={(c) => update((x) => void (x.data.condition = c))}
                  type={type}
                  lists={app.lists}
                  users={users}
                />
                <p className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
                  {type.pluralName} where <b className="font-semibold text-slate-800">{describeCondition(edge.data.condition, { type, lists: app.lists, users })}</b> go to{' '}
                  <b className="font-semibold text-slate-800">{dst?.data.label}</b>.
                </p>
              </>
            )}
          </Section>
        )}

        {(src?.type === 'start' || src?.type === 'auto') && (
          <Section title="Behavior">
            <p className="text-xs leading-relaxed text-slate-600">Taken automatically as soon as “{src.data.label}” finishes. To branch on field values, route through a Decision.</p>
          </Section>
        )}
      </div>
    </>
  )
}
