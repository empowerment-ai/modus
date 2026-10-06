import { Check, ChevronDown, Clock } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { useClickOutside } from '../../components/Shell'
import { Badge, cx } from '../../components/ui'
import { type Ctx, fieldVerdicts, itemVersion, PRIORITIES, runnable, type SimObject, type TokenState, type WorkItem } from '@modus-bpm/core'
import type { Id, Priority } from '@modus-bpm/core/model/types'
import { PriorityBadge } from '../objects/PriorityBadge'
import { dueText, dueTone } from './format'

// Small building blocks shared by the Workspace pages.

/** How an item stands overall. */
export const STATUS: Record<SimObject['status'], { label: string; tone: 'brand' | 'green' | 'red' | 'slate' }> = {
  active: { label: 'In progress', tone: 'brand' },
  completed: { label: 'Completed', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

/** Is the field that titles an item hidden from this person? Then show its number, not the title. */
export function titleHidden(ctx: Ctx, obj: SimObject, userId: Id): boolean {
  const type = ctx.app.objectTypes.find((t) => t.id === obj.typeId)
  const field = type && (type.fields.find((f) => f.id === type.titleFieldId) ?? type.fields.find((f) => f.summary))
  if (!type || !field) return false
  // The field locks of the version the item runs.
  const drawn = ctx.app.workflows.find((w) => w.id === obj.workflowId)
  const wf = drawn && runnable(drawn, itemVersion(drawn, obj))
  const admin = !!ctx.users.find((u) => u.id === userId)?.roles?.includes('admin')
  return fieldVerdicts({ type, wf, passed: obj.passed, userId, groups: ctx.groups, admin })[field.id]?.access === 'hidden'
}

const DUE_CLASS = {
  overdue: 'text-rose-600 font-medium',
  soon: 'text-amber-700 font-medium',
  later: 'text-slate-600',
  none: 'text-slate-400',
}

/** Relative due date, red when overdue and amber when due within four hours. */
export function DueLabel({ due, clock, icon, className }: { due: number | undefined; clock: number; icon?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap tabular-nums', DUE_CLASS[dueTone(due, clock)], className)}>
      {icon && <Clock size={12} className="shrink-0" />}
      {dueText(due, clock)}
    </span>
  )
}

/** Where a work item stands in your basket. */
export function StateChip({ state }: { state: TokenState }) {
  if (state === 'working') return <Badge tone="brand">Working</Badge>
  if (state === 'assigned') return <Badge tone="sky">In basket</Badge>
  if (state === 'unassigned') return <Badge tone="amber">Waiting</Badge>
  return <Badge>{state}</Badge>
}

/** The step a work item is at, with its subflow path when it runs inside one. */
export function StepName({ item, className }: { item: WorkItem; className?: string }) {
  const nested = item.token.calls.length > 0
  return (
    <span className={cx('min-w-0 truncate', className)} title={nested ? `${item.path} › ${item.step.label}` : item.step.label}>
      {item.step.label}
      {nested && <span className="text-slate-400"> · {item.path}</span>}
    </span>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Priority badge that opens a small menu to change it. */
export function PriorityMenu({ priority, onChange, disabled }: { priority: Priority; onChange: (p: Priority) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  if (disabled) return <PriorityBadge priority={priority} />
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded-md p-0.5 hover:bg-slate-100"
        title="Change priority"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PriorityBadge priority={priority} />
        <ChevronDown size={12} className="text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="animate-slide-in absolute top-8 left-0 z-30 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {[...PRIORITIES].reverse().map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                if (p !== priority) onChange(p)
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
            >
              <PriorityBadge priority={p} />
              {p === priority && <Check size={13} className="text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A count pill used in the sub-navigation and section headers. */
export function Count({ n, tone = 'slate' }: { n: number; tone?: 'slate' | 'red' | 'brand' }) {
  if (!n) return null
  return (
    <span
      className={cx(
        'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums',
        tone === 'red' ? 'bg-rose-100 text-rose-700' : tone === 'brand' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-700',
      )}
    >
      {n > 999 ? '999+' : n}
    </span>
  )
}
