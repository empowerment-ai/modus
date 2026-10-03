import { ArrowLeft, Check, CircleCheck, Eye, MoreHorizontal, RotateCw, Scale, Siren, Undo2, Zap, ZapOff } from 'lucide-react'
import { type ReactNode, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '../../components/Shell'
import { Avatar, Badge, Button, Card, cx, EmptyState, Field, Meter, Modal, Segmented, SectionTitle, Select, Textarea } from '../../components/ui'
import {
  type Ctx,
  describeToken,
  PRIORITIES,
  setExpedite,
  type SimState,
  type SupervisedStep,
  superviseAssign,
  superviseRedistribute,
  superviseRelease,
  superviseRetry,
  superviseReturn,
  superviseSetPriority,
  type WorkItem,
} from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, Distribution, Group, Id, Priority, User } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { PriorityBadge } from '../objects/PriorityBadge'
import { openFound } from './actions'
import { ExpediteDialog, UrgencyBadge } from './Expedite'
import { isRejectLike, sortItems } from './format'
import { perform, type WorkData } from './live'
import { Count, DueLabel, PageHeader, titleHidden } from './parts'
import { ItemReadView } from './RequestsPage'
import { useWorkspace } from './store'

interface Props {
  me: User
  app: App
  ctx: Ctx
  users: User[]
  groups: Group[]
  sim: SimState | undefined
  tick: string
  data: WorkData
}

type Loads = Record<Id, { open: number; working: boolean }>

const HOW: Record<Distribution, string> = {
  'load-balance': 'shared out evenly',
  queue: 'shared queue',
  manager: 'handed out by dispatchers',
  direct: 'one named person',
  field: 'person named on the item',
}

const returnTo = (d: Distribution) => (d === 'queue' ? 'the queue' : d === 'manager' ? 'the dispatchers' : 'the pool')

const toast = (text: string, tone: 'success' | 'warn' | 'info' = 'success') => useUi.getState().toast(text, tone)

/** For supervisors (and administrators): the work at the steps they oversee, and the levers to keep it moving. */
export function SupervisePage({ me, app, ctx, users, groups, sim, data }: Props) {
  const viewId = useWorkspace((s) => s.viewId)
  const stepId = useWorkspace((s) => s.superviseStep)
  const appId = useUi((s) => s.appId)
  // Live open items per person (read at the throttled render rate).
  const loads: Loads = useSim.getState().views[appId]?.users ?? {}
  const { supervision } = data

  const viewed = viewId ? sim?.objects[viewId] : undefined
  if (viewed && sim) return <ItemReadView me={me} app={app} ctx={ctx} users={users} groups={groups} sim={sim} obj={viewed} crumb="Supervise" onBack={() => useWorkspace.getState().view(null)} />

  const row = { me, app, users, groups, sim, ctx, clock: data.clock, loads, basket: data.basket }
  const step = stepId ? supervision.steps.find((s) => s.nodeId === stepId) : undefined
  if (step) return <StepDetail step={step} {...row} />
  return <Overview {...row} data={data} />
}

interface RowCtx {
  me: User
  app: App
  users: User[]
  groups: Group[]
  sim: SimState | undefined
  ctx: Ctx
  clock: number
  loads: Loads
  basket: WorkItem[]
}

// ---------- Overview ----------

function Overview({ data, ...row }: RowCtx & { data: WorkData }) {
  const { me, app, groups } = row
  const { processes, steps } = data.supervision
  const admin = !!me.roles?.includes('admin')
  const escalated = useMemo(
    () =>
      sortItems(
        steps.flatMap((s) => s.escalated),
        'priority',
      ),
    [steps],
  )
  const byPath = useMemo(() => {
    const m = new Map<string, SupervisedStep[]>()
    for (const s of steps) m.set(s.path, [...(m.get(s.path) ?? []), s])
    return [...m]
  }, [steps])
  const names = processes.map((p) => p.name)
  const subtitle = admin
    ? `You’re an administrator, so you oversee every process in ${app.name}. Reassign, return or release work, change priorities and expedite.`
    : names.length
      ? `You oversee ${names.join(' and ')}: every step and everyone working it. Reassign, return or release work, change priorities and expedite.`
      : `You oversee ${steps.length === 1 ? 'this step' : 'these steps'} as the team’s supervisor. Reassign, return or release work, change priorities and expedite.`

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] space-y-6 px-6 py-6">
        <PageHeader title="Supervise" subtitle={subtitle} />

        <section>
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              Escalated to you <Count n={escalated.length} tone="red" />
            </span>
          </SectionTitle>
          <Card>
            {escalated.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-4 text-xs text-slate-500">
                <CircleCheck size={15} className="shrink-0 text-emerald-500" /> Nothing has escalated to you. When work sits too long at a step you oversee, it lands here so you can step in.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {escalated.map((i) => (
                  <SupervisedRow key={i.token.id} item={i} showStep {...row} />
                ))}
              </ul>
            )}
          </Card>
        </section>

        {steps.length === 0 ? (
          <Card>
            <EmptyState icon={<Eye size={26} />} title="No people steps to oversee here">
              Supervision covers the steps people work. This process only has automated steps so far.
            </EmptyState>
          </Card>
        ) : (
          byPath.map(([path, list]) => (
            <section key={path}>
              <SectionTitle>{path}</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((s) => (
                  <StepCard key={s.nodeId} step={s} app={app} groups={groups} users={row.users} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

/** Counts that matter at a step. */
function stepStats(step: SupervisedStep) {
  const by = (pred: (i: WorkItem) => boolean) => step.items.filter(pred).length
  return {
    waiting: by((i) => i.token.state === 'unassigned'),
    inBaskets: by((i) => i.token.state === 'assigned'),
    working: by((i) => i.token.state === 'working'),
    overdue: by((i) => i.overdue),
    stuck: by((i) => i.token.state === 'stuck'),
    expedited: by((i) => i.expedited),
    escalated: step.escalated.length,
    oldest: step.items.reduce((m, i) => Math.max(m, i.age), 0),
  }
}

/** Members of the step's team, with how many of the step's items each holds right now. */
function teamAt(step: SupervisedStep, groups: Group[], users: User[]) {
  const group = groups.find((g) => g.id === step.groupId)
  const here = new Map<Id, number>()
  for (const i of step.items) if (i.token.userId && (i.token.state === 'assigned' || i.token.state === 'working')) here.set(i.token.userId, (here.get(i.token.userId) ?? 0) + 1)
  const team = (group?.memberIds ?? []).flatMap((id) => users.filter((u) => u.id === id)).map((user) => ({ user, here: here.get(user.id) ?? 0 }))
  return { group, team: team.sort((a, b) => b.here - a.here || a.user.name.localeCompare(b.user.name)) }
}

function distributionOf(app: App, nodeId: Id): Distribution {
  for (const wf of app.workflows) for (const n of wf.nodes) if (n.id === nodeId && n.type === 'user') return n.data.distribution
  return 'queue'
}

function StepCard({ step, app, groups, users }: { step: SupervisedStep; app: App; groups: Group[]; users: User[] }) {
  const s = stepStats(step)
  const { group, team } = teamAt(step, groups, users)
  const max = Math.max(3, ...team.map((t) => t.here))
  const shown = team.slice(0, 4)
  return (
    <button
      type="button"
      onClick={() => useWorkspace.getState().superviseAt(step.nodeId)}
      className="group hover:border-brand-300 flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left shadow-xs transition-colors hover:bg-brand-50/20"
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{step.label}</span>
          <span className="block truncate text-[11px] text-slate-500">
            {group?.name ?? 'No team set'} · {HOW[distributionOf(app, step.nodeId)]}
          </span>
        </span>
        {s.escalated > 0 && (
          <Badge tone="red">
            <Siren size={11} /> {s.escalated} escalated
          </Badge>
        )}
      </span>
      <span className="mt-3 grid grid-cols-4 gap-2">
        <Stat label="Waiting" value={s.waiting} />
        <Stat label="In baskets" value={s.inBaskets} />
        <Stat label="Working" value={s.working} />
        <Stat label="Overdue" value={s.overdue} tone={s.overdue ? 'red' : undefined} />
      </span>
      <span className="mt-2 block text-[11px] text-slate-500">
        {step.items.length ? `Oldest ${formatDuration(s.oldest)}` : 'Nothing here right now'}
        {s.expedited > 0 && <span className="font-medium text-orange-700"> · {s.expedited} expedited</span>}
        {s.stuck > 0 && <span className="font-medium text-rose-600"> · {s.stuck} stuck</span>}
      </span>
      {shown.length > 0 && (
        <span className="mt-3 block space-y-1.5 border-t border-slate-100 pt-3">
          {shown.map(({ user, here }) => (
            <span key={user.id} className="flex items-center gap-2">
              <span className={cx(!user.available && 'opacity-50')}>
                <Avatar name={user.name} color={user.color} size={18} />
              </span>
              <span className="w-[88px] shrink-0 truncate text-[11px] text-slate-700">{user.name.split(' ')[0]}</span>
              <Meter value={here} max={max} color={here >= max * 0.8 && here > 1 ? '#f59e0b' : undefined} />
              <span className="w-5 shrink-0 text-right text-[11px] text-slate-600 tabular-nums">{here}</span>
            </span>
          ))}
          {team.length > shown.length && <span className="block text-[11px] text-slate-400">+{team.length - shown.length} more on the team</span>}
        </span>
      )}
      <span className="mt-3 text-[11px] font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100">Open the step</span>
    </button>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <span className="block leading-tight">
      <span className="block text-[10px] font-medium tracking-wide whitespace-nowrap text-slate-400 uppercase">{label}</span>
      <span className={cx('block text-base font-semibold tabular-nums', tone === 'red' ? 'text-rose-600' : 'text-slate-900')}>{value.toLocaleString()}</span>
    </span>
  )
}

// ---------- One step ----------

type Show = 'all' | 'waiting' | 'baskets' | 'working' | 'overdue' | 'escalated' | 'stuck'

const SHOW_TEST: Record<Show, (i: WorkItem) => boolean> = {
  all: () => true,
  waiting: (i) => i.token.state === 'unassigned',
  baskets: (i) => i.token.state === 'assigned',
  working: (i) => i.token.state === 'working',
  overdue: (i) => i.overdue,
  escalated: (i) => !!i.token.escalated,
  stuck: (i) => i.token.state === 'stuck',
}

const ROWS = 100

function StepDetail({ step, ...row }: RowCtx & { step: SupervisedStep }) {
  const { me, app, groups, users, loads } = row
  const [show, setShow] = useState<Show>('all')
  const [limit, setLimit] = useState(ROWS)
  const s = stepStats(step)
  const { group, team } = teamAt(step, groups, users)
  const dist = distributionOf(app, step.nodeId)
  const rows = sortItems(step.items.filter(SHOW_TEST[show]), 'priority')
  const max = Math.max(3, ...team.map((t) => t.here))
  const ws = useWorkspace.getState()

  const redistribute = () => {
    const r = perform((sim, ctx) => superviseRedistribute(sim, ctx, step.nodeId, me.id))
    if (r.ok)
      toast(
        r.value ? `Moved ${r.value} ${r.value === 1 ? 'item' : 'items'} at “${step.label}” so everyone has a fair share.` : 'Nothing to move: the work not yet started is already shared out evenly.',
        r.value ? 'success' : 'info',
      )
  }

  const options: Array<{ value: Show; label: ReactNode }> = [
    { value: 'all', label: `All · ${step.items.length}` },
    { value: 'waiting', label: `Waiting · ${s.waiting}` },
    { value: 'baskets', label: `In baskets · ${s.inBaskets}` },
    { value: 'working', label: `Working · ${s.working}` },
    { value: 'overdue', label: `Overdue · ${s.overdue}` },
    ...(s.escalated ? [{ value: 'escalated' as const, label: `Escalated · ${s.escalated}` }] : []),
    ...(s.stuck ? [{ value: 'stuck' as const, label: `Stuck · ${s.stuck}` }] : []),
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] space-y-5 px-6 py-6">
        <button type="button" onClick={() => ws.superviseAt(null)} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> All steps I supervise
        </button>
        <PageHeader
          title={step.label}
          subtitle={`${step.path} · ${group?.name ?? 'no team set'} · ${HOW[dist]}`}
          actions={
            dist !== 'direct' &&
            dist !== 'field' && (
              <Button
                icon={<Scale size={14} />}
                disabled={!s.waiting && !s.inBaskets}
                onClick={redistribute}
                title="Share out everything not yet started across the available team members, fewest open items first"
              >
                Redistribute evenly
              </Button>
            )
          }
        />

        {team.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-2.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Team load at this step</h3>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {team.map(({ user, here }) => (
                <div key={user.id} className="flex items-center gap-2">
                  <span className={cx(!user.available && 'opacity-50')}>
                    <Avatar name={user.name} color={user.color} size={22} />
                  </span>
                  <span className="w-[120px] shrink-0 truncate text-xs text-slate-800">
                    {user.name}
                    {user.id === me.id && <span className="text-slate-500"> (you)</span>}
                  </span>
                  {user.available ? (
                    <Meter value={here} max={max} color={here >= max * 0.8 && here > 1 ? '#f59e0b' : undefined} />
                  ) : (
                    <span className="flex-1 text-[11px] text-slate-400">Out today</span>
                  )}
                  <span className="w-[104px] shrink-0 text-right text-[11px] whitespace-nowrap text-slate-600 tabular-nums" title="Here at this step · open across all their work">
                    {here} here · {loads[user.id]?.open ?? 0} total
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" value={show} onChange={setShow} options={options} />
          {step.items.length > 0 && <span className="text-[11px] text-slate-500">Oldest {formatDuration(s.oldest)}</span>}
        </div>

        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<CircleCheck size={26} />} title={step.items.length ? 'Nothing in this view' : `Nothing at “${step.label}” right now`}>
              {step.items.length ? 'Pick another filter above.' : 'Work shows up here as it reaches the step. Run the simulation to keep it coming.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.slice(0, limit).map((i) => (
                <SupervisedRow key={i.token.id} item={i} {...row} />
              ))}
              {rows.length > limit && (
                <li className="px-4 py-2 text-center">
                  <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setLimit((l) => l + ROWS)}>
                    Show more ({(rows.length - limit).toLocaleString()} more)
                  </button>
                </li>
              )}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------- One item, with the supervisor's levers ----------

function SupervisedRow({ item: i, showStep, me, app, users, groups, sim, ctx, clock, loads, basket }: RowCtx & { item: WorkItem; showStep?: boolean }) {
  const [releasing, setReleasing] = useState(false)
  const [expediting, setExpediting] = useState(false)
  const type = app.objectTypes.find((t) => t.id === i.obj.typeId)
  const title = titleHidden(ctx, i.obj, me.id) ? '' : objectTitle(type, i.obj.data, app.lists, users)
  const team = (groups.find((g) => g.id === i.step.groupId)?.memberIds ?? []).flatMap((id) => users.filter((u) => u.id === id && u.id !== i.token.userId))
  const where = sim ? describeToken(sim, ctx, i.token) : ''

  const reassign = (toId: Id) => {
    const to = users.find((u) => u.id === toId)
    if (perform((s, c) => superviseAssign(s, c, i.token.id, toId, me.id)).ok) toast(`${i.obj.number} is now with ${toId === me.id ? 'you' : (to?.name ?? 'them')}.`)
  }

  return (
    <li className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs', i.token.escalated && 'bg-rose-50/30')}>
      <span className="flex w-[78px] shrink-0 justify-center">
        <UrgencyBadge priority={i.priority} expedited={i.expedited} quietNormal />
      </span>
      <button type="button" onClick={() => openFound(i.obj.id, basket)} className="font-mono text-[11px] font-medium text-brand-700 hover:underline" title="Open it">
        {i.obj.number}
      </button>
      <span className="min-w-[180px] flex-1">
        <span className="block truncate text-[13px] text-slate-900">{title || 'Untitled'}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {showStep && <span className="font-medium text-slate-700">{i.step.label} ·</span>}
          <span className={cx('truncate', i.token.state === 'stuck' && 'font-medium text-rose-600')}>{where}</span>
          {i.token.escalated && (
            <Badge tone="red" className="py-0">
              <Siren size={10} /> Escalated
            </Badge>
          )}
        </span>
      </span>
      <span className="w-[56px] text-right text-slate-500 tabular-nums" title="At this step for">
        {formatDuration(i.age)}
      </span>
      <DueLabel due={i.due} clock={clock} className="w-[104px]" />
      <span className="flex items-center gap-1.5">
        <Select value="" onChange={(e) => e.target.value && reassign(e.target.value)} className="h-7 w-[150px] text-xs" aria-label={`Reassign ${i.obj.number}`} disabled={!team.length}>
          <option value="">{i.token.userId ? 'Reassign…' : 'Assign to…'}</option>
          {team.map((u) => (
            <option key={u.id} value={u.id} disabled={!u.available}>
              {u.name}
              {u.id === me.id ? ' (you)' : ''} · {u.available ? `${loads[u.id]?.open ?? 0} open` : 'out'}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setReleasing(true)} title="Choose an outcome on their behalf, with a comment">
          Release…
        </Button>
        <RowMenu item={i} me={me} onExpedite={() => setExpediting(true)} />
      </span>
      {releasing && <ReleaseModal item={i} me={me} users={users} onClose={() => setReleasing(false)} />}
      {expediting && <ExpediteDialog obj={i.obj} me={me} wf={i.wf} clock={clock} onClose={() => setExpediting(false)} />}
    </li>
  )
}

function RowMenu({ item: i, me, onExpedite }: { item: WorkItem; me: User; onExpedite: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const giveBack = () => {
    if (perform((s, c) => superviseReturn(s, c, i.token.id, me.id)).ok) toast(`${i.obj.number} went back to ${returnTo(i.step.distribution)}.`)
  }
  const retry = () => {
    if (perform((s, c) => superviseRetry(s, c, i.token.id, me.id)).ok) toast(`Retried ${i.obj.number} at “${i.step.label}”.`)
  }
  const setPriority = (p: Priority) => {
    if (p !== i.obj.priority && perform((s, c) => superviseSetPriority(s, c, i.obj.id, p, me.id)).ok) toast(`${i.obj.number} is now ${p} priority.`)
  }
  const unExpedite = () => {
    if (perform((s, c) => setExpedite(s, c, i.obj.id, me.id, false)).ok) toast(`${i.obj.number} is no longer expedited.`)
  }
  const held = i.token.state === 'assigned' || i.token.state === 'working'
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`More for ${i.obj.number}`}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div role="menu" className="animate-slide-in absolute top-8 right-0 z-30 w-56 rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg">
          {i.step.distribution !== 'direct' && (
            <MenuItem icon={<Undo2 size={13} />} disabled={!held} onClick={run(giveBack)} hint={held ? undefined : 'No one has it'}>
              Return to {returnTo(i.step.distribution)}
            </MenuItem>
          )}
          {i.token.state === 'stuck' && (
            <MenuItem icon={<RotateCw size={13} />} onClick={run(retry)}>
              Retry
            </MenuItem>
          )}
          {i.expedited ? (
            <MenuItem icon={<ZapOff size={13} />} onClick={run(unExpedite)}>
              Remove expedite
            </MenuItem>
          ) : (
            <MenuItem icon={<Zap size={13} className="text-orange-500" />} onClick={run(onExpedite)}>
              Expedite…
            </MenuItem>
          )}
          <div className="my-1 h-px bg-slate-100" />
          <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Priority</p>
          {[...PRIORITIES].reverse().map((p) => (
            <button key={p} type="button" role="menuitem" onClick={run(() => setPriority(p))} className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-slate-50">
              <PriorityBadge priority={p} />
              {p === i.obj.priority && <Check size={13} className="text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, children, onClick, disabled, hint }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      <span className="text-slate-400">{icon}</span>
      {children}
    </button>
  )
}

/** Release on someone's behalf: pick the outcome and say why. */
function ReleaseModal({ item: i, me, users, onClose }: { item: WorkItem; me: User; users: User[]; onClose: () => void }) {
  const outcomes = i.step.outcomes
  const [outcomeId, setOutcomeId] = useState(outcomes.find((o) => !isRejectLike(o.label))?.id ?? outcomes[0]?.id ?? '')
  const [comment, setComment] = useState('')
  const holder = users.find((u) => u.id === i.token.userId)
  const outcome = outcomes.find((o) => o.id === outcomeId)
  const submit = () => {
    if (!perform((s, c) => superviseRelease(s, c, i.token.id, outcomeId, comment, me.id)).ok) return
    toast(`${i.obj.number} released as “${outcome?.label}”${holder ? ` on behalf of ${holder.name}` : ''}.`)
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title={`Release ${i.obj.number} on their behalf`}
      subtitle={holder ? `Instead of ${holder.name}, at “${i.step.label}”.` : `At “${i.step.label}”, without waiting for someone to pick it up.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={outcome && isRejectLike(outcome.label) ? 'danger' : 'primary'} disabled={!outcome || !comment.trim()} onClick={submit}>
            {outcome ? `Release as “${outcome.label}”` : 'Release'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Outcome" className="space-y-1">
          {outcomes.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={o.id === outcomeId}
              onClick={() => setOutcomeId(o.id)}
              className={cx(
                'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px]',
                o.id === outcomeId ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-slate-50',
              )}
            >
              <span className={cx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', o.id === outcomeId ? 'border-brand-600' : 'border-slate-300')}>
                {o.id === outcomeId && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
              </span>
              <span className={cx('font-medium', isRejectLike(o.label) ? 'text-rose-700' : 'text-slate-800')}>{o.label}</span>
            </button>
          ))}
        </div>
        <Field label="Comment" required hint="Say why you are releasing it. It goes in the history, and the next person sees it.">
          <Textarea autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Confirmed by phone while they are out" aria-label="Comment" />
        </Field>
      </div>
    </Modal>
  )
}
