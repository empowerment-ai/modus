import { Activity, ArrowRight, Download, FastForward, FlaskConical, Play, TriangleAlert } from 'lucide-react'
import { exportOcel } from '@throughline/core'
import { type ReactNode, useMemo } from 'react'
import { Button, Card, cx, EmptyState } from '../../components/ui'
import { formatClock, formatDuration } from '@throughline/core/model/util'
import { useApp, useDesign } from '../../store/design'
import { ctxFor, useSim, useSimState, useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { ActivityFeed } from './ActivityFeed'
import { describeBottleneck, openStep } from './bottleneck'
import { ObjectExplorer } from './ObjectExplorer'
import { ServicesPanel } from './ServicesPanel'
import { StepsTable } from './StepsTable'
import { WipChart } from './WipChart'
import { WorkloadTable } from './WorkloadTable'

/** Download the simulation's event log for process-mining tools (Celonis, PM4Py, ProM, …). */
function downloadEventLog(appId: string) {
  const sim = useSim.getState().sims[appId]
  const ctx = ctxFor(appId)
  if (!sim || !ctx) return
  const blob = new Blob([JSON.stringify(exportOcel(sim, ctx))], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${ctx.app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ocel2.json`
  a.click()
  URL.revokeObjectURL(a.href)
  useUi.getState().toast('Event log exported as OCEL 2.0.', 'success')
}

// The administrator's live view of the open application's simulated work:
// where items are piling up, who is carrying the load, and what just happened.

export function MonitorView() {
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const services = useDesign((s) => s.design.services)
  const view = useSimView()
  const sim = useSimState()
  const version = useSim((s) => s.version)
  const running = useSim((s) => s.running)
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  if (!app) return null

  const slaBreaches = view ? Object.values(view.nodes).reduce((sum, m) => sum + m.slaBreaches, 0) : 0
  const hasWork = (sim?.created ?? 0) > 0
  const bottleneck = describeBottleneck(view, app, { users, groups, services })
  const usesServices = app.workflows.some((w) => w.nodes.some((n) => n.type === 'auto' && n.data.serviceId))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Monitor</h1>
            <p className="text-xs text-slate-500">
              Live view of simulated work in <span className="font-medium text-slate-700">{app.name}</span>: find bottlenecks, see who carries the load, and follow every release.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<Download size={13} />} disabled={!hasWork} onClick={() => downloadEventLog(appId)} title="Every audit entry as an OCEL 2.0 object-centric event log, for process-mining tools">
              Export event log (OCEL 2.0)
            </Button>
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', running ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
              <span className={cx('h-1.5 w-1.5 rounded-full', running ? 'animate-pulse bg-emerald-500' : 'bg-slate-400')} />
              {running ? 'Live' : 'Paused'} · {formatClock(view?.clock ?? 0)}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          <Kpi label="Created" value={(view?.created ?? 0).toLocaleString()} />
          <Kpi label="In flight" value={(view?.active ?? 0).toLocaleString()} />
          <Kpi label="Completed" value={(view?.completed ?? 0).toLocaleString()} tone="green" />
          <Kpi label="Rejected" value={(view?.rejected ?? 0).toLocaleString()} />
          <Kpi label="Avg cycle time" value={formatDuration(view?.avgCycle ?? 0)} hint="Created to finished" />
          <Kpi label="SLA breaches" value={slaBreaches.toLocaleString()} tone={slaBreaches > 0 ? 'amber' : undefined} hint="Items past their step's SLA" />
          <Kpi label="Overdue" value={(view?.overdue ?? 0).toLocaleString()} tone={(view?.overdue ?? 0) > 0 ? 'amber' : undefined} hint="Open items past their workflow's target time" />
          <Kpi label="Stuck" value={(view?.stuck ?? 0).toLocaleString()} tone={(view?.stuck ?? 0) > 0 ? 'red' : undefined} hint="No path in the map" />
          <Kpi label="Parallel branches" value={(view?.branches ?? 0).toLocaleString()} hint="Branches running side by side inside items that split into parallel paths" />
        </div>

        {!hasWork ? (
          <Card>
            <EmptyState icon={<Activity size={32} />} title="No simulated work yet">
              <p>Start the simulation to send {app.objectTypes[0]?.pluralName.toLowerCase() ?? 'objects'} through the workflow, or jump ahead a working day to see where work piles up.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="primary" icon={<Play size={14} />} onClick={() => useSim.getState().play()}>
                  Run simulation
                </Button>
                <Button icon={<FastForward size={14} />} onClick={() => useSim.getState().fastForward(8 * 60)}>
                  Jump ahead 8 hours
                </Button>
              </div>
            </EmptyState>
          </Card>
        ) : (
          <>
            {bottleneck && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-2.5">
                <TriangleAlert size={16} className="shrink-0 text-rose-600" />
                <p className="min-w-0 flex-1 text-xs text-rose-950">
                  <span className="font-semibold">Bottleneck: {bottleneck.node.data.label}</span>
                  {app.workflows.length > 1 && <span className="text-rose-800"> in {bottleneck.wf.name}</span>}
                  <span className="text-rose-800"> · {bottleneck.why}</span>
                </p>
                <Button size="sm" variant="ghost" onClick={() => openStep(app, bottleneck.wf.id, bottleneck.node.id)}>
                  Open step
                </Button>
                <Button size="sm" variant="primary" icon={<FlaskConical size={13} />} onClick={() => useUi.getState().setView('scenarios')}>
                  Test a fix in What-if <ArrowRight size={13} />
                </Button>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-5">
              <Section title="Work in flight over time" className={usesServices ? 'xl:col-span-3' : 'xl:col-span-5'}>
                <div className="px-4 pt-3 pb-3">
                  <WipChart series={sim!.series} />
                </div>
              </Section>
              {usesServices && (
                <Section title="Services" subtitle="Load against capacity, queue and failures." className="xl:col-span-2">
                  <ServicesPanel app={app} services={services} view={view} />
                </Section>
              )}
            </div>

            <Section title="Steps" subtitle="Click a step to open it in the designer. The shuffle button evens out its work.">
              <StepsTable app={app} view={view} services={services} />
            </Section>

            <div className="grid gap-4 xl:grid-cols-5">
              <Section title="Workload by person" subtitle="Open items are assigned or in progress." className="xl:col-span-3">
                <WorkloadTable app={app} users={users} groups={groups} view={view} sim={sim} />
              </Section>
              <Section title="Activity" subtitle="Newest first" className="xl:col-span-2">
                <ActivityFeed feed={sim!.feed} users={usersById} />
              </Section>
            </div>

            <Section title="Object explorer" subtitle="Every object is searchable, including completed work.">
              <ObjectExplorer key={app.id} app={app} users={users} sim={sim} version={version} />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('flex min-w-0 flex-col overflow-hidden', className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="truncate text-[11px] text-slate-500">{subtitle}</p>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'green' | 'red' | 'amber' }) {
  return (
    <Card className="px-3.5 py-2.5">
      <div className="text-[10.5px] font-medium tracking-wide text-slate-500 uppercase" title={hint}>
        {label}
      </div>
      <div
        className={cx('mt-0.5 text-xl font-semibold tabular-nums', tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}
      >
        {value}
      </div>
    </Card>
  )
}
