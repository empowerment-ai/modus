import { ArrowLeftRight, CheckCheck, FilePlus, Flag, Hand, type LucideIcon, MoveRight, Activity, TriangleAlert, Undo2, UserPlus } from 'lucide-react'
import { Avatar, cx, EmptyState } from '../../components/ui'
import type { AuditKind, FeedEntry } from '@throughline/core/engine/engine'
import type { Id, User } from '@throughline/core/model/types'
import { formatClock } from '@throughline/core/model/util'
import { useUi } from '../../store/ui'

const KIND: Partial<Record<AuditKind, { icon: LucideIcon; tone: string }>> = {
  created: { icon: FilePlus, tone: 'bg-brand-50 text-brand-600' },
  released: { icon: CheckCheck, tone: 'bg-emerald-50 text-emerald-600' },
  completed: { icon: Flag, tone: 'bg-slate-100 text-slate-600' },
  reassigned: { icon: ArrowLeftRight, tone: 'bg-amber-50 text-amber-700' },
  moved: { icon: MoveRight, tone: 'bg-amber-50 text-amber-700' },
  returned: { icon: Undo2, tone: 'bg-amber-50 text-amber-700' },
  stuck: { icon: TriangleAlert, tone: 'bg-rose-50 text-rose-600' },
  fetched: { icon: Hand, tone: 'bg-sky-50 text-sky-600' },
  assigned: { icon: UserPlus, tone: 'bg-sky-50 text-sky-600' },
}

export function ActivityFeed({ feed, users }: { feed: FeedEntry[]; users: Map<Id, User> }) {
  const openObject = useUi((s) => s.openObject)
  const items = feed.slice(0, 60)
  if (!items.length) {
    return (
      <EmptyState icon={<Activity size={28} />} title="No activity yet">
        Releases, reassignments and comments appear here as work moves.
      </EmptyState>
    )
  }
  return (
    <ol className="max-h-[420px] divide-y divide-slate-100 overflow-auto">
      {items.map((e, i) => {
        const k = KIND[e.kind] ?? { icon: Activity, tone: 'bg-slate-100 text-slate-500' }
        const Icon = k.icon
        const user = e.userId ? users.get(e.userId) : undefined
        return (
          <li key={`${e.at}-${e.objectId}-${e.kind}-${i}`} className="flex gap-2.5 px-4 py-2">
            <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', k.tone)}>
              <Icon size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-[11px] text-slate-500">
                <button type="button" onClick={() => openObject(e.objectId)} className="font-mono font-medium text-brand-700 hover:underline">
                  {e.number}
                </button>
                <span className="tabular-nums">{formatClock(e.at)}</span>
              </div>
              <p className="text-xs leading-snug text-slate-700">{e.text}</p>
              {e.comment && (
                <div className="mt-1 flex items-start gap-1.5">
                  {user && <Avatar name={user.name} color={user.color} size={18} />}
                  <p className="rounded-lg rounded-tl-sm bg-slate-100 px-2 py-1 text-xs leading-snug text-slate-700">“{e.comment}”</p>
                </div>
              )}
            </div>
            {user && !e.comment && <Avatar name={user.name} color={user.color} size={20} />}
          </li>
        )
      })}
    </ol>
  )
}
