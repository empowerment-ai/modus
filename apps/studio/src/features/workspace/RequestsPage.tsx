import { ArrowLeft, ArrowRight, Check, FileText, Inbox, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FormRenderer } from '../../components/FormRenderer'
import { TypeIcon } from '../../components/icons'
import { Badge, Button, Card, cx, EmptyState, IconButton, Segmented } from '../../components/ui'
import { canExpedite, type Ctx, describeToken, fieldAccessMap, type RequestSummary, type SimObject, type SimState, workSetPriority } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, Group, Id, Priority, User, WfNode } from '@modus-bpm/core/model/types'
import { formatClock, formatDuration } from '@modus-bpm/core/model/util'
import { useUi } from '../../store/ui'
import { ObjectHistory } from '../objects/ObjectHistory'
import { ExpeditedBadge, PriorityBadge } from '../objects/PriorityBadge'
import { ExpediteAction, ExpediteNote } from './Expedite'
import { agoText } from './format'
import { perform, type WorkData } from './live'
import { DueLabel, PageHeader, PriorityMenu, STATUS, titleHidden } from './parts'
import { useWorkspace } from './store'

type Show = 'open' | 'closed' | 'all'

const ROW_LIMIT = 150

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

/** Items you created: where each one is now, and how it ended. */
export function RequestsPage(props: Props) {
  const { me, app, ctx, users, sim, data } = props
  const requestId = useWorkspace((s) => s.requestId)
  const [show, setShow] = useState<Show>('open')
  const { requests, clock } = data
  const counts = useMemo(() => ({ open: requests.filter((r) => r.obj.status === 'active').length, all: requests.length }), [requests])
  const rows = useMemo(() => requests.filter((r) => (show === 'all' ? true : show === 'open' ? r.obj.status === 'active' : r.obj.status !== 'active')), [requests, show])

  const obj = requestId ? sim?.objects[requestId] : undefined
  if (obj && sim) return <ItemReadView {...props} sim={sim} obj={obj} crumb={obj.createdBy === me.id ? 'My requests' : 'Following'} onBack={() => useWorkspace.getState().openRequest(null)} />

  const typeOf = (o: SimObject) => app.objectTypes.find((t) => t.id === o.typeId)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-4 px-6 py-6">
        <PageHeader
          title="My requests"
          subtitle="Everything you started, where it is now, and how it ended."
          actions={
            <>
              <Segmented
                value={show}
                onChange={setShow}
                options={[
                  { value: 'open', label: `Open · ${counts.open}` },
                  { value: 'closed', label: `Closed · ${counts.all - counts.open}` },
                  { value: 'all', label: 'All' },
                ]}
              />
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => useWorkspace.getState().go('new')}>
                New request
              </Button>
            </>
          }
        />
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<FileText size={26} />} title={requests.length ? `No ${show === 'open' ? 'open' : 'closed'} requests` : 'You haven’t started anything yet'}>
              {requests.length
                ? 'Switch the filter to see the rest.'
                : 'Use New request to start one. Every item you create shows up here so you can follow it to the end, and you can expedite it if it becomes a rush. (While you work as someone, the simulation doesn’t create items for them.)'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="py-2 pr-2 pl-4 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Number</th>
                    <th className="px-2 py-2 font-semibold">Title</th>
                    <th className="px-2 py-2 font-semibold">Where it is now</th>
                    <th className="px-2 py-2 font-semibold">Due</th>
                    <th className="px-2 py-2 text-right font-semibold">Created</th>
                    <th className="py-2 pr-4 pl-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, ROW_LIMIT).map((r) => (
                    <RequestRow key={r.obj.id} r={r} title={objectTitle(typeOf(r.obj), r.obj.data, app.lists, users)} sim={sim} ctx={ctx} clock={clock} users={users} me={me} />
                  ))}
                </tbody>
              </table>
              {rows.length > ROW_LIMIT && (
                <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
                  Showing the newest {ROW_LIMIT} of {rows.length.toLocaleString()}.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function RequestRow({ r, title, sim, ctx, clock, users, me }: { r: RequestSummary; title: string; sim?: SimState; ctx: Ctx; clock: number; users: User[]; me: User }) {
  const s = STATUS[r.obj.status]
  const who = (id?: Id) => (id === me.id ? 'you' : users.find((u) => u.id === id)?.name)
  return (
    <tr onClick={() => useWorkspace.getState().openRequest(r.obj.id)} className="cursor-pointer border-b border-slate-100 align-top last:border-0 hover:bg-slate-50">
      <td className="py-2 pr-2 pl-4">
        <Badge tone={s.tone}>{s.label}</Badge>
      </td>
      <td className="px-2 py-2">
        <span className="font-mono text-[11px] font-medium text-brand-700">{r.obj.number}</span>
      </td>
      <td className="max-w-[240px] px-2 py-2">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-slate-900">{title || 'Untitled'}</span>
          <PriorityBadge priority={r.obj.priority} expedited={!!r.obj.expedite} reason={r.obj.expedite?.reason} quietNormal />
        </span>
      </td>
      <td className="px-2 py-2 text-slate-700">
        {r.obj.status === 'active' && sim ? (
          <ul className="space-y-0.5">
            {r.obj.tokens.map((t, n) => (
              <li key={t.id} className="flex gap-1.5">
                <span className="font-medium text-slate-800">{r.where[n]?.label}</span>
                <span className="text-slate-500">
                  ·{' '}
                  {t.userId && (t.state === 'assigned' || t.state === 'working') ? (t.state === 'working' ? `${who(t.userId)} is working on it` : `with ${who(t.userId)}`) : describeToken(sim, ctx, t)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-slate-500">Ended {r.obj.completedAt !== undefined ? agoText(clock - r.obj.completedAt) : ''}</span>
        )}
      </td>
      <td className="px-2 py-2">{r.obj.status === 'active' ? <DueLabel due={r.due} clock={clock} /> : <span className="text-slate-400">—</span>}</td>
      <td className="px-2 py-2 text-right whitespace-nowrap text-slate-500 tabular-nums" title={formatClock(r.obj.createdAt)}>
        {agoText(clock - r.obj.createdAt)}
      </td>
      <td className="py-1.5 pr-4 pl-2 text-right" onClick={(e) => e.stopPropagation()}>
        {sim && !r.obj.expedite && <ExpediteAction obj={r.obj} me={me} sim={sim} ctx={ctx} size="sm" />}
      </td>
    </tr>
  )
}

/** Read-only view of an item you follow or found: progress, where it is, the form and its history. */
export function ItemReadView({
  me,
  app,
  ctx,
  users,
  groups,
  sim,
  obj,
  crumb,
  onBack,
}: Pick<Props, 'me' | 'app' | 'ctx' | 'users' | 'groups'> & { sim: SimState; obj: SimObject; crumb: string; onBack: () => void }) {
  const [tab, setTab] = useState<'details' | 'history'>('details')
  const type = app.objectTypes.find((t) => t.id === obj.typeId)
  const wf = app.workflows.find((w) => w.id === obj.workflowId)
  const nodes = useMemo(() => {
    const m = new Map<Id, WfNode>()
    for (const w of app.workflows) for (const n of w.nodes) m.set(n.id, n)
    return m
  }, [app.workflows])
  if (!type) return null
  // Fields you may not see stay hidden; administrators see everything (but nothing is editable here).
  const access = fieldAccessMap({ type, wf, passed: obj.passed, userId: me.id, groups, admin: me.roles?.includes('admin') })
  const s = STATUS[obj.status]
  const clock = sim.clock
  const title = titleHidden(ctx, obj, me.id) ? '' : objectTitle(type, obj.data, app.lists, users)
  const mine = obj.createdBy === me.id
  const working = obj.tokens.some((t) => t.userId === me.id)
  const held = obj.tokens.find((t) => t.userId === me.id && (t.state === 'assigned' || t.state === 'working'))
  const canPrioritize = obj.status === 'active' && (mine || working)
  const expeditable = canExpedite(sim, ctx, obj.id, me.id)

  const setPriority = (p: Priority) => {
    if (perform((sm, c) => workSetPriority(sm, c, obj.id, me.id, p)).ok) useUi.getState().toast(`${obj.number} is now ${p} priority.`, 'success')
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="flex h-11 items-center gap-2 border-b border-slate-200 px-3">
        <IconButton label={`Back to ${crumb === 'Following' ? 'my requests' : crumb.toLowerCase()}`} onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="text-xs text-slate-500">
          {crumb} <span aria-hidden>›</span> <span className="font-mono font-medium text-slate-700">{obj.number}</span>
        </span>
        <div className="flex-1" />
        <ExpediteAction obj={obj} me={me} sim={sim} ctx={ctx} size="sm" />
      </div>
      <div className="mx-auto max-w-[880px] px-6 pt-5 pb-10">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="flex h-5 w-5 items-center justify-center rounded" style={{ background: `${type.color}1a`, color: type.color }}>
            <TypeIcon name={type.icon} size={12} />
          </span>
          <span className="font-mono font-medium text-slate-700">{obj.number}</span>
          <span aria-hidden>·</span>
          <span>
            {mine ? 'You created it' : `Created by ${users.find((u) => u.id === obj.createdBy)?.name ?? obj.createdBy}`} {agoText(clock - obj.createdAt)}
          </span>
        </div>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">{title || `${type.name} ${obj.number}`}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={s.tone}>{s.label}</Badge>
          {obj.expedite && obj.status === 'active' && <ExpeditedBadge reason={obj.expedite.reason} />}
          <PriorityMenu priority={obj.priority} onChange={setPriority} disabled={!canPrioritize} />
          {obj.status === 'active' && obj.dueBy !== undefined && (
            <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px]">
              <DueLabel due={obj.dueBy} clock={clock} />
            </span>
          )}
          {obj.status !== 'active' && obj.completedAt !== undefined && (
            <span className="text-[11px] text-slate-500">
              Took {formatDuration(obj.completedAt - obj.createdAt)}, ended {agoText(clock - obj.completedAt)}
            </span>
          )}
          {canPrioritize && !obj.expedite && (
            <span className="text-[11px] text-slate-400">{expeditable ? 'If it has become a rush, raise its priority or expedite it.' : 'You can raise its priority if it has become urgent.'}</span>
          )}
        </div>
        {obj.status === 'active' && <ExpediteNote obj={obj} clock={clock} className="mt-2" />}

        {held && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3.5 py-2.5 text-[13px] text-sky-900">
            <Inbox size={15} className="shrink-0 text-sky-600" />
            <span className="min-w-0 flex-1">It’s in your basket. Open it in My work to fill it in and release it.</span>
            <Button size="sm" variant="primary" icon={<ArrowRight size={13} />} onClick={() => useWorkspace.getState().openItem(held.id)}>
              Open in My work
            </Button>
          </div>
        )}

        <Card className="mt-4 p-4">
          <Journey obj={obj} nodes={nodes} sim={sim} ctx={ctx} />
        </Card>

        <div className="mt-5 flex gap-4 border-b border-slate-200" role="tablist">
          {(['details', 'history'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx(
                '-mb-px border-b-2 px-0.5 pb-2 text-[13px] font-medium capitalize',
                tab === t ? 'border-brand-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {tab === 'details' ? (
            <Card className="p-4">
              <FormRenderer type={type} lists={app.lists} users={users} values={obj.data} access={access} includeSystem />
            </Card>
          ) : (
            <ObjectHistory obj={obj} app={app} />
          )}
        </div>
      </div>
    </div>
  )
}

const SHOWN = new Set(['user', 'auto', 'subflow'])

/** A simple progress tracker: the steps it has been through, where it is now, and the end. */
function Journey({ obj, nodes, sim, ctx }: { obj: SimObject; nodes: Map<Id, WfNode>; sim: SimState; ctx: Ctx }) {
  const done = obj.passed.filter((id) => SHOWN.has(nodes.get(id)?.type ?? '') && !obj.tokens.some((t) => t.nodeId === id))
  const hidden = Math.max(0, done.length - 5)
  const ended = obj.status !== 'active'
  const endLabel = obj.endNodeId ? nodes.get(obj.endNodeId)?.data.label : undefined
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Progress</h3>
      <ol className="flex flex-wrap items-start gap-y-3">
        <Stop label="Submitted" state="done" />
        {hidden > 0 && <Stop label={`${hidden} earlier ${hidden === 1 ? 'step' : 'steps'}`} state="done" />}
        {done.slice(hidden).map((id, i) => (
          <Stop key={`${id}-${i}`} label={nodes.get(id)?.data.label ?? 'Removed step'} state="done" />
        ))}
        {obj.tokens.map((t) => (
          <Stop key={t.id} label={nodes.get(t.nodeId)?.data.label ?? 'Removed step'} detail={describeToken(sim, ctx, t)} state="now" />
        ))}
        <Stop label={ended ? (endLabel ?? STATUS[obj.status].label) : 'Done'} state={ended ? (obj.status === 'completed' ? 'done' : 'stopped') : 'todo'} last />
      </ol>
    </div>
  )
}

function Stop({ label, detail, state, last }: { label: string; detail?: string; state: 'done' | 'now' | 'todo' | 'stopped'; last?: boolean }) {
  return (
    <li className="flex items-start">
      <div className="flex w-[118px] flex-col items-center px-1 text-center">
        <span
          className={cx(
            'flex h-6 w-6 items-center justify-center rounded-full border-2',
            state === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
            state === 'now' && 'border-brand-500 bg-brand-50',
            state === 'todo' && 'border-slate-200 bg-white',
            state === 'stopped' && 'border-rose-500 bg-rose-500 text-white',
          )}
        >
          {state === 'done' && <Check size={13} strokeWidth={3} />}
          {state === 'now' && <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />}
          {state === 'stopped' && <span className="h-0.5 w-2.5 rounded bg-white" />}
        </span>
        <span className={cx('mt-1.5 text-[11.5px] leading-tight', state === 'now' ? 'font-semibold text-slate-900' : state === 'todo' ? 'text-slate-400' : 'text-slate-700')}>{label}</span>
        {detail && <span className="mt-0.5 text-[10.5px] leading-tight text-slate-500">{detail}</span>}
      </div>
      {!last && <span className={cx('mt-3 h-0.5 w-5 shrink-0 rounded', state === 'done' ? 'bg-emerald-300' : 'bg-slate-200')} aria-hidden />}
    </li>
  )
}
