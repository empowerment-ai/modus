import { Activity, ArrowRight, Download, FastForward, FlaskConical, Info, Play, Radio, TriangleAlert } from 'lucide-react'
import { exportOcel, type Id } from '@modus-bpm/core'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button, Card, cx, EmptyState, Segmented, Select } from '../../components/ui'
import { formatClock, formatDuration } from '@modus-bpm/core/model/util'
import { getOcel } from '../../server/client'
import { liveStore, type LiveMode } from '../../server/live'
import { useLive } from '../../server/useLive'
import { useApp, useDesign } from '../../store/design'
import { ctxFor, useSim, useSimState, useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { ActivityFeed } from './ActivityFeed'
import { describeBottleneck, openStep } from './bottleneck'
import { LiveExplorer, SimExplorer } from './ObjectExplorer'
import { ServicesPanel } from './ServicesPanel'
import { adminsOf, designDifference, liveSource, type MonitorData, simSource, updatedAgo } from './source'
import { StepsTable } from './StepsTable'
import { WipChart } from './WipChart'
import { WorkloadTable } from './WorkloadTable'

const fileName = (appName: string) => `${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ocel2.json`

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Download the simulation's event log for process-mining tools (Celonis, PM4Py, ProM, …). */
function downloadEventLog(appId: string) {
  const sim = useSim.getState().sims[appId]
  const ctx = ctxFor(appId)
  if (!sim || !ctx) return
  saveBlob(new Blob([JSON.stringify(exportOcel(sim, ctx))], { type: 'application/json' }), fileName(ctx.app.name))
  useUi.getState().toast('Event log exported as OCEL 2.0.', 'success')
}

/** The server's event log: fetched with the acting administrator's header, which a plain link can't send. */
async function downloadServerLog(appId: Id, appName: string) {
  const user = liveStore.getState().actingAdmin
  if (!user) return
  try {
    saveBlob(await getOcel(appId, { user }), fileName(appName))
    useUi.getState().toast('The server’s event log exported as OCEL 2.0.', 'success')
  } catch (e) {
    useUi.getState().toast(`Couldn’t export the server’s event log: ${e instanceof Error ? e.message : String(e)}`, 'warn')
  }
}

// The administrator's live view of the open application's work: where items are piling up, who is
// carrying the load, and what just happened. From the in-browser simulation, or (served by a Modus
// server) from the server itself, with the same panels either way.

export function MonitorView() {
  const appId = useUi((s) => s.appId)
  const available = useLive((s) => s.available)
  const mode = useLive((s) => s.mode)

  // Follow the server while the Monitor is open (the store itself waits while Simulation is chosen).
  useEffect(() => {
    if (!available) return
    void liveStore.getState().connect(appId)
    return () => liveStore.getState().disconnect()
  }, [available, appId])

  return available && mode === 'live' ? <LiveMonitor appId={appId} /> : <SimMonitor appId={appId} />
}

function SimMonitor({ appId }: { appId: Id }) {
  const design = useDesign((s) => s.design)
  const view = useSimView()
  const sim = useSimState()
  const version = useSim((s) => s.version)
  const running = useSim((s) => s.running)
  const available = useLive((s) => s.available)
  const openObject = useUi((s) => s.openObject)
  const data = simSource(appId, design, view, sim)
  const app = data.app
  if (!app) return null

  return (
    <Page
      subtitle={
        <>
          Live view of simulated work in <span className="font-medium text-slate-700">{app.name}</span>: find bottlenecks, see who carries the load, and follow every release.
        </>
      }
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={13} />}
            disabled={!data.hasWork}
            onClick={() => downloadEventLog(appId)}
            title="Every audit entry as an OCEL 2.0 object-centric event log, for process-mining tools"
          >
            Export event log (OCEL 2.0)
          </Button>
          <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium', running ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
            <span className={cx('h-1.5 w-1.5 rounded-full', running ? 'animate-pulse bg-emerald-500' : 'bg-slate-400')} />
            {/* Next to a Live switch, "Live" would mean the server. */}
            {running ? (available ? 'Simulating' : 'Live') : 'Paused'} · {formatClock(view?.clock ?? 0)}
          </span>
          {available && <ModeSwitch mode="simulation" />}
        </>
      }
    >
      <Panels
        data={data}
        app={app}
        clock={sim?.clock ?? 0}
        onOpenItem={openObject}
        explorer={<SimExplorer key={app.id} app={app} users={data.users} sim={sim} version={version} />}
        empty={
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
        }
      />
    </Page>
  )
}

function LiveMonitor({ appId }: { appId: Id }) {
  const design = useLive((s) => s.design)
  const monitor = useLive((s) => s.monitor)
  const series = useLive((s) => s.series)
  const feed = useLive((s) => s.feed)
  const status = useLive((s) => s.status)
  const error = useLive((s) => s.error)
  const localDesign = useDesign((s) => s.design)
  const localApp = useApp(appId)
  const data = useMemo(() => liveSource(appId, { design, monitor, series, feed }), [appId, design, monitor, series, feed])
  // Compared when either design changes, not on every update.
  const difference = useMemo(() => (design ? designDifference(design, localDesign, appId) : undefined), [design, localDesign, appId])
  const app = data.app
  const name = app?.name ?? localApp?.name ?? 'this application'

  let content: ReactNode
  if (app && monitor) {
    content = (
      <Panels
        data={data}
        app={app}
        clock={monitor.clock}
        explorer={<LiveExplorer key={app.id} app={app} users={data.users} />}
        empty={
          <Card>
            <EmptyState icon={<Activity size={32} />} title="No items on the server yet">
              Items created through the API or the Workspace show up here within a second or two.
            </EmptyState>
          </Card>
        }
      />
    )
  } else if (design && !app) {
    content = (
      <Card>
        <EmptyState icon={<Radio size={32} />} title={`The server doesn’t run ${name}`}>
          Open an application the server runs, or switch the Monitor to Simulation.
        </EmptyState>
      </Card>
    )
  } else if (status !== 'error') {
    content = (
      <Card>
        <EmptyState icon={<Radio size={32} />} title="Connecting to the server…">
          The Monitor shows the server’s live state as soon as it answers.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Page
      subtitle={
        <>
          Live view of the server’s work in <span className="font-medium text-slate-700">{name}</span>: find bottlenecks, see who carries the load, and follow every release.
        </>
      }
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={13} />}
            disabled={!app || !data.hasWork}
            onClick={() => void downloadServerLog(appId, name)}
            title="Every audit entry on the server as an OCEL 2.0 object-centric event log, for process-mining tools"
          >
            Export event log (OCEL 2.0)
          </Button>
          <ActingAdmin />
          <LiveBadge />
          <ModeSwitch mode="live" />
        </>
      }
    >
      {status === 'error' && error && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-2.5 text-xs text-rose-800">
          <TriangleAlert size={15} className="shrink-0 text-rose-600" />
          <span>
            {error} {adminsOf(design).length > 0 && 'Pick another administrator under “Acting as”.'}
          </span>
        </p>
      )}
      {difference && (
        <p className="flex items-center gap-2 text-[11px] text-slate-500">
          <Info size={13} className="shrink-0 text-slate-400" />
          {difference}
        </p>
      )}
      {content}
    </Page>
  )
}

/** Live (the server) or Simulation (this browser): shown only when a server serves the Studio. */
function ModeSwitch({ mode }: { mode: LiveMode }) {
  return (
    <Segmented<LiveMode>
      size="sm"
      value={mode}
      onChange={(m) => liveStore.getState().setMode(m)}
      options={[
        { value: 'live', label: 'Live', title: 'The server’s real work, as it happens' },
        { value: 'simulation', label: 'Simulation', title: 'This browser’s simulation of the design' },
      ]}
    />
  )
}

/** "Live · updated 3s ago", ticking; amber while reconnecting. */
function LiveBadge() {
  const status = useLive((s) => s.status)
  const lastUpdate = useLive((s) => s.lastUpdate)
  const error = useLive((s) => s.error)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const [tone, dot, text] =
    status === 'live'
      ? ['bg-emerald-50 text-emerald-700', 'animate-pulse bg-emerald-500', `Live · ${updatedAgo(lastUpdate, now)}`]
      : status === 'reconnecting'
        ? ['bg-amber-50 text-amber-800', 'bg-amber-500', 'Reconnecting…']
        : status === 'connecting'
          ? ['bg-slate-100 text-slate-600', 'animate-pulse bg-slate-400', 'Connecting…']
          : status === 'error'
            ? ['bg-rose-50 text-rose-700', 'bg-rose-500', 'Not connected']
            : ['bg-slate-100 text-slate-600', 'bg-slate-400', 'Not connected']
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap tabular-nums', tone)}
      title={
        status === 'reconnecting' && lastUpdate ? `${error ?? 'The server stopped answering'}. Showing what it said ${updatedAgo(lastUpdate, now).replace('updated ', '')}.` : (error ?? undefined)
      }
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', dot)} />
      {text}
    </span>
  )
}

/** Who the Studio acts as on the server until sign-in exists: one of the design's administrators. */
function ActingAdmin() {
  const design = useLive((s) => s.design)
  const acting = useLive((s) => s.actingAdmin)
  const admins = adminsOf(design)
  if (!design) return null
  const current = design.users.find((u) => u.id === acting)
  const options = current && !admins.includes(current) ? [current, ...admins] : admins
  return (
    <label
      className="flex items-center gap-1.5 text-[11px] text-slate-500"
      title="The Monitor’s requests go to the server as this person (x-user-id) until sign-in exists. Only administrators can see the Monitor."
    >
      Acting as
      <Select value={acting ?? ''} onChange={(e) => liveStore.getState().setActingAdmin(e.target.value)} className="h-7 w-auto py-0 text-xs" aria-label="Acting administrator">
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
            {u.roles?.includes('admin') ? '' : ' (not an administrator)'}
          </option>
        ))}
      </Select>
    </label>
  )
}

function Page({ subtitle, actions, children }: { subtitle: ReactNode; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Monitor</h1>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
        {children}
      </div>
    </div>
  )
}

/**
 * KPIs and panels: the same layout from either source; `empty` replaces the panels until there's work.
 * `onOpenItem` only where items open here (the simulation).
 */
function Panels({
  data,
  app,
  clock,
  explorer,
  empty,
  onOpenItem,
}: {
  data: MonitorData
  app: NonNullable<MonitorData['app']>
  clock: number
  explorer: ReactNode
  empty: ReactNode
  onOpenItem?: (id: Id) => void
}) {
  const { view, users, groups, services, live } = data
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const slaBreaches = view ? Object.values(view.nodes).reduce((sum, m) => sum + m.slaBreaches, 0) : 0
  const bottleneck = describeBottleneck(view, app, { users, groups, services })
  const usesServices = app.workflows.some((w) => w.nodes.some((n) => n.type === 'auto' && n.data.serviceId))
  // Expedite KPIs only where expediting is set up or has happened.
  const showExpedite = app.workflows.some((w) => w.expedite) || (view?.expedited ?? 0) > 0 || (view?.expeditedCycle ?? 0) > 0
  const cycle = (m: number | undefined) => (m ? formatDuration(m) : '—')

  return (
    <>
      <div className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3', showExpedite ? 'md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-11' : 'lg:grid-cols-5 xl:grid-cols-9')}>
        <Kpi label="Created" value={(view?.created ?? 0).toLocaleString()} />
        <Kpi label="In flight" value={(view?.active ?? 0).toLocaleString()} />
        <Kpi label="Completed" value={(view?.completed ?? 0).toLocaleString()} tone="green" />
        <Kpi label="Rejected" value={(view?.rejected ?? 0).toLocaleString()} />
        <Kpi label="Avg cycle time" value={formatDuration(view?.avgCycle ?? 0)} hint="Created to finished" />
        <Kpi label="SLA breaches" value={slaBreaches.toLocaleString()} tone={slaBreaches > 0 ? 'amber' : undefined} hint="Items past their step's SLA" />
        <Kpi label="Overdue" value={(view?.overdue ?? 0).toLocaleString()} tone={(view?.overdue ?? 0) > 0 ? 'amber' : undefined} hint="Open items past their workflow's target time" />
        <Kpi label="Stuck" value={(view?.stuck ?? 0).toLocaleString()} tone={(view?.stuck ?? 0) > 0 ? 'red' : undefined} hint="No path in the map" />
        <Kpi label="Parallel branches" value={(view?.branches ?? 0).toLocaleString()} hint="Branches running side by side inside items that split into parallel paths" />
        {showExpedite && (
          <>
            <Kpi
              label="Expedited in flight"
              value={(view?.expedited ?? 0).toLocaleString()}
              tone={(view?.expedited ?? 0) > 0 ? 'amber' : undefined}
              hint="Open items flagged to go faster: ahead of every queue, with tighter due dates"
            />
            <Kpi
              label="Expedited cycle"
              value={cycle(view?.expeditedCycle)}
              sub={`vs ${cycle(view?.normalCycle)} normal`}
              hint="Average time from created to finished for expedited items, against everything else"
            />
          </>
        )}
      </div>

      {!data.hasWork ? (
        empty
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
                <WipChart series={data.series} />
              </div>
            </Section>
            {usesServices && (
              <Section title="Services" subtitle="Load against capacity, queue and failures." className="xl:col-span-2">
                <ServicesPanel app={app} services={services} view={view} />
              </Section>
            )}
          </div>

          <Section title="Steps" subtitle={live ? 'Click a step to open it in the designer.' : 'Click a step to open it in the designer. The shuffle button evens out its work.'}>
            <StepsTable app={app} view={view} services={services} expedited={data.expedited} redistribute={!live} />
          </Section>

          <div className="grid gap-4 xl:grid-cols-5">
            <Section
              title="Workload by person"
              subtitle={live ? 'Open items are assigned or in progress. No utilization: people on a server aren’t simulated.' : 'Open items are assigned or in progress.'}
              className="xl:col-span-3"
            >
              <WorkloadTable app={app} users={users} groups={groups} view={view} working={data.working} clock={clock} utilization={!live} onOpenItem={onOpenItem} />
            </Section>
            <Section title="Activity" subtitle="Newest first" className="xl:col-span-2">
              <ActivityFeed feed={data.feed} users={usersById} onOpenItem={onOpenItem} />
            </Section>
          </div>

          <Section title="Object explorer" subtitle="Every object is searchable, including completed work.">
            {explorer}
          </Section>
        </>
      )}
    </>
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

function Kpi({ label, value, sub, hint, tone }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string; tone?: 'green' | 'red' | 'amber' }) {
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
      {sub && <div className="truncate text-[11px] text-slate-500 tabular-nums">{sub}</div>}
    </Card>
  )
}
