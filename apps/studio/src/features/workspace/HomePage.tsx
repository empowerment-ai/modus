import { ArrowRight, ArrowRightLeft, ArrowUpCircle, CircleCheck, Flag, Inbox, type LucideIcon, PencilLine, Play, Send, Siren, Sparkles, TriangleAlert, Undo2, UserPlus } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { Button, Card, cx, EmptyState, SectionTitle } from '../../components/ui'
import type { AuditKind, SimState, WorkItem } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, User } from '@modus-bpm/core/model/types'
import { formatDuration, simDate } from '@modus-bpm/core/model/util'
import { useSim } from '../../store/sim'
import { PriorityBadge } from '../objects/PriorityBadge'
import { getNext } from './actions'
import { type Activity, asYou, useMyActivity } from './activity'
import { agoText, DUE_SOON_MINUTES, dueTone, greeting, longDate, sortItems, timeOfDay } from './format'
import type { WorkData } from './live'
import { DueLabel, StepName } from './parts'
import { useWorkspace } from './store'

interface Props {
  me: User
  app: App
  users: User[]
  sim: SimState | undefined
  tick: string
  data: WorkData
}

/** Where someone lands: what needs them now, what is at risk, and what just happened to their items. */
export function HomePage({ me, app, users, sim, tick, data }: Props) {
  const { clock, basket, queues, distribution, requests } = data
  const ws = useWorkspace.getState()
  const date = simDate(clock)
  const running = useSim((s) => s.running)

  const overdue = basket.filter((i) => i.overdue)
  const soon = basket.filter((i) => dueTone(i.due, clock) === 'soon')
  const queueWaiting = queues.reduce((n, q) => n + q.items.length, 0)
  const toDistribute = distribution.reduce((n, d) => n + d.waiting.length, 0)
  const openRequests = requests.filter((r) => r.obj.status === 'active')
  const upNext = useMemo(() => sortItems(basket, 'priority').slice(0, 5), [basket])
  const activity = useMyActivity(sim, me, tick)

  // At risk: anything you can act on that is overdue or due within four hours, soonest first.
  const atRisk = useMemo(() => {
    const risky = (i: WorkItem) => i.due !== undefined && i.due - clock <= DUE_SOON_MINUTES
    const rows: Array<{ item: WorkItem; where: 'basket' | 'queue' | 'distribute' }> = [
      ...basket.filter(risky).map((item) => ({ item, where: 'basket' as const })),
      ...queues.flatMap((q) => q.items.filter(risky).map((item) => ({ item, where: 'queue' as const }))),
      ...distribution.flatMap((d) => d.waiting.filter(risky).map((item) => ({ item, where: 'distribute' as const }))),
    ]
    return rows.sort((a, b) => a.item.due! - b.item.due!).slice(0, 6)
  }, [basket, queues, distribution, clock])

  const title = (i: WorkItem) =>
    objectTitle(
      app.objectTypes.find((t) => t.id === i.obj.typeId),
      i.obj.data,
      app.lists,
      users,
    )
  const firstName = me.name.split(' ')[0]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-5 px-6 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">
              {longDate(date)} · {timeOfDay(date)}
            </p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-slate-900">
              {greeting(date)}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {me.title} · {app.name}
              {basket.length > 0 && (
                <>
                  {' · '}
                  <span className="text-slate-800">
                    {basket.length} {basket.length === 1 ? 'item needs' : 'items need'} you
                  </span>
                  {overdue.length > 0 && <span className="font-medium text-rose-600">, {overdue.length} overdue</span>}
                </>
              )}
            </p>
          </div>
          {queues.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-right text-xs text-slate-500">
                <span className="block font-medium text-slate-700 tabular-nums">{queueWaiting.toLocaleString()} waiting</span>
                in your {queues.length === 1 ? 'queue' : `${queues.length} queues`}
              </span>
              <Button
                variant="primary"
                className="h-10 px-4 text-[15px]"
                icon={<Play size={16} />}
                disabled={!queueWaiting}
                onClick={() => getNext(me.id)}
                title="Pull the most urgent item from your queues"
              >
                Get next
              </Button>
            </div>
          )}
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Tile label="In my basket" value={basket.length} onClick={() => ws.go('work')} />
          <Tile
            label="Overdue"
            value={overdue.length}
            tone={overdue.length ? 'red' : undefined}
            onClick={() => {
              ws.setFilter({ overdueOnly: true })
              ws.go('work')
            }}
          />
          <Tile
            label="Due soon"
            hint="next 4 hours"
            value={soon.length}
            tone={soon.length ? 'amber' : undefined}
            onClick={() => {
              ws.setSort('due')
              ws.go('work')
            }}
          />
          {queues.length > 0 && <Tile label="Waiting in my queues" value={queueWaiting} onClick={() => ws.go('queues')} />}
          {distribution.length > 0 && <Tile label="To distribute" value={toDistribute} tone={toDistribute ? 'brand' : undefined} onClick={() => ws.go('distribute')} />}
          <Tile label="My open requests" value={openRequests.length} onClick={() => ws.go('requests')} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <section>
              <SectionTitle
                action={
                  basket.length > 5 && (
                    <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => ws.go('work')}>
                      All {basket.length} in my work
                    </button>
                  )
                }
              >
                Up next
              </SectionTitle>
              <Card>
                {upNext.length === 0 ? (
                  <EmptyState icon={<Inbox size={26} />} title="Nothing in your basket">
                    Work arrives here when it’s assigned to you{queues.length ? ', or press Get next to pull from your queues' : ''}.{!running && ' Run the simulation to let new items arrive.'}
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {upNext.map((i) => (
                      <li key={i.token.id}>
                        <button type="button" onClick={() => ws.openItem(i.token.id)} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                          <PriorityBadge priority={i.priority} className="w-[64px] justify-center" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
                              <span className="truncate text-[13px] font-medium text-slate-900">{title(i) || 'Untitled'}</span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                              <StepName item={i} />
                              <span aria-hidden>·</span>
                              <span className="whitespace-nowrap">{formatDuration(i.age)} at step</span>
                              {i.token.state === 'working' && <span className="font-medium text-brand-700">· Working</span>}
                            </span>
                          </span>
                          <DueLabel due={i.due} clock={clock} className="text-xs" />
                          <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>

            <section>
              <SectionTitle>At risk</SectionTitle>
              <Card>
                {atRisk.length === 0 ? (
                  <p className="flex items-center gap-2 px-4 py-4 text-xs text-slate-500">
                    <CircleCheck size={15} className="text-emerald-500" /> Nothing you can act on is overdue or due in the next 4 hours.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {atRisk.map(({ item: i, where }) => (
                      <li key={i.token.id}>
                        <button
                          type="button"
                          onClick={() => (where === 'basket' ? ws.openItem(i.token.id) : ws.go(where === 'queue' ? 'queues' : 'distribute'))}
                          className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50"
                        >
                          <TriangleAlert size={14} className={cx('shrink-0', i.overdue ? 'text-rose-500' : 'text-amber-500')} />
                          <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
                          <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{title(i) || i.step.label}</span>
                          <span className="hidden text-[11px] whitespace-nowrap text-slate-500 sm:inline">
                            {where === 'basket' ? 'In your basket' : where === 'queue' ? `In the ${i.step.label} queue` : `To hand out · ${i.step.label}`}
                          </span>
                          <DueLabel due={i.due} clock={clock} className="w-[104px] justify-end text-xs" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>

          <section>
            <SectionTitle>Recent activity on my items</SectionTitle>
            <Card>
              {activity.length === 0 ? (
                <EmptyState title="No activity yet">Releases, assignments and changes on items you work or created show up here.</EmptyState>
              ) : (
                <ol className="divide-y divide-slate-100">
                  {activity.map((a, n) => (
                    <ActivityRow key={`${a.obj.id}-${a.entry.at}-${n}`} a={a} me={me} clock={clock} basket={basket} />
                  ))}
                </ol>
              )}
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}

const TILE_TONE = {
  red: 'text-rose-600',
  amber: 'text-amber-700',
  brand: 'text-brand-700',
}

function Tile({ label, value, hint, tone, onClick }: { label: string; value: number; hint?: string; tone?: keyof typeof TILE_TONE; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-left shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-50">
      <span className="block text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</span>
      <span className={cx('mt-1 block text-2xl font-semibold tabular-nums', tone ? TILE_TONE[tone] : 'text-slate-900')}>{value.toLocaleString()}</span>
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </button>
  )
}

const KIND_ICON: Partial<Record<AuditKind, { icon: LucideIcon; tone: string }>> = {
  created: { icon: Sparkles, tone: 'bg-brand-50 text-brand-600' },
  released: { icon: CircleCheck, tone: 'bg-emerald-50 text-emerald-600' },
  completed: { icon: Flag, tone: 'bg-emerald-50 text-emerald-600' },
  assigned: { icon: UserPlus, tone: 'bg-sky-50 text-sky-600' },
  fetched: { icon: UserPlus, tone: 'bg-sky-50 text-sky-600' },
  claimed: { icon: UserPlus, tone: 'bg-sky-50 text-sky-600' },
  distributed: { icon: Send, tone: 'bg-sky-50 text-sky-600' },
  delegated: { icon: ArrowRightLeft, tone: 'bg-amber-50 text-amber-600' },
  reassigned: { icon: ArrowRightLeft, tone: 'bg-amber-50 text-amber-600' },
  returned: { icon: Undo2, tone: 'bg-amber-50 text-amber-600' },
  priority: { icon: ArrowUpCircle, tone: 'bg-amber-50 text-amber-700' },
  field: { icon: PencilLine, tone: 'bg-slate-100 text-slate-500' },
  escalated: { icon: Siren, tone: 'bg-rose-50 text-rose-600' },
  stuck: { icon: TriangleAlert, tone: 'bg-rose-50 text-rose-600' },
}

function ActivityRow({ a, me, clock, basket }: { a: Activity; me: User; clock: number; basket: WorkItem[] }) {
  const k = KIND_ICON[a.entry.kind]
  const Icon = k?.icon
  const held = basket.find((i) => i.obj.id === a.obj.id)
  const open = () => (held ? useWorkspace.getState().openItem(held.token.id) : useWorkspace.getState().openRequest(a.obj.id))
  let text: ReactNode = asYou(a.entry.text, me.name)
  if (a.entry.comment)
    text = (
      <>
        {text} <span className="text-slate-500">“{a.entry.comment}”</span>
      </>
    )
  return (
    <li>
      <button type="button" onClick={open} className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50">
        <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', k?.tone ?? 'bg-slate-100 text-slate-400')}>
          {Icon ? <Icon size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[12.5px] leading-snug text-slate-800">{text}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            <span className="font-mono font-medium text-brand-700">{a.obj.number}</span> · {agoText(clock - a.entry.at)}
          </span>
        </span>
      </button>
    </li>
  )
}
