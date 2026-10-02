import { Trash2, X } from 'lucide-react'
import { type ReactNode, useCallback } from 'react'
import { cx, IconButton } from '../../../components/ui'
import type { Id, WfNode, Workflow } from '@modus-bpm/core/model/types'
import { useDesign } from '../../../store/design'
import { useSim } from '../../../store/sim'
import { useUi } from '../../../store/ui'

export function PanelHeader({ icon, kind, title, onDelete }: { icon: ReactNode; kind: string; title: ReactNode; onDelete?: () => void }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
      {icon}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">{kind}</div>
        <div className="truncate text-sm font-semibold text-slate-900">{title}</div>
      </div>
      {onDelete && (
        <IconButton label="Delete" onClick={onDelete} className="hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={15} />
        </IconButton>
      )}
      <IconButton label="Close" onClick={() => useUi.getState().select(null)}>
        <X size={16} />
      </IconButton>
    </div>
  )
}

export function Section({ title, children, action, hint }: { title: string; children: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{title}</h4>
        {action}
      </div>
      {hint && <p className="-mt-1 mb-2.5 text-[11.5px] leading-snug text-slate-500">{hint}</p>}
      {children}
    </section>
  )
}

/** Update one node of the workflow with an immer recipe. */
export function useNodeUpdater<T extends WfNode>(appId: Id, wfId: Id, nodeId: Id) {
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  return useCallback(
    (fn: (node: T) => void) =>
      updateWorkflow(appId, wfId, (w) => {
        const n = w.nodes.find((x) => x.id === nodeId)
        if (n) fn(n as T)
      }),
    [updateWorkflow, appId, wfId, nodeId],
  )
}

/** Delete a node (and its paths) unless live work is sitting on it. */
export function deleteNode(appId: Id, wf: Workflow, nodeId: Id) {
  const total = useSim.getState().views[appId]?.nodes[nodeId]?.total ?? 0
  const node = wf.nodes.find((n) => n.id === nodeId)
  if (total > 0) {
    useUi.getState().toast(`“${node?.data.label}” still has ${total} items. Move or finish them first.`, 'warn')
    return
  }
  useDesign.getState().updateWorkflow(appId, wf.id, (w) => {
    w.nodes = w.nodes.filter((n) => n.id !== nodeId)
    w.edges = w.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
  })
  useUi.getState().select(null)
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
  className,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  className?: string
}) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="h-8 w-full rounded-md border border-slate-300 bg-white px-2.5 pr-12 text-sm tabular-nums shadow-xs focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
    </div>
  )
}

/** One of a few mutually exclusive ways a step can behave, as a selectable card. */
export function ChoiceCard({
  active,
  title,
  text,
  hint,
  icon,
  onClick,
  children,
}: {
  active: boolean
  title: ReactNode
  text: ReactNode
  hint?: string
  icon?: ReactNode
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <div className={cx('rounded-lg border transition-colors', active ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')}>
      <button type="button" onClick={onClick} aria-pressed={active} className="w-full px-2.5 py-2 text-left">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-800">
          {icon && <span className={active ? 'text-brand-600' : 'text-slate-400'}>{icon}</span>}
          {title}
          {hint && <span className="ml-auto text-[10.5px] font-normal text-slate-400">{hint}</span>}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-600">{text}</span>
      </button>
      {active && children && <div className="px-2.5 pb-2.5">{children}</div>}
    </div>
  )
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
}
