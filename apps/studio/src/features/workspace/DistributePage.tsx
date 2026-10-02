import { GripVertical, Scale, Send, UserX } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { Avatar, Badge, Button, Card, cx, EmptyState, Meter, Select } from '../../components/ui'
import { type DistributionSummary, type WorkItem, workDistribute, workDistributeEvenly } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, Group, Id, User } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { PriorityBadge } from '../objects/PriorityBadge'
import { sortItems } from './format'
import { perform, type WorkData } from './live'
import { Count, DueLabel, PageHeader } from './parts'

const DRAG_TYPE = 'application/x-modus-token'

interface Props {
  me: User
  app: App
  users: User[]
  groups: Group[]
  data: WorkData
}

/** For dispatchers: hand waiting work to the people on the team, by drag and drop or from a menu. */
export function DistributePage({ me, app, users, groups, data }: Props) {
  const { distribution, clock } = data
  const appId = useUi((s) => s.appId)
  // Live open items per person (read at the throttled render rate).
  const loads = useSim.getState().views[appId]?.users ?? {}

  const hand = (item: WorkItem, toId: Id) => {
    const to = users.find((u) => u.id === toId)
    if (perform((sim, ctx) => workDistribute(sim, ctx, item.token.id, me.id, toId)).ok) useUi.getState().toast(`${item.obj.number} → ${to?.name ?? 'teammate'}`, 'success')
  }

  const evenly = (d: DistributionSummary) => {
    const r = perform((sim, ctx) => workDistributeEvenly(sim, ctx, d.nodeId, me.id))
    if (r.ok)
      useUi
        .getState()
        .toast(
          r.value ? `Handed out ${r.value} ${r.value === 1 ? 'item' : 'items'} at “${d.label}”, fewest open items first.` : 'No one on the team is available right now.',
          r.value ? 'success' : 'warn',
        )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] space-y-6 px-6 py-6">
        <PageHeader
          title="Distribute"
          subtitle="You hand out work at these steps. Drag an item onto a teammate, or pick someone from its menu. Bars show how many items each person has open right now."
        />
        {distribution.length === 0 ? (
          <Card>
            <EmptyState icon={<Send size={26} />} title="You don’t hand out work">
              Dispatchers are members of a step’s distribution group (or its supervisor).
            </EmptyState>
          </Card>
        ) : (
          distribution.map((d) => <StepBoard key={d.nodeId} d={d} me={me} app={app} users={users} groups={groups} loads={loads} clock={clock} onHand={hand} onEvenly={() => evenly(d)} />)
        )}
      </div>
    </div>
  )
}

function StepBoard({
  d,
  me,
  app,
  users,
  groups,
  loads,
  clock,
  onHand,
  onEvenly,
}: {
  d: DistributionSummary
  me: User
  app: App
  users: User[]
  groups: Group[]
  loads: Record<Id, { open: number; working: boolean }>
  clock: number
  onHand: (item: WorkItem, toId: Id) => void
  onEvenly: () => void
}) {
  const [dragging, setDragging] = useState<Id | null>(null)
  const [over, setOver] = useState<Id | null>(null)
  const group = groups.find((g) => g.id === d.groupId)
  const team = (group?.memberIds ?? []).flatMap((id) => users.filter((u) => u.id === id))
  const available = team.filter((u) => u.available).sort((a, b) => (loads[a.id]?.open ?? 0) - (loads[b.id]?.open ?? 0))
  const out = team.filter((u) => !u.available)
  const maxLoad = Math.max(5, ...team.map((u) => loads[u.id]?.open ?? 0))
  const waiting = sortItems(d.waiting, 'priority')
  const byToken = new Map([...d.waiting, ...d.assigned].map((i) => [i.token.id, i]))
  const titleOf = (i: WorkItem) =>
    objectTitle(
      app.objectTypes.find((t) => t.id === i.obj.typeId),
      i.obj.data,
      app.lists,
      users,
    )

  const dragProps = (i: WorkItem) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, i.token.id)
      e.dataTransfer.effectAllowed = 'move'
      setDragging(i.token.id)
    },
    onDragEnd: () => {
      setDragging(null)
      setOver(null)
    },
  })

  const dropProps = (u: User) =>
    u.available
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (over !== u.id) setOver(u.id)
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === u.id ? null : o))
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            const item = byToken.get(e.dataTransfer.getData(DRAG_TYPE))
            setOver(null)
            setDragging(null)
            if (item && item.token.userId !== u.id) onHand(item, u.id)
          },
        }
      : {}

  const pickFor = (i: WorkItem, label: string) => (
    <Select value="" onChange={(e) => e.target.value && onHand(i, e.target.value)} className="h-7 w-[148px] text-xs" aria-label={`${label} ${i.obj.number}`} disabled={!available.length}>
      <option value="">{label}…</option>
      {available
        .filter((u) => u.id !== i.token.userId)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {loads[u.id]?.open ?? 0} open
          </option>
        ))}
    </Select>
  )

  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
            {d.label} <Count n={d.waiting.length} tone={d.waiting.length ? 'brand' : 'slate'} />
          </h2>
          <p className="text-[11px] text-slate-500">
            {d.path} · team: {d.groupName || 'no group set'} · {available.length} of {team.length} available
          </p>
        </div>
        <Button icon={<Scale size={14} />} disabled={!d.waiting.length || !available.length} onClick={onEvenly} title="Give each waiting item to whoever has the fewest open items">
          Distribute evenly
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className="flex max-h-[560px] min-h-[200px] flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Waiting to hand out</h3>
            <span className="text-[11px] text-slate-500 tabular-nums">{d.waiting.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {waiting.length === 0 ? (
              <EmptyState title="All handed out">New items wait here until you give them to someone.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {waiting.slice(0, 60).map((i) => (
                  <li
                    key={i.token.id}
                    {...dragProps(i)}
                    className={cx('flex cursor-grab items-center gap-2 py-2 pr-3 pl-2 text-xs active:cursor-grabbing', dragging === i.token.id ? 'bg-brand-50 opacity-60' : 'hover:bg-slate-50')}
                  >
                    <GripVertical size={14} className="shrink-0 text-slate-300" />
                    <PriorityBadge priority={i.priority} className="w-[62px] justify-center" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
                        <span className="truncate text-[13px] text-slate-900">{titleOf(i) || 'Untitled'}</span>
                      </span>
                      <span className="mt-0.5 flex gap-2 text-[11px] text-slate-500">
                        <span className="tabular-nums">waiting {formatDuration(i.age)}</span>
                        <DueLabel due={i.due} clock={clock} />
                      </span>
                    </span>
                    {pickFor(i, 'Assign to')}
                  </li>
                ))}
                {waiting.length > 60 && <li className="px-4 py-2 text-center text-[11px] text-slate-500">…and {waiting.length - 60} more. Use Distribute evenly to clear the backlog.</li>}
              </ul>
            )}
            {d.assigned.length > 0 && (
              <details className="border-t border-slate-200">
                <summary className="cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-800">
                  Handed out, not started ({d.assigned.length})
                </summary>
                <ul className="divide-y divide-slate-100">
                  {d.assigned.map((i) => {
                    const who = users.find((u) => u.id === i.token.userId)
                    return (
                      <li key={i.token.id} {...dragProps(i)} className="flex cursor-grab items-center gap-2 py-1.5 pr-3 pl-2 text-xs hover:bg-slate-50">
                        <GripVertical size={14} className="shrink-0 text-slate-300" />
                        <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-700">{titleOf(i) || 'Untitled'}</span>
                        {who && <Avatar name={who.name} color={who.color} size={18} />}
                        {pickFor(i, 'Move to')}
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
          </div>
        </Card>

        <div className="grid content-start gap-2.5 sm:grid-cols-2">
          {[...available, ...out].map((u) => {
            const open = loads[u.id]?.open ?? 0
            const here = d.assigned.filter((i) => i.token.userId === u.id)
            const target = over === u.id
            return (
              <div
                key={u.id}
                {...dropProps(u)}
                className={cx(
                  'rounded-lg border bg-white p-3 shadow-xs transition-colors',
                  !u.available
                    ? 'border-dashed border-slate-200 bg-slate-50/60'
                    : target
                      ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-200'
                      : dragging
                        ? 'border-brand-200 border-dashed'
                        : 'border-slate-200',
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cx(!u.available && 'opacity-50')}>
                    <Avatar name={u.name} color={u.color} size={28} />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-slate-900">{u.name}</span>
                      {u.id === me.id && <span className="text-[11px] text-slate-500">(you)</span>}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">{u.title}</span>
                  </span>
                  {u.available ? (
                    <span className={cx('flex items-center gap-1 text-[11px]', loads[u.id]?.working ? 'text-brand-700' : 'text-emerald-700')}>
                      <span className={cx('h-1.5 w-1.5 rounded-full', loads[u.id]?.working ? 'bg-brand-500' : 'bg-emerald-500')} />
                      {loads[u.id]?.working ? 'Busy' : 'Free'}
                    </span>
                  ) : (
                    <Badge>
                      <UserX size={11} /> Out
                    </Badge>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <Meter value={open} max={maxLoad} color={open >= maxLoad * 0.8 ? '#f59e0b' : undefined} />
                  <span className="w-[52px] shrink-0 text-right text-[11px] text-slate-600 tabular-nums">{open} open</span>
                </div>
                {here.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {here.slice(0, 8).map((i) => (
                      <span
                        key={i.token.id}
                        {...dragProps(i)}
                        title={`${i.obj.number} · not started yet. Drag to move it to someone else.`}
                        className="cursor-grab rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-700 hover:border-brand-300"
                      >
                        {i.obj.number}
                      </span>
                    ))}
                    {here.length > 8 && <span className="px-1 text-[10.5px] text-slate-500">+{here.length - 8}</span>}
                  </div>
                )}
                {target && <p className="mt-2 text-[11px] font-medium text-brand-700">Drop to give it to {u.name.split(' ')[0]}</p>}
                {!u.available && <p className="mt-2 text-[11px] text-slate-500">Out today: gets no new work.</p>}
              </div>
            )
          })}
          {team.length === 0 && <p className="text-xs text-slate-500">No team is set for this step.</p>}
        </div>
      </div>
    </section>
  )
}
