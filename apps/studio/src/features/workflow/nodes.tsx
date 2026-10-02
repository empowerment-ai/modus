import { Handle, type NodeProps, Position } from '@xyflow/react'
import { Ban, Bot, CircleCheck, CircleX, GitFork, Play, TriangleAlert, UserRound } from 'lucide-react'
import { memo } from 'react'
import { cx } from '../../components/ui'
import { DISTRIBUTION } from '../../components/icons'
import type { NodeMetrics } from '@throughline/core/engine/engine'
import type { Group, User, WfNode } from '@throughline/core/model/types'
import { formatDuration } from '@throughline/core/model/util'
import { useApp, useDesign } from '../../store/design'
import { useSim, useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'

export type FlowNodeData = { node: WfNode; workflowId: string }

const HEAT_RING = ['', '', 'ring-2 ring-amber-300', 'ring-2 ring-rose-400']
const HEAT_BADGE = [
  'bg-slate-100 text-slate-400',
  'bg-brand-600 text-white',
  'bg-amber-500 text-white',
  'bg-rose-600 text-white',
]

function Handles() {
  return (
    <>
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="l" type="source" position={Position.Left} />
    </>
  )
}

function useMetrics(id: string): NodeMetrics | undefined {
  return useSimView()?.nodes[id]
}

function CountBadge({ value, heat, title, className }: { value: number; heat: number; title?: string; className?: string }) {
  return (
    <span
      key={value}
      title={title}
      className={cx(
        'count-pop inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-[13px] font-bold tabular-nums shadow-sm',
        HEAT_BADGE[value === 0 ? 0 : Math.max(1, heat)],
        className,
      )}
    >
      {value}
    </span>
  )
}

function Bottleneck({ id }: { id: string }) {
  const isBottleneck = useSimView()?.bottleneckId === id
  if (!isBottleneck) return null
  return (
    <span className="bottleneck-pulse absolute -top-2.5 left-3 z-10 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
      <TriangleAlert size={10} strokeWidth={2.5} /> Bottleneck
    </span>
  )
}

// ---------- Start ----------

export const StartNode = memo(function StartNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const wf = app?.workflows.find((w) => w.id === data.workflowId)
  const type = app?.objectTypes.find((t) => t.id === wf?.objectTypeId)
  const m = useMetrics(id)
  return (
    <div className={cx('flex w-[184px] items-center gap-2.5 rounded-full border bg-white py-2 pr-2 pl-2 shadow-sm', selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-emerald-300')}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Play size={14} fill="currentColor" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="line-clamp-2 text-[12.5px] font-semibold text-slate-900">{data.node.data.label}</div>
        <div className="truncate text-[10.5px] text-slate-500">On create · {type?.name ?? '—'}</div>
      </div>
      {(m?.entered ?? 0) > 0 && (
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums" title="Created so far">
          {m!.entered}
        </span>
      )}
      <Handles />
    </div>
  )
})

// ---------- End ----------

export const EndNode = memo(function EndNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const node = data.node
  const m = useMetrics(id)
  if (node.type !== 'end') return null
  const result = node.data.result
  const Icon = result === 'completed' ? CircleCheck : result === 'rejected' ? CircleX : Ban
  const tone = result === 'completed' ? 'bg-emerald-600' : result === 'rejected' ? 'bg-rose-600' : 'bg-slate-500'
  const border = result === 'completed' ? 'border-emerald-300' : result === 'rejected' ? 'border-rose-300' : 'border-slate-300'
  return (
    <div className={cx('flex w-[156px] items-center gap-2.5 rounded-full border bg-white py-2 pr-2 pl-2 shadow-sm', selected ? 'border-brand-500 ring-2 ring-brand-200' : border)}>
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white', tone)}>
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="line-clamp-2 text-[12.5px] font-semibold text-slate-900">{node.data.label}</div>
        <div className="text-[10.5px] text-slate-500 capitalize">{result}</div>
      </div>
      <span key={m?.entered ?? 0} className="count-pop rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 tabular-nums" title="Finished here">
        {m?.entered ?? 0}
      </span>
      <Handles />
    </div>
  )
})

// ---------- Decision ----------

export const DecisionNode = memo(function DecisionNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const m = useMetrics(id)
  const stuck = m?.stuck ?? 0
  return (
    <div className="relative h-[120px] w-[120px]">
      <div
        className={cx(
          'absolute inset-[17px] rotate-45 rounded-[10px] border-2 bg-amber-50 shadow-sm',
          selected ? 'border-brand-500 ring-2 ring-brand-200' : stuck ? 'border-rose-500' : 'border-amber-400',
        )}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <GitFork size={14} className="mb-0.5 text-amber-600" />
        <span className="line-clamp-3 text-[11px] leading-tight font-semibold text-slate-800">{data.node.data.label}</span>
      </div>
      {stuck > 0 && <CountBadge value={stuck} heat={3} title={`${stuck} stuck: no rule matched`} className="absolute -top-1 -right-1" />}
      <Handles />
    </div>
  )
})

// ---------- Automated step ----------

export const AutoNode = memo(function AutoNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const node = data.node
  const m = useMetrics(id)
  if (node.type !== 'auto') return null
  const total = m?.total ?? 0
  return (
    <div className={cx('relative w-[228px] rounded-xl border bg-white shadow-sm', selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200', HEAT_RING[m?.heat ?? 0])}>
      <div className="flex items-center gap-2.5 p-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <Bot size={17} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="line-clamp-2 text-[12.5px] font-semibold text-slate-900">{node.data.label}</div>
          <div className="truncate text-[10.5px] text-slate-500">
            Automated · {node.data.actions.length} action{node.data.actions.length === 1 ? '' : 's'} · ~{node.data.avgMinutes}m
          </div>
        </div>
        <CountBadge value={total} heat={m?.stuck ? 3 : 1} title={`${total} being processed`} />
      </div>
      <Handles />
    </div>
  )
})

// ---------- User step ----------

export const UserNode = memo(function UserNode({ id, data, selected }: NodeProps & { data: FlowNodeData }) {
  const node = data.node
  const m = useMetrics(id)
  const groups = useDesign((s) => s.design.groups)
  const users = useDesign((s) => s.design.users)
  const started = useSim((s) => (s.views[useUi.getState().appId]?.clock ?? 0) > 0)
  if (node.type !== 'user') return null
  const d = node.data
  const dist = DISTRIBUTION[d.distribution]
  const DistIcon = dist.icon
  const group = groups.find((g) => g.id === d.groupId)
  const who = d.distribution === 'direct' ? (users.find((u) => u.id === d.userId)?.name ?? 'No one') : group ? `${group.name} (${group.memberIds.length})` : 'No group'
  const total = m?.total ?? 0

  return (
    <div className={cx('relative w-[258px] rounded-xl border bg-white shadow-sm', selected ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200', !selected && HEAT_RING[m?.heat ?? 0])}>
      <Bottleneck id={id} />
      <div className="flex items-start gap-2.5 p-2.5 pb-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          <UserRound size={17} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="line-clamp-2 text-[12.5px] font-semibold text-slate-900">{d.label}</div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-slate-500">
            <DistIcon size={11} className="shrink-0" />
            <span className="truncate">
              {dist.short} · {who}
            </span>
          </div>
        </div>
        <CountBadge value={total} heat={m?.heat ?? 0} title={`${total} at this step`} />
      </div>
      <div className="border-t border-slate-100 px-2.5 pt-1.5 pb-2">
        {started ? (
          <>
            <WorkloadStrip node={node} metrics={m} group={group} users={users} />
            <div className="mt-1 flex items-center gap-2 text-[10.5px] text-slate-500 tabular-nums">
              <span title={d.distribution === 'manager' ? 'Awaiting supervisor' : d.distribution === 'queue' ? 'Waiting in queue' : 'Unassigned'}>
                <b className="font-semibold text-slate-700">{m?.unassigned ?? 0}</b> {d.distribution === 'manager' ? 'to hand out' : 'waiting'}
              </span>
              <span>
                <b className="font-semibold text-slate-700">{m?.assigned ?? 0}</b> in baskets
              </span>
              <span>
                <b className="font-semibold text-slate-700">{m?.working ?? 0}</b> working
              </span>
              {(m?.oldestAge ?? 0) > 0 && <span className={cx('ml-auto', (m?.slaBreaches ?? 0) > 0 && 'font-semibold text-rose-600')}>{formatDuration(m!.oldestAge)}</span>}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-1">
            {d.outcomes.map((o) => (
              <span key={o.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">
                {o.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handles />
    </div>
  )
})

/** One small bar per person who can work the step: shows whether work is spread evenly. */
function WorkloadStrip({ node, metrics, group, users }: { node: Extract<WfNode, { type: 'user' }>; metrics?: NodeMetrics; group?: Group; users: User[] }) {
  const d = node.data
  const ids = d.distribution === 'direct' ? (d.userId ? [d.userId] : []) : (group?.memberIds ?? [])
  const people = ids.map((uid) => users.find((u) => u.id === uid)).filter((u): u is User => !!u)
  if (!people.length) return <div className="text-[10.5px] text-rose-600">No one can work this step</div>
  const loads = people.map((u) => metrics?.byUser[u.id] ?? { assigned: 0, working: 0 })
  const max = Math.max(4, ...loads.map((l) => l.assigned + l.working))
  return (
    <div className="flex h-[26px] items-end gap-[3px]" aria-label="Workload per person">
      {people.map((u, i) => {
        const l = loads[i]!
        const total = l.assigned + l.working
        const h = total === 0 ? 2 : 4 + (total / max) * 22
        return (
          <div
            key={u.id}
            title={`${u.name}${u.available ? '' : ' (out of office)'}: ${l.assigned} in basket, ${l.working} working`}
            className="flex min-w-[6px] flex-1 flex-col justify-end overflow-hidden rounded-[2px]"
            style={{ height: 26 }}
          >
            <div
              className="flex w-full flex-col justify-end overflow-hidden rounded-[2px] transition-[height] duration-300"
              style={{ height: h, background: u.available ? '#c7d2fe' : 'repeating-linear-gradient(45deg,#fde68a,#fde68a 2px,#fef3c7 2px,#fef3c7 4px)' }}
            >
              {l.working > 0 && <div className="w-full bg-brand-600" style={{ height: Math.max(3, (l.working / Math.max(1, total)) * h) }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  decision: DecisionNode,
  auto: AutoNode,
  user: UserNode,
}
