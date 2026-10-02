import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from '@xyflow/react'
import { TriangleAlert } from 'lucide-react'
import { memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cx } from '../../components/ui'
import type { WfEdge } from '@throughline/core/model/types'
import { FLIGHT_MS, useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import type { EdgeLabel, EdgeTone } from './edgeLabels'

export type FlowEdgeData = { edge: WfEdge; label?: EdgeLabel }

const CHIP: Record<EdgeTone, string> = {
  'outcome-ok': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'outcome-bad': 'border-rose-200 bg-rose-50 text-rose-700',
  outcome: 'border-slate-200 bg-white text-slate-700',
  rule: 'border-amber-200 bg-amber-50 text-amber-900',
  default: 'border-slate-200 bg-slate-50 text-slate-600 italic',
  warn: 'border-rose-300 bg-rose-50 text-rose-700',
  plain: 'border-slate-200 bg-white text-slate-500',
}

export const STROKE: Record<EdgeTone, string> = {
  'outcome-ok': '#6ee7b7',
  'outcome-bad': '#fda4af',
  outcome: '#94a3b8',
  rule: '#fbbf24',
  default: '#94a3b8',
  warn: '#fb7185',
  plain: '#94a3b8',
}

export const FlowEdge = memo(function FlowEdge(props: EdgeProps & { data: FlowEdgeData }) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14, offset: 24 })
  const appId = useUi((s) => s.appId)
  const count = useSim((s) => s.sims[appId]?.edgeCounts[id] ?? 0)
  const flights = useSim(useShallow((s) => s.flights.filter((f) => f.edgeId === id)))
  const label = data.label
  const tone: EdgeTone = label?.tone ?? 'plain'
  const now = performance.now()

  const select = (e: React.MouseEvent) => {
    e.stopPropagation()
    useUi.getState().select({ kind: 'edge', id })
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: selected ? 'var(--color-brand-600)' : STROKE[tone], strokeWidth: selected ? 2.5 : 1.75 }}
      />
      <EdgeLabelRenderer>
        {(label || count > 0) && (
          <button
            type="button"
            onClick={select}
            className={cx(
              'nodrag nopan absolute inline-flex max-w-[190px] items-center gap-1 rounded-md border px-1.5 py-[3px] text-[10.5px] leading-none font-medium shadow-xs',
              CHIP[tone],
              selected && 'ring-2 ring-brand-300',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            title={label?.text}
          >
            {tone === 'warn' && <TriangleAlert size={10} className="shrink-0" />}
            {label?.order !== undefined && <span className="rounded-sm bg-amber-200/70 px-1 text-[9.5px] font-bold text-amber-900">{label.order}</span>}
            {label && <span className="truncate">{label.text}</span>}
            {count > 0 && <span className={cx('shrink-0 tabular-nums', label ? 'border-l border-current/20 pl-1 opacity-70' : 'text-slate-500')}>{count}</span>}
          </button>
        )}
        {flights.map((f) => (
          <div
            key={f.key}
            className={cx('wf-token', f.reject && 'reject')}
            style={{ offsetPath: `path('${path}')`, animationDelay: `${Math.max(0, f.t0 - now)}ms`, ['--dur' as string]: `${FLIGHT_MS}ms` }}
          />
        ))}
      </EdgeLabelRenderer>
    </>
  )
})

export const edgeTypes = { flow: FlowEdge }
