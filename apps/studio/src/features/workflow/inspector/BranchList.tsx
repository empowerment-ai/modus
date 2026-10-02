import type { App, Id, Workflow } from '@throughline/core/model/types'
import { useDesign } from '../../../store/design'
import { useSim } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { decisionBranches, edgeLabel } from '../edgeLabels'

/**
 * The paths leaving a decision or a split, with their rules and how often each
 * was taken. `shares` shows each path's percentage (not for parallel paths,
 * which every item takes).
 */
export function BranchList({ app, wf, nodeId, shares = true }: { app: App; wf: Workflow; nodeId: Id; shares?: boolean }) {
  const users = useDesign((s) => s.design.users)
  const counts = useSim((s) => s.sims[app.id]?.edgeCounts)
  useSim((s) => s.version)
  const branches = decisionBranches(wf, nodeId)
  if (branches.length === 0) return <p className="text-xs text-slate-500">No paths yet. Drag from the edge of the step to add one.</p>
  const total = branches.reduce((s, b) => s + (counts?.[b.id] ?? 0), 0)
  return (
    <ol className="space-y-1.5">
      {branches.map((e) => {
        const label = edgeLabel(app, wf, e, users)
        const target = wf.nodes.find((n) => n.id === e.target)
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
                <span className={e.data.isDefault || !label ? 'text-slate-500 italic' : label.tone === 'warn' ? 'font-medium text-rose-700' : 'font-medium text-slate-800'}>
                  {label?.text ?? 'Always runs'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>→ {target?.data.label}</span>
                {total > 0 && (
                  <span className="tabular-nums">
                    {c}
                    {shares && ` · ${Math.round((c / total) * 100)}%`}
                  </span>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
