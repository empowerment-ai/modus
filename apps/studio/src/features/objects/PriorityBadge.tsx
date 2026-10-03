import { ArrowDown, ArrowUp, ChevronsUp, Zap } from 'lucide-react'
import type { Priority } from '@modus-bpm/core/model/types'
import { cx } from '../../components/ui'

const STYLE: Record<Priority, { label: string; className: string; icon?: typeof ArrowUp }> = {
  low: { label: 'Low', className: 'bg-slate-100 text-slate-600', icon: ArrowDown },
  normal: { label: 'Normal', className: 'bg-slate-100 text-slate-600' },
  high: { label: 'High', className: 'bg-amber-50 text-amber-800', icon: ArrowUp },
  urgent: { label: 'Urgent', className: 'bg-rose-50 text-rose-700', icon: ChevronsUp },
}

/** Expedited work outranks even urgent work, so it gets the loudest badge. */
export function ExpeditedBadge({ reason, className }: { reason?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-0.5 rounded bg-orange-600 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-xs', className)}
      title={`Expedited: ahead of all other work${reason ? ` — ${reason}` : ''}`}
    >
      <Zap size={11} strokeWidth={2.5} fill="currentColor" />
      Expedited
    </span>
  )
}

/** Work priority: shown on cards, tables and the item drawer. Normal is quiet on purpose; expedited replaces it. */
export function PriorityBadge({ priority, quietNormal, className, expedited, reason }: { priority: Priority; quietNormal?: boolean; className?: string; expedited?: boolean; reason?: string }) {
  if (expedited) return <ExpeditedBadge reason={reason} className={className} />
  if (quietNormal && priority === 'normal') return null
  const s = STYLE[priority]
  const Icon = s.icon
  return (
    <span className={cx('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', s.className, className)} title={`${s.label} priority`}>
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {s.label}
    </span>
  )
}
