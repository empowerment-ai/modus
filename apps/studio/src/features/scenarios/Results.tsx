import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, CircleAlert, Info, Minus, Users, Wand2 } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { buildIndex, type Ctx, type NodeMetrics, type ScenarioKpis } from '@throughline/core'
import type { Id, WfNode } from '@throughline/core/model/types'
import { formatClock, formatDuration } from '@throughline/core/model/util'
import { Badge, Button, Card, cx, Modal } from '../../components/ui'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { CompareChart } from './CompareChart'
import { applyPlan, HOLDING, KPIS, type Tone } from './lab'
import { type Run, useLab } from './runs'

const TONE_BOX: Record<Tone, string> = {
  good: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
  bad: 'border-rose-200 bg-rose-50/70 text-rose-950',
  mixed: 'border-amber-200 bg-amber-50/70 text-amber-950',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
}
const TONE_ICON = { good: CheckCircle2, bad: CircleAlert, mixed: Info, neutral: Info }
const TONE_ICON_COLOR: Record<Tone, string> = { good: 'text-emerald-600', bad: 'text-rose-600', mixed: 'text-amber-600', neutral: 'text-slate-500' }

/** Everything about one finished run: verdict, KPIs, chart, steps, apply. */
export const Results = memo(function Results({ run, ctx }: { run: Run; ctx: Ctx }) {
  const idx = useMemo(() => buildIndex(ctx), [ctx])
  const v = run.verdict
  const { baseline: b, scenario: s } = run.result
  const Icon = TONE_ICON[v.tone]
  const label = (id?: Id) => (id ? (idx.node.get(id)?.node.data.label ?? 'A removed step') : undefined)

  return (
    <div className="space-y-4">
      <div className={cx('flex items-start gap-2.5 rounded-lg border px-4 py-3', TONE_BOX[v.tone])}>
        <Icon size={18} className={cx('mt-0.5 shrink-0', TONE_ICON_COLOR[v.tone])} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{v.text}</p>
          <p className="mt-0.5 text-[11px] opacity-75">
            {run.hours} simulated hours from {formatClock(run.from)}, same random numbers on both sides.
            {run.labels.length > 0 && ` Changes: ${run.labels.join(' · ')}.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {KPIS.map((k) => (
          <KpiCompare key={k.key} k={k} b={b[k.key] as number} s={s[k.key] as number} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-3">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Work in flight during the run</h3>
            <p className="truncate text-[11px] text-slate-500">Lower and flatter is better.</p>
          </div>
          <div className="px-4 pt-3 pb-3">
            <CompareChart baseline={b.series} scenario={s.series} />
          </div>
        </Card>
        <Card className="min-w-0 xl:col-span-2">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Bottleneck at the end</h3>
          </div>
          <div className="flex items-stretch gap-2 px-4 py-3">
            <BottleneckBox title="As designed" label={label(b.bottleneckId)} m={b.bottleneckId ? b.view.nodes[b.bottleneckId] : undefined} />
            <ArrowRight size={16} className="mt-7 shrink-0 text-slate-400" />
            <BottleneckBox title="With changes" label={label(s.bottleneckId)} m={s.bottleneckId ? s.view.nodes[s.bottleneckId] : undefined} highlight />
          </div>
          <ApplyPanel run={run} />
        </Card>
      </div>

      <StepDiff run={run} ctx={ctx} />
    </div>
  )
})

function delta(key: keyof ScenarioKpis, d: number): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : ''
  if (key === 'avgCycle') return `${sign}${formatDuration(Math.abs(d))}`
  if (key === 'throughputPerHour') return `${sign}${Math.abs(d).toFixed(1)}`
  return `${sign}${Math.abs(d).toLocaleString()}`
}

function KpiCompare({ k, b, s }: { k: (typeof KPIS)[number]; b: number; s: number }) {
  const d = s - b
  const eps = k.key === 'avgCycle' ? 1 : k.key === 'throughputPerHour' ? 0.05 : 0.5
  const same = Math.abs(d) < eps
  const good = !same && (k.better === 'up' ? d > 0 : d < 0)
  const Arrow = same ? Minus : d > 0 ? ArrowUp : ArrowDown
  return (
    <Card className="px-3.5 py-2.5">
      <div className="text-[10.5px] font-medium tracking-wide text-slate-500 uppercase" title={k.hint}>
        {k.label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold text-slate-900 tabular-nums">{k.format(s)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
        <span
          className={cx('inline-flex items-center gap-0.5 rounded px-1 py-px font-medium', same ? 'bg-slate-100 text-slate-700' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}
          title={same ? 'No meaningful change' : good ? 'Better' : 'Worse'}
        >
          <Arrow size={11} strokeWidth={2.5} />
          {same ? 'same' : delta(k.key, d)}
        </span>
        <span>was {k.format(b)}</span>
      </div>
    </Card>
  )
}

function BottleneckBox({ title, label, m, highlight }: { title: string; label?: string; m?: NodeMetrics; highlight?: boolean }) {
  return (
    <div className={cx('min-w-0 flex-1 rounded-md border px-3 py-2', highlight ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200 bg-slate-50/60')}>
      <div className="text-[10.5px] font-medium tracking-wide text-slate-500 uppercase">{title}</div>
      {label ? (
        <>
          <div className="mt-0.5 truncate text-sm font-semibold text-slate-900" title={label}>
            {label}
          </div>
          {m && (
            <div className="text-[11px] text-slate-500 tabular-nums">
              {m.total} in step{m.queued ? ` · ${m.queued} queued` : ''} · oldest {formatDuration(m.oldestAge)}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mt-0.5 text-sm font-semibold text-emerald-700">None</div>
          <div className="text-[11px] text-slate-500">Work is flowing.</div>
        </>
      )}
    </div>
  )
}

function ApplyPanel({ run }: { run: Run }) {
  const design = useDesign((s) => s.design)
  const [confirming, setConfirming] = useState(false)
  const plan = useMemo(() => applyPlan(design, run.appId, run.changes), [design, run])
  if (!run.changes.length) return null

  const apply = () => {
    plan.apply()
    useLab.getState().markApplied(run.id)
    setConfirming(false)
    useUi.getState().toast(`Applied ${plan.edits.length} change${plan.edits.length === 1 ? '' : 's'} to the live design. The simulation follows it from now on.`, 'success')
  }

  return (
    <div className="space-y-2 border-t border-slate-200 px-4 py-3">
      {run.applied ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 size={14} /> Applied to the live design.
        </p>
      ) : plan.edits.length > 0 ? (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" icon={<Wand2 size={13} />} onClick={() => setConfirming(true)}>
            Apply to the live design
          </Button>
          <span className="text-[11px] text-slate-500">
            {plan.edits.length} design edit{plan.edits.length === 1 ? '' : 's'}; you’ll see the list first.
          </span>
        </div>
      ) : (
        !plan.manual.length && <p className="text-xs text-slate-500">The live design already matches this run.</p>
      )}
      {plan.manual.map((m) => (
        <div key={m.groupId} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <Users size={13} className="shrink-0 text-slate-400" />
          <span>
            {m.text} in People &amp; Security. <span className="text-slate-400">People are real, so this one can’t be applied for you.</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => useUi.getState().setView('org')}>
            Open People &amp; Security
          </Button>
        </div>
      ))}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Apply to the live design?"
        subtitle="These edits change the design every simulated (and, later, real) item follows from now on. You can change them back by hand."
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={apply}>
              Apply {plan.edits.length} edit{plan.edits.length === 1 ? '' : 's'}
            </Button>
          </>
        }
      >
        <ul className="space-y-1.5 text-sm text-slate-700">
          {plan.edits.map((e) => (
            <li key={e} className="flex items-start gap-2">
              <ArrowRight size={14} className="mt-0.5 shrink-0 text-brand-600" />
              {e}
            </li>
          ))}
        </ul>
        {plan.manual.length > 0 && (
          <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">Not included: {plan.manual.map((m) => m.text.toLowerCase()).join('; ')}. Do that in People &amp; Security.</p>
        )}
      </Modal>
    </div>
  )
}

/** Waiting at a step, in that step's own terms. */
function waitingOf(type: WfNode['type'], m?: NodeMetrics): number | undefined {
  if (!m) return 0
  switch (type) {
    case 'user':
      return m.unassigned
    case 'auto':
      return m.queued
    case 'join':
      return m.joining
    case 'wait':
      return m.waiting
    default:
      return undefined
  }
}

function StepDiff({ run, ctx }: { run: Run; ctx: Ctx }) {
  const { baseline: b, scenario: s } = run.result
  const multi = ctx.app.workflows.length > 1
  const rows = ctx.app.workflows
    .flatMap((wf) => wf.nodes.filter((n) => HOLDING.has(n.type)).map((node) => ({ wf, node, mb: b.view.nodes[node.id], ms: s.view.nodes[node.id] })))
    .map((r) => ({ ...r, d: (r.ms?.total ?? 0) - (r.mb?.total ?? 0) }))
    .filter((r) => (r.mb?.total ?? 0) + (r.ms?.total ?? 0) > 0)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || (y.mb?.total ?? 0) - (x.mb?.total ?? 0))
    .slice(0, 10)

  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">Where it changed</h3>
        <p className="truncate text-[11px] text-slate-500">Steps with the biggest difference in work at the end of the run.</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-slate-500">No work at any step at the end of either run.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="py-2 pr-2 pl-4">Step</th>
                <th className="px-2 py-2 text-right">In step · as designed</th>
                <th className="px-2 py-2 text-right">With changes</th>
                <th className="px-2 py-2 text-right">Difference</th>
                <th className="px-2 py-2 text-right" title="Waiting for a person, a service slot, other branches or a timer">
                  Waiting
                </th>
                <th className="py-2 pr-4 pl-2 text-right" title="Average time from arrival until work starts (whole simulation)">
                  Avg wait
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ wf, node, mb, ms, d }) => {
                const wb = waitingOf(node.type, mb)
                const ws = waitingOf(node.type, ms)
                return (
                  <tr key={node.id} className="border-b border-slate-100 tabular-nums last:border-0">
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{node.data.label}</span>
                        {multi && <span className="text-[11px] text-slate-400">{wf.name}</span>}
                        {b.bottleneckId === node.id && <Badge tone="slate">Bottleneck before</Badge>}
                        {s.bottleneckId === node.id && <Badge tone="red">Bottleneck after</Badge>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-600">{mb?.total ?? 0}</td>
                    <td className="px-2 py-2 text-right font-semibold text-slate-900">{ms?.total ?? 0}</td>
                    <td className={cx('px-2 py-2 text-right font-medium', d < 0 ? 'text-emerald-700' : d > 0 ? 'text-rose-700' : 'text-slate-400')}>{d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0'}</td>
                    <td className="px-2 py-2 text-right text-slate-600">{wb === undefined ? '—' : `${wb} → ${ws ?? 0}`}</td>
                    <td className="py-2 pr-4 pl-2 text-right text-slate-600">
                      {node.type === 'user' || node.type === 'auto' ? `${formatDuration(mb?.avgWait ?? 0)} → ${formatDuration(ms?.avgWait ?? 0)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
