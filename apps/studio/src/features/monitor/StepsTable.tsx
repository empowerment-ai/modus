import { Bot, type LucideIcon, Merge, Shuffle, Timer, Workflow as WorkflowIcon, Zap } from 'lucide-react'
import { Fragment } from 'react'
import { DISTRIBUTION } from '../../components/icons'
import { Badge, cx, IconButton, Meter } from '../../components/ui'
import { adminRedistribute, type NodeMetrics, type SimView } from '@modus-bpm/core'
import type { App, Id, ServiceDef, WfNode } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { openStep } from './bottleneck'

export const HEAT_DOT = ['bg-slate-300', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'] as const
export const HEAT_LABEL = ['Idle', 'Flowing', 'Building up', 'Backed up'] as const

// Every step that can hold work. Decisions, splits, starts and ends pass items straight through.
type StepNode = Extract<WfNode, { type: 'user' | 'auto' | 'subflow' | 'join' | 'wait' }>
const HOLDS = new Set(['user', 'auto', 'subflow', 'join', 'wait'])

/** `expedited`: expedited items at each step right now, by step id. */
export function StepsTable({ app, view, services, expedited }: { app: App; view: SimView | undefined; services: ServiceDef[]; expedited?: Record<Id, number> }) {
  const rows = app.workflows.map((wf) => ({ wf, steps: wf.nodes.filter((n): n is StepNode => HOLDS.has(n.type)) })).filter((r) => r.steps.length)
  const maxInStep = Math.max(1, ...rows.flatMap((r) => r.steps.map((s) => view?.nodes[s.id]?.total ?? 0)))
  const multi = rows.length > 1

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="py-2 pr-2 pl-4 font-semibold">Step</th>
            <th className="px-2 py-2 font-semibold">How it works</th>
            <th className="w-[130px] px-2 py-2 font-semibold">In step</th>
            <th
              className="px-2 py-2 text-right font-semibold"
              title="People steps: in a queue or waiting to be handed out. Automated: waiting for a service slot. Joins: branches waiting for the others. Timers: waiting."
            >
              Waiting
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="In someone's basket, not started">
              Assigned
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="People working on it, automated calls in flight, or items running inside a subflow">
              Active
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="Automated steps being done by a person because automation failed">
              By hand
            </th>
            <th className="px-2 py-2 text-right font-semibold" title="Average time from arrival until work starts">
              Avg wait
            </th>
            <th className="px-2 py-2 text-right font-semibold">Avg in step</th>
            <th className="px-2 py-2 text-right font-semibold">Oldest</th>
            <th className="px-2 py-2 text-right font-semibold" title="Items older than the step's SLA">
              SLA
            </th>
            <th className="w-10 py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ wf, steps }) => (
            <Fragment key={wf.id}>
              {multi && (
                <tr className="bg-slate-50/70">
                  <td colSpan={12} className="px-4 py-1.5 text-[11px] font-semibold text-slate-600">
                    {wf.name}
                    {wf.kind === 'subflow' && <span className="ml-1.5 font-normal text-slate-400">subflow</span>}
                  </td>
                </tr>
              )}
              {steps.map((node) => (
                <StepRow
                  key={node.id}
                  app={app}
                  node={node}
                  m={view?.nodes[node.id]}
                  max={maxInStep}
                  bottleneck={view?.bottleneckId === node.id}
                  expedited={expedited?.[node.id] ?? 0}
                  services={services}
                  onOpen={() => openStep(app, wf.id, node.id)}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** How a step handles its work, as an icon and a few words. */
function kindOf(app: App, node: StepNode, services: ServiceDef[]): { icon: LucideIcon; text: string; color: string } {
  switch (node.type) {
    case 'user': {
      const dist = DISTRIBUTION[node.data.distribution]
      return { icon: dist.icon, text: dist.short, color: 'text-sky-600' }
    }
    case 'auto':
      return { icon: Bot, text: services.find((s) => s.id === node.data.serviceId)?.name ?? 'Automated', color: 'text-violet-600' }
    case 'subflow':
      return { icon: WorkflowIcon, text: `Runs ${app.workflows.find((w) => w.id === node.data.workflowId)?.name ?? 'a subflow'}`, color: 'text-indigo-600' }
    case 'join':
      return { icon: Merge, text: node.data.mode === 'all' ? 'Join · waits for all' : node.data.mode === 'any' ? 'Join · first wins' : `Join · first ${node.data.count ?? 1}`, color: 'text-slate-500' }
    case 'wait':
      return { icon: Timer, text: `Timer · ${formatDuration(node.data.minutes)}`, color: 'text-slate-500' }
  }
}

const dash = <span className="text-slate-300">—</span>

function StepRow({
  app,
  node,
  m,
  max,
  bottleneck,
  expedited,
  services,
  onOpen,
}: {
  app: App
  node: StepNode
  m: NodeMetrics | undefined
  max: number
  bottleneck: boolean
  expedited: number
  services: ServiceDef[]
  onOpen: () => void
}) {
  const heat = m?.heat ?? 0
  const kind = kindOf(app, node, services)
  const KindIcon = kind.icon
  const isUser = node.type === 'user'
  const isAuto = node.type === 'auto'
  const movable = (m?.assigned ?? 0) + (m?.unassigned ?? 0)
  const canRebalance = isUser && movable > 0 && (m?.availableMembers ?? 0) > 0

  const waiting = isUser ? (m?.unassigned ?? 0) : isAuto ? (m?.queued ?? 0) : node.type === 'join' ? (m?.joining ?? 0) : node.type === 'wait' ? (m?.waiting ?? 0) : undefined
  const active = isUser ? (m?.working ?? 0) : isAuto ? (m?.automated ?? 0) : node.type === 'subflow' ? (m?.inside ?? 0) : undefined
  const timed = isUser || isAuto

  const rebalance = (e: React.MouseEvent) => {
    e.stopPropagation()
    const moved = useSim.getState().act((sim, ctx) => adminRedistribute(sim, ctx, node.id))
    useUi
      .getState()
      .toast(
        moved ? `Redistributed ${moved} item${moved === 1 ? '' : 's'} at “${node.data.label}” evenly across available members.` : `“${node.data.label}” is already evenly balanced.`,
        moved ? 'success' : 'info',
      )
  }

  return (
    <tr onClick={onOpen} className={cx('cursor-pointer border-b border-slate-100 tabular-nums last:border-0 hover:bg-slate-50', bottleneck && 'bg-rose-50/40')}>
      <td className="py-2 pr-2 pl-4">
        <div className="flex items-center gap-2">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', HEAT_DOT[heat])} title={HEAT_LABEL[heat]} />
          <span className="font-medium text-slate-800">{node.data.label}</span>
          {expedited > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-orange-50 px-1 text-[10px] font-semibold text-orange-700" title={`${expedited} expedited here`}>
              <Zap size={10} fill="currentColor" />
              {expedited}
            </span>
          )}
          {bottleneck && <Badge tone="red">Bottleneck</Badge>}
          {(m?.stuck ?? 0) > 0 && <Badge tone="red">{m!.stuck} stuck</Badge>}
        </div>
      </td>
      <td className="max-w-[200px] px-2 py-2 text-slate-600">
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={kind.text}>
          <KindIcon size={13} className={cx('shrink-0', kind.color)} />
          <span className="truncate">{kind.text}</span>
        </span>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <span className="w-7 text-right font-semibold text-slate-900">{m?.total ?? 0}</span>
          <Meter value={m?.total ?? 0} max={max} className="flex-1" color={heat >= 3 ? '#e11d48' : heat === 2 ? '#d97706' : undefined} />
        </div>
      </td>
      <td className={cx('px-2 py-2 text-right', isAuto && (waiting ?? 0) > 0 ? 'font-medium text-amber-700' : 'text-slate-700')}>{waiting ?? dash}</td>
      <td className="px-2 py-2 text-right text-slate-700">{isUser ? (m?.assigned ?? 0) : dash}</td>
      <td className="px-2 py-2 text-right text-slate-700">{active ?? dash}</td>
      <td className={cx('px-2 py-2 text-right', (m?.manual ?? 0) > 0 ? 'font-medium text-amber-700' : 'text-slate-700')}>{isAuto ? (m?.manual ?? 0) : dash}</td>
      <td className="px-2 py-2 text-right text-slate-600">{timed ? formatDuration(m?.avgWait ?? 0) : dash}</td>
      <td className="px-2 py-2 text-right text-slate-600">{formatDuration(m?.avgTime ?? 0)}</td>
      <td className={cx('px-2 py-2 text-right', (m?.slaBreaches ?? 0) > 0 ? 'font-medium text-rose-600' : 'text-slate-600')}>{formatDuration(m?.oldestAge ?? 0)}</td>
      <td className="px-2 py-2 text-right">
        {isUser && node.data.slaHours ? (m?.slaBreaches ?? 0) > 0 ? <Badge tone="red">{m!.slaBreaches} late</Badge> : <span className="text-slate-400">{node.data.slaHours}h</span> : dash}
      </td>
      <td className="py-2 pr-3 text-right">
        {canRebalance && (
          <IconButton label="Redistribute waiting and assigned work evenly" onClick={rebalance}>
            <Shuffle size={14} />
          </IconButton>
        )}
      </td>
    </tr>
  )
}
