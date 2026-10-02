import { Activity, FastForward, FlaskConical, Loader2, Play, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildIndex, type Ctx, runScenario } from '@throughline/core'
import type { App } from '@throughline/core/model/types'
import { formatClock, formatDuration } from '@throughline/core/model/util'
import { Badge, Button, Card, cx, EmptyState, Segmented } from '../../components/ui'
import { useApp, useDesign } from '../../store/design'
import { ctxFor, useSim, useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { describeBottleneck } from '../monitor/bottleneck'
import { ChangeBuilder, defaultChange } from './ChangeBuilder'
import { describeChange, type Suggestion, suggestions, type Tone, verdict } from './lab'
import { Results } from './Results'
import { type Run, useLab } from './runs'

// The What-if lab: see the bottleneck, simulate a fix on a copy of the live
// model, compare, and apply what works.

const HORIZONS = [2, 4, 8, 24, 72] as const
const NO_DRAFTS: never[] = []

export function ScenariosView() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const design = useDesign((s) => s.design)
  const drafts = useLab((s) => s.drafts[appId] ?? NO_DRAFTS)
  const hours = useLab((s) => s.hours)
  const allRuns = useLab((s) => s.runs)
  const selectedId = useLab((s) => s.selected[appId])
  const [running, setRunning] = useState(false)
  const runs = useMemo(() => allRuns.filter((r) => r.appId === appId), [allRuns, appId])
  const selected = runs.find((r) => r.id === selectedId) ?? runs[runs.length - 1]
  const ctx = useMemo<Ctx | undefined>(() => (app ? { app, users: design.users, groups: design.groups, services: design.services } : undefined), [app, design])

  if (!app || !ctx) return null
  const lab = useLab.getState()

  const addKind = (kind: Parameters<typeof defaultChange>[0]) => {
    const change = defaultChange(kind, app, design, useSim.getState().views[appId]?.bottleneckId)
    if (change) lab.add(appId, [change])
    else useUi.getState().toast('Nothing in this application to change of that kind yet.', 'warn')
  }

  const run = () => {
    const changes = drafts.map((d) => d.change)
    setRunning(true)
    // runScenario is synchronous; yield first so "Running…" paints.
    setTimeout(() => {
      try {
        if (!useSim.getState().sims[appId]) useSim.getState().refresh()
        const sim = useSim.getState().sims[appId]
        const live = ctxFor(appId)
        if (!sim || !live) return
        const result = runScenario(sim, live, changes, hours)
        useLab.getState().record({ appId, from: sim.clock, hours, changes, result })
      } catch (e) {
        useUi.getState().toast(`The run failed: ${e instanceof Error ? e.message : String(e)}`, 'warn')
      } finally {
        setRunning(false)
      }
    }, 40)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        <header>
          <h1 className="text-lg font-semibold text-slate-900">What-if</h1>
          <p className="text-xs text-slate-500">
            Copies the live simulation, applies your changes, runs both forward with the same random numbers, and compares. Any difference comes from your change.
          </p>
        </header>

        <LiveState app={app} />

        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="min-w-0 xl:col-span-2">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">Suggested experiments</h2>
              <p className="text-[11px] text-slate-500">Based on where work is piling up right now. One click adds them to your changes.</p>
            </div>
            <Suggestions ctx={ctx} onAdd={(s) => lab.add(appId, s.changes)} />
          </Card>

          <Card className="min-w-0 xl:col-span-3">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Your changes</h2>
                <p className="text-[11px] text-slate-500">Only the copy changes. The live design stays as it is until you apply a result.</p>
              </div>
              {drafts.length > 0 && (
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => lab.clear(appId)}>
                  Clear
                </Button>
              )}
            </div>
            <div className="space-y-3 px-4 py-3">
              <ChangeBuilder app={app} design={design} drafts={drafts} onAdd={addKind} onEdit={(key, change) => lab.edit(appId, key, change)} onRemove={(key) => lab.remove(appId, key)} />
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                <span className="text-xs font-medium text-slate-600">Run for</span>
                <Segmented<number> value={hours} onChange={(h) => lab.setHours(h)} options={HORIZONS.map((h) => ({ value: h, label: `${h}h`, title: `${h} simulated hours` }))} />
                <span className="text-[11px] text-slate-400">simulated hours{hours >= 24 ? ' · long runs on busy apps take a few seconds' : ''}</span>
                <div className="flex-1" />
                <Button variant="primary" icon={running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} disabled={running} onClick={run}>
                  {running ? 'Running…' : drafts.length ? 'Run what-if' : 'Run as designed'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {runs.length > 0 && <RunHistory runs={runs} selectedId={selected?.id} ctx={ctx} />}

        {running && !selected ? (
          <Card>
            <EmptyState icon={<Loader2 size={28} className="animate-spin" />} title="Running both copies…" />
          </Card>
        ) : selected ? (
          <div className={cx('transition-opacity', running && 'opacity-50')}>
            <Results run={selected} ctx={ctx} />
          </div>
        ) : (
          <Card>
            <EmptyState icon={<FlaskConical size={32} />} title="No runs yet">
              Add a change (or pick a suggestion) and press Run. Results show side by side: what happens as designed, and what happens with your change.
            </EmptyState>
          </Card>
        )}
      </div>
    </div>
  )
}

/** Simulated time, items in flight and the bottleneck right now (or a warm-up offer). */
function LiveState({ app }: { app: App }) {
  const view = useSimView()
  const design = useDesign((s) => s.design)
  const clock = view?.clock ?? 0

  if (clock === 0) {
    return (
      <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Activity size={18} className="shrink-0 text-slate-400" />
        <p className="min-w-0 flex-1 text-xs text-slate-600">
          <span className="font-medium text-slate-800">The simulation hasn’t run yet.</span> A what-if starts from the live state, so with nothing in flight both copies start empty. Warm it up first
          to compare from a realistic day.
        </p>
        <Button variant="primary" size="sm" icon={<FastForward size={13} />} onClick={() => useSim.getState().fastForward(240)}>
          Warm up 4h
        </Button>
      </Card>
    )
  }

  const found = describeBottleneck(view, app, design)

  return (
    <Card className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-[auto_auto_1fr] sm:divide-x sm:divide-y-0">
      <Stat label="Simulated time" value={formatClock(clock)} />
      <Stat label="In flight" value={(view?.active ?? 0).toLocaleString()} />
      <div className="flex min-w-0 items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-medium tracking-wide text-slate-500 uppercase">Current bottleneck</div>
          {found ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <TriangleAlert size={14} className="text-rose-600" />
                {found.node.data.label}
              </span>
              <span className="text-xs text-slate-500">{found.why}</span>
            </div>
          ) : (
            <div className="text-sm font-medium text-emerald-700">None right now: work is flowing.</div>
          )}
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[10.5px] font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="text-sm font-semibold whitespace-nowrap text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}

const TAG_TONE = { Fix: 'brand', 'Stress test': 'amber', Resilience: 'violet' } as const

function Suggestions({ ctx, onAdd }: { ctx: Ctx; onAdd: (s: Suggestion) => void }) {
  const view = useSimView()
  const list = suggestions(view, ctx)
  if (!list.length) return <EmptyState title="Nothing to suggest yet">Run the simulation for a while to see where work piles up.</EmptyState>
  const hasFix = list.some((s) => s.tag === 'Fix')
  return (
    <ul className="divide-y divide-slate-100">
      {!hasFix && <li className="px-4 py-2 text-[11px] text-slate-500">No bottleneck right now, so no fixes to suggest. Try a stress test to find the next one.</li>}
      {list.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => onAdd(s)} className="group flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{s.title}</span>
                <Badge tone={TAG_TONE[s.tag]}>{s.tag}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{s.detail}</p>
            </div>
            <span className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 group-hover:border-brand-300 group-hover:text-brand-700">
              <Plus size={12} /> Add
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const DOT: Record<Tone, string> = { good: 'bg-emerald-500', bad: 'bg-rose-500', mixed: 'bg-amber-500', neutral: 'bg-slate-300' }

function signed(n: number, fmt: (n: number) => string = (x) => x.toLocaleString()): string {
  return n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0'
}

/** The last few runs, side by side, so fixes can be compared. */
function RunHistory({ runs, selectedId, ctx }: { runs: Run[]; selectedId?: number; ctx: Ctx }) {
  const idx = useMemo(() => buildIndex(ctx), [ctx])
  const appId = ctx.app.id
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Recent runs</h2>
          <p className="text-[11px] text-slate-500">Each run is compared with the design as it was. Click one to see its details.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => useLab.getState().forget(appId)}>
          Clear runs
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="py-2 pr-2 pl-4">Run</th>
              <th className="px-2 py-2">Changes</th>
              <th className="px-2 py-2 text-right">Hours</th>
              <th className="px-2 py-2 text-right">Completed</th>
              <th className="px-2 py-2 text-right">Avg cycle</th>
              <th className="py-2 pr-4 pl-2 text-right">In flight at end</th>
            </tr>
          </thead>
          <tbody>
            {[...runs].reverse().map((r, i) => {
              const { baseline: b, scenario: s } = r.result
              const tone = verdict(r.result, r.changes, ctx).tone
              return (
                <tr
                  key={r.id}
                  onClick={() => useLab.getState().select(appId, r.id)}
                  className={cx('cursor-pointer border-b border-slate-100 tabular-nums last:border-0 hover:bg-slate-50', r.id === selectedId && 'bg-brand-50/50')}
                >
                  <td className="py-2 pr-2 pl-4 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                      <span className={cx('h-2 w-2 rounded-full', DOT[tone])} />#{runs.length - i}
                      {r.applied && <Badge tone="green">Applied</Badge>}
                    </span>
                  </td>
                  <td className="max-w-[420px] truncate px-2 py-2 text-slate-600" title={r.changes.map((c) => describeChange(idx, c)).join(' · ')}>
                    {r.changes.length ? r.changes.map((c) => describeChange(idx, c)).join(' · ') : 'As designed (no changes)'}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-600">{r.hours}h</td>
                  <td className="px-2 py-2 text-right text-slate-700">{signed(s.completed - b.completed)}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{signed(s.avgCycle - b.avgCycle, formatDuration)}</td>
                  <td className="py-2 pr-4 pl-2 text-right text-slate-700">{signed(s.wip - b.wip)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
