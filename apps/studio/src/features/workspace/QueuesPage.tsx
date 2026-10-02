import { ChevronDown, Hand, Inbox, Play } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, cx, EmptyState } from '../../components/ui'
import { type QueueSummary, type WorkItem, workClaim } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, User } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useUi } from '../../store/ui'
import { PriorityBadge } from '../objects/PriorityBadge'
import { getNext } from './actions'
import { perform, type WorkData } from './live'
import { DueLabel, PageHeader, StepName } from './parts'
import { useWorkspace } from './store'

const SHOW = 25

/** Shared queues you fetch from: what is waiting in each, with Claim and Get next. */
export function QueuesPage({ me, app, users, data }: { me: User; app: App; users: User[]; data: WorkData }) {
  const { queues, clock } = data
  const total = queues.reduce((n, q) => n + q.items.length, 0)

  const claim = (item: WorkItem, andOpen: boolean) => {
    const r = perform((sim, ctx) => workClaim(sim, ctx, item.token.id, me.id))
    if (!r.ok) return
    if (andOpen) useWorkspace.getState().openItem(item.token.id)
    else useUi.getState().toast(`${item.obj.number} is in your basket.`, 'success')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-4 px-6 py-6">
        <PageHeader
          title="Queues"
          subtitle="Shared work for your groups. Claim what you want to do, or press Get next for the most urgent item across all of them."
          actions={
            queues.length > 0 && (
              <Button variant="primary" icon={<Play size={14} />} disabled={!total} onClick={() => getNext(me.id)}>
                Get next{total > 0 && <span className="font-normal opacity-80"> · {total.toLocaleString()} waiting</span>}
              </Button>
            )
          }
        />
        {queues.length === 0 ? (
          <Card>
            <EmptyState icon={<Inbox size={28} />} title="You don’t work any queues">
              Queues are steps where work waits in a shared list and group members fetch it when they’re ready. Your work reaches your basket another way: shared out evenly, handed out by a
              dispatcher, or assigned to you directly.
            </EmptyState>
          </Card>
        ) : (
          queues.map((q) => <QueueCard key={q.nodeId} q={q} app={app} users={users} clock={clock} defaultOpen={queues.length <= 3} onClaim={claim} />)
        )}
      </div>
    </div>
  )
}

function QueueCard({
  q,
  app,
  users,
  clock,
  defaultOpen,
  onClaim,
}: {
  q: QueueSummary
  app: App
  users: User[]
  clock: number
  defaultOpen: boolean
  onClaim: (item: WorkItem, andOpen: boolean) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [limit, setLimit] = useState(SHOW)
  const oldest = q.items.reduce((m, i) => Math.max(m, i.age), 0)
  const urgent = q.items.filter((i) => i.priority === 'urgent').length
  const overdue = q.items.filter((i) => i.overdue).length
  const type = (i: WorkItem) => app.objectTypes.find((t) => t.id === i.obj.typeId)

  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-slate-50/70">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Inbox size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{q.label}</span>
          <span className="block truncate text-[11px] text-slate-500">
            {q.path}
            {q.groupName && ` · ${q.groupName}`}
          </span>
        </span>
        <Stat label="Waiting" value={q.items.length.toLocaleString()} strong />
        <Stat label="Oldest" value={q.items.length ? formatDuration(oldest) : '—'} />
        <Stat label="Urgent" value={String(urgent)} tone={urgent ? 'red' : undefined} />
        <Stat label="Overdue" value={String(overdue)} tone={overdue ? 'red' : undefined} />
        <ChevronDown size={16} className={cx('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open &&
        (q.items.length === 0 ? (
          <p className="border-t border-slate-100 px-4 py-4 text-xs text-slate-500">The queue is empty. New items land here as they reach “{q.label}”.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {q.items.slice(0, limit).map((i) => (
              <li key={i.token.id} className="flex items-center gap-3 px-4 py-2 text-xs hover:bg-slate-50/70">
                <PriorityBadge priority={i.priority} className="w-[64px] justify-center" />
                <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-900">{objectTitle(type(i), i.obj.data, app.lists, users) || 'Untitled'}</span>
                  {i.token.calls.length > 0 && <StepName item={i} className="block text-[11px] text-slate-500" />}
                </span>
                <span className="w-[64px] text-right text-slate-500 tabular-nums" title="Waiting this long">
                  {formatDuration(i.age)}
                </span>
                <DueLabel due={i.due} clock={clock} className="w-[110px]" />
                <Button size="sm" icon={<Hand size={13} />} onClick={() => onClaim(i, false)} title="Move it to your basket">
                  Claim
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onClaim(i, true)} title="Claim it and open it now">
                  Claim &amp; open
                </Button>
              </li>
            ))}
            {q.items.length > limit && (
              <li className="px-4 py-2 text-center">
                <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setLimit((l) => l + SHOW * 2)}>
                  Show more ({(q.items.length - limit).toLocaleString()} more waiting)
                </button>
              </li>
            )}
          </ul>
        ))}
    </Card>
  )
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'red' }) {
  return (
    <span className="hidden w-[68px] shrink-0 text-right leading-tight sm:block">
      <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">{label}</span>
      <span className={cx('block tabular-nums', strong ? 'text-base font-semibold text-slate-900' : 'text-[13px] font-medium', tone === 'red' ? 'text-rose-600' : !strong && 'text-slate-700')}>
        {value}
      </span>
    </span>
  )
}
