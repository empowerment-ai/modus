import { ArrowDown, ArrowUp, ChevronsUp } from 'lucide-react'
import type { Priority } from '@modus-bpm/core/model/types'
import { cx } from '../../components/ui'

const STYLE: Record<Priority, { label: string; className: string; icon?: typeof ArrowUp }> = {
  low: { label: 'Low', className: 'bg-slate-100 text-slate-600', icon: ArrowDown },
  normal: { label: 'Normal', className: 'bg-slate-100 text-slate-600' },
  high: { label: 'High', className: 'bg-amber-50 text-amber-800', icon: ArrowUp },
  urgent: { label: 'Urgent', className: 'bg-rose-50 text-rose-700', icon: ChevronsUp },
}

/** Work priority: shown on cards, tables and the item drawer. Normal is quiet on purpose. */
export function PriorityBadge({ priority, quietNormal, className }: { priority: Priority; quietNormal?: boolean; className?: string }) {
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
