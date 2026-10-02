import {
  ArrowRightLeft,
  CircleCheck,
  CirclePlay,
  Cog,
  Flag,
  GitFork,
  Inbox,
  LogIn,
  type LucideIcon,
  Mail,
  MoveRight,
  PencilLine,
  Plug,
  Sparkles,
  TriangleAlert,
  Undo2,
  UserPlus,
} from 'lucide-react'
import { cx } from '../../components/ui'
import type { AuditEntry, AuditKind, SimObject } from '@throughline/core/engine/engine'
import type { Workflow } from '@throughline/core/model/types'
import { formatClock } from '@throughline/core/model/util'

const KIND: Record<AuditKind, { icon: LucideIcon; tone: string; label: string }> = {
  created: { icon: Sparkles, tone: 'bg-brand-50 text-brand-600', label: 'Created' },
  entered: { icon: LogIn, tone: 'bg-sky-50 text-sky-600', label: 'Entered step' },
  decision: { icon: GitFork, tone: 'bg-amber-50 text-amber-600', label: 'Decision' },
  auto: { icon: Cog, tone: 'bg-violet-50 text-violet-600', label: 'Automated' },
  assigned: { icon: UserPlus, tone: 'bg-sky-50 text-sky-600', label: 'Assigned' },
  fetched: { icon: Inbox, tone: 'bg-sky-50 text-sky-600', label: 'Fetched' },
  started: { icon: CirclePlay, tone: 'bg-slate-100 text-slate-500', label: 'Started' },
  released: { icon: CircleCheck, tone: 'bg-emerald-50 text-emerald-600', label: 'Released' },
  reassigned: { icon: ArrowRightLeft, tone: 'bg-amber-50 text-amber-600', label: 'Reassigned' },
  returned: { icon: Undo2, tone: 'bg-amber-50 text-amber-600', label: 'Returned' },
  moved: { icon: MoveRight, tone: 'bg-amber-50 text-amber-600', label: 'Moved' },
  notify: { icon: Mail, tone: 'bg-slate-100 text-slate-500', label: 'Notification' },
  integration: { icon: Plug, tone: 'bg-violet-50 text-violet-600', label: 'Integration' },
  field: { icon: PencilLine, tone: 'bg-slate-100 text-slate-500', label: 'Field change' },
  completed: { icon: Flag, tone: 'bg-emerald-50 text-emerald-600', label: 'Finished' },
  stuck: { icon: TriangleAlert, tone: 'bg-rose-50 text-rose-600', label: 'Stuck' },
}

/** The audit trail: every routing decision, assignment, release and field change, newest first. */
export function ObjectHistory({ obj, wf }: { obj: SimObject; wf?: Workflow }) {
  const entries = [...obj.history].reverse()
  const stepLabel = (id?: string) => (id ? wf?.nodes.find((n) => n.id === id)?.data.label : undefined)
  return (
    <ol className="relative">
      {entries.map((e, i) => (
        <HistoryRow key={`${e.at}-${obj.history.length - 1 - i}`} entry={e} last={i === entries.length - 1} step={stepLabel(e.nodeId)} rejected={obj.status === 'rejected' || obj.status === 'cancelled'} />
      ))}
    </ol>
  )
}

function HistoryRow({ entry, last, step, rejected }: { entry: AuditEntry; last: boolean; step?: string; rejected: boolean }) {
  const k = KIND[entry.kind]
  const tone = entry.kind === 'completed' && rejected ? 'bg-rose-50 text-rose-600' : k.tone
  const Icon = k.icon
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute top-7 bottom-0 left-[13px] w-px bg-slate-200" aria-hidden />}
      <span className={cx('relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white', tone)} title={k.label}>
        <Icon size={13} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm leading-snug text-slate-800">{entry.text}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">{formatClock(entry.at)}</span>
          {step && (
            <>
              <span aria-hidden>·</span>
              <span>{step}</span>
            </>
          )}
          {entry.actor && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium text-slate-600">by {entry.actor}</span>
            </>
          )}
        </p>
        {entry.comment && <blockquote className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-700">“{entry.comment}”</blockquote>}
      </div>
    </li>
  )
}
