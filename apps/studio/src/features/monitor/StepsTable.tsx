import { Cog, Shuffle } from 'lucide-react'
import { Fragment } from 'react'
import { DISTRIBUTION } from '../../components/icons'
import { Badge, cx, IconButton, Meter } from '../../components/ui'
import { adminRedistribute, type NodeMetrics, type SimView } from '@throughline/core/engine/engine'
import type { App, WfNode } from '@throughline/core/model/types'
import { formatDuration } from '@throughline/core/model/util'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

export const HEAT_DOT = ['bg-slate-300', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'] as const
export const HEAT_LABEL = ['Idle', 'Flowing', 'Building up', 'Backed up'] as const

type StepNode = Extract<WfNode, { type: 'user' | 'auto' }>

export function StepsTable({ app, view }: { app: App; view: SimView | undefined }) {
  const rows = app.workflows.map((wf) => ({
    wf,
    steps: wf.nodes.filter((n): n is StepNode => n.type === 'user' || n.type === 'auto'),
  }))
  const maxInStep = Math.max(1, ...rows.flatMap((r) => r.steps.map((s) => view?.nodes[s.id]?.total ?? 0)))
  const multi = app.workflows.length > 1

  const goTo = (workflowId: string, nodeId: string) => {
    const ui = useUi.getState()
    ui.setView('workflow')
    ui.setWorkflow(workflowId)
    ui.select({ kind: 'node', id: nodeId })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="py-2 pr-2 pl-4 font-semibold">Step</th>
            <th className="px-2 py-2 font-semibold">Distribution</th>
            <th className="w-[130px] px-2 py-2 font-semibold">In step</th>
            <th className="px-2 py-2 text-right font-semibold" title="Unassigned: in a queue or waiting for the supervisor">
              Waiting
            </th>
            <th className="px-2 py-2 text-right font-semibold">Assigned</th>
            <th className="px-2 py-2 text-right font-semibold">Working</th>
            <th className="px-2 py-2 text-right font-semibold" title="Average time from arrival until someone starts working">
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
                  <td colSpan={11} className="px-4 py-1.5 text-[11px] font-semibold text-slate-600">
                    {wf.name}
                  </td>
                </tr>
              )}
              {steps.map((node) => (
                <StepRow
                  key={node.id}
                  node={node}
                  m={view?.nodes[node.id]}
                  max={maxInStep}
                  bottleneck={view?.bottleneckId === node.id}
                  onOpen={() => goTo(wf.id, node.id)}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepRow({ node, m, max, bottleneck, onOpen }: { node: StepNode; m: NodeMetrics | undefined; max: number; bottleneck: boolean; onOpen: () => void }) {
  const heat = m?.heat ?? 0
  const isUser = node.type === 'user'
  const dist = isUser ? DISTRIBUTION[node.data.distribution] : undefined
  const DistIcon = dist?.icon ?? Cog
  const movable = (m?.assigned ?? 0) + (m?.unassigned ?? 0)
  const canRebalance = isUser && movable > 0 && (m?.availableMembers ?? 0) > 0

  const rebalance = (e: React.MouseEvent) => {
    e.stopPropagation()
    const moved = useSim.getState().act((sim, ctx) => adminRedistribute(sim, ctx, node.id))
    useUi
      .getState()
      .toast(moved ? `Redistributed ${moved} item${moved === 1 ? '' : 's'} at “${node.data.label}” evenly across available members.` : `“${node.data.label}” is already evenly balanced.`, moved ? 'success' : 'info')
  }

  return (
    <tr onClick={onOpen} className={cx('cursor-pointer border-b border-slate-100 tabular-nums last:border-0 hover:bg-slate-50', bottleneck && 'bg-rose-50/40')}>
      <td className="py-2 pr-2 pl-4">
        <div className="flex items-center gap-2">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', HEAT_DOT[heat])} title={HEAT_LABEL[heat]} />
          <span className="font-medium text-slate-800">{node.data.label}</span>
          {bottleneck && <Badge tone="red">Bottleneck</Badge>}
          {(m?.stuck ?? 0) > 0 && <Badge tone="red">{m!.stuck} stuck</Badge>}
        </div>
      </td>
      <td className="px-2 py-2 text-slate-600">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <DistIcon size={13} className={isUser ? 'text-sky-600' : 'text-violet-600'} />
          {dist?.short ?? 'Automated'}
        </span>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <span className="w-7 text-right font-semibold text-slate-900">{m?.total ?? 0}</span>
          <Meter value={m?.total ?? 0} max={max} className="flex-1" color={heat >= 3 ? '#e11d48' : heat === 2 ? '#d97706' : undefined} />
        </div>
      </td>
      <td className="px-2 py-2 text-right text-slate-700">{isUser ? (m?.unassigned ?? 0) : '—'}</td>
      <td className="px-2 py-2 text-right text-slate-700">{isUser ? (m?.assigned ?? 0) : '—'}</td>
      <td className="px-2 py-2 text-right text-slate-700">{isUser ? (m?.working ?? 0) : (m?.automated ?? 0)}</td>
      <td className="px-2 py-2 text-right text-slate-600">{isUser ? formatDuration(m?.avgWait ?? 0) : '—'}</td>
      <td className="px-2 py-2 text-right text-slate-600">{formatDuration(m?.avgTime ?? 0)}</td>
      <td className={cx('px-2 py-2 text-right', (m?.slaBreaches ?? 0) > 0 ? 'font-medium text-rose-600' : 'text-slate-600')}>{formatDuration(m?.oldestAge ?? 0)}</td>
      <td className="px-2 py-2 text-right">
        {isUser && node.data.slaHours ? (
          (m?.slaBreaches ?? 0) > 0 ? (
            <Badge tone="red">{m!.slaBreaches} late</Badge>
          ) : (
            <span className="text-slate-400">{node.data.slaHours}h</span>
          )
        ) : (
          <span className="text-slate-300">—</span>
        )}
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
