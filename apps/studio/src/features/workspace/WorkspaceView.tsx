import { FileText, House, Inbox, Info, Layers, type LucideIcon, Plus, Send, Users, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { cx, EmptyState } from '../../components/ui'
import type { Ctx } from '@modus-bpm/core'
import type { App, Group, User } from '@modus-bpm/core/model/types'
import { formatClock } from '@modus-bpm/core/model/util'
import { useApp, useDesign } from '../../store/design'
import { SPEEDS, useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { DistributePage } from './DistributePage'
import { HomePage } from './HomePage'
import { useLiveSim, useWorkData, useWorkspaceCtx } from './live'
import { MyWorkPage } from './MyWorkPage'
import { NewRequestPage } from './NewRequestPage'
import { Count } from './parts'
import { PersonaPicker } from './PersonaPicker'
import { appPeople, suggestedPeople } from './personas'
import { QueuesPage } from './QueuesPage'
import { RequestsPage } from './RequestsPage'
import { type Page, useWorkspace } from './store'

// The Workspace: what the people doing the work see. Pick who you are working as,
// then work your basket, fetch from queues, hand out work and follow your requests
// while the simulation keeps everyone else busy.

export function WorkspaceView() {
  const appId = useUi((s) => s.appId)
  const actingAs = useUi((s) => s.actingAs)
  const app = useApp(appId)
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const ctx = useWorkspaceCtx()
  const people = useMemo(() => (app ? appPeople(app, users, groups) : []), [app, users, groups])
  const suggested = useMemo(() => (ctx ? suggestedPeople(ctx, people) : []), [ctx, people])
  const me = people.find((u) => u.id === actingAs)

  // Someone who doesn't take part in this app: start as its first suggested persona.
  useEffect(() => {
    const first = suggested[0]?.user ?? people[0]
    if (!me && first) useUi.getState().setActingAs(first.id)
  }, [me, people, suggested])

  if (!app || !ctx) return null
  if (!people.length) {
    return (
      <EmptyState icon={<Users size={28} />} title="No one works in this application yet">
        Give its steps a group and its object types create permissions in Studio, then come back to work as one of those people.
      </EmptyState>
    )
  }
  if (!me) return null
  return <Workspace key={`${app.id}:${me.id}`} app={app} me={me} ctx={ctx} users={users} groups={groups} people={people} suggested={suggested} />
}

interface WorkspaceProps {
  app: App
  me: User
  ctx: Ctx
  users: User[]
  groups: Group[]
  people: User[]
  suggested: Array<{ user: User; role: string }>
}

function Workspace({ app, me, ctx, users, groups, people, suggested }: WorkspaceProps) {
  const { sim, tick } = useLiveSim()
  const data = useWorkData(sim, ctx, me.id, tick)
  const stored = useWorkspace((s) => s.page)
  const dispatches = data.distribution.length > 0
  const page: Page = stored === 'distribute' && !dispatches ? 'home' : stored

  // Opening an item from elsewhere (e.g. "Create & open") shows it here, not in the administrator's drawer.
  const objectId = useUi((s) => s.objectId)
  useLayoutEffect(() => {
    if (!objectId) return
    useUi.getState().openObject(null)
    const held = data.basket.find((i) => i.obj.id === objectId)
    if (held) useWorkspace.getState().openItem(held.token.id)
    else useWorkspace.getState().openRequest(objectId)
  }, [objectId, data.basket])

  const overdue = data.basket.filter((i) => i.overdue).length
  const nav: Array<{ page: Page; label: string; icon: LucideIcon; count?: number; tone?: 'red' | 'brand' }> = [
    { page: 'home', label: 'Home', icon: House },
    { page: 'work', label: 'My work', icon: Inbox, count: data.basket.length, tone: overdue ? 'red' : 'brand' },
    { page: 'queues', label: 'Queues', icon: Layers, count: data.queues.reduce((n, q) => n + q.items.length, 0) },
    ...(dispatches ? [{ page: 'distribute' as const, label: 'Distribute', icon: Send, count: data.distribution.reduce((n, d) => n + d.waiting.length, 0) }] : []),
    { page: 'requests', label: 'My requests', icon: FileText, count: data.requests.filter((r) => r.obj.status === 'active').length },
    { page: 'new', label: 'New request', icon: Plus },
  ]

  const common = { me, app, ctx, users, groups, sim, tick, data }

  return (
    <div className="flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="p-3">
          <PersonaPicker me={me} people={people} suggested={suggested} ctx={ctx} />
        </div>
        <nav className="space-y-0.5 px-2" aria-label="Workspace">
          {nav.map((n) => (
            <button
              key={n.page}
              type="button"
              onClick={() => useWorkspace.getState().go(n.page)}
              aria-current={page === n.page ? 'page' : undefined}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                page === n.page ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              <n.icon size={16} strokeWidth={page === n.page ? 2.2 : 1.8} />
              <span className="flex-1 text-left">{n.label}</span>
              {n.count !== undefined && <Count n={n.count} tone={n.tone} />}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <SimStatus clock={data.clock} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <IntroBanner />
        <div className="min-h-0 flex-1">
          {page === 'home' && <HomePage {...common} />}
          {page === 'work' && <MyWorkPage {...common} />}
          {page === 'queues' && <QueuesPage {...common} />}
          {page === 'distribute' && <DistributePage {...common} />}
          {page === 'requests' && <RequestsPage {...common} />}
          {page === 'new' && <NewRequestPage {...common} />}
        </div>
      </div>
    </div>
  )
}

/** Whether colleagues are working right now, and how to get them going. */
function SimStatus({ clock }: { clock: number }) {
  const running = useSim((s) => s.running)
  const speed = useSim((s) => s.speed)
  return (
    <div className="m-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[11px] leading-snug text-slate-600">
      <p className="flex items-center gap-1.5 font-medium text-slate-800">
        <span className={cx('h-2 w-2 rounded-full', running ? 'animate-pulse bg-emerald-500' : 'bg-slate-300')} />
        {running ? `Simulation running · ${SPEEDS.find((s) => s.value === speed)?.label ?? `${speed} min/s`}` : 'Simulation paused'}
      </p>
      <p className="mt-0.5 font-mono text-[10.5px] text-slate-500">{formatClock(clock)}</p>
      <p className="mt-1">{running ? 'Colleagues are working and new items are arriving.' : 'Press Run simulation (or Space) so colleagues work and new items arrive.'}</p>
    </div>
  )
}

/** Shown until dismissed: how the Workspace and the simulation fit together. */
function IntroBanner() {
  const dismissed = useWorkspace((s) => s.introDismissed)
  if (dismissed) return null
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-brand-100 bg-brand-50/70 px-5 py-2.5 text-[13px] text-slate-700">
      <Info size={16} className="mt-0.5 shrink-0 text-brand-600" />
      <p className="min-w-0 flex-1 leading-snug">
        <span className="font-medium text-slate-900">You’re working as one person while the simulation runs everyone else.</span> Colleagues keep releasing their work and new items keep arriving. Your
        own basket waits for you: nothing in it moves until you act. Switch person any time with “Working as”.
      </p>
      <button type="button" aria-label="Dismiss" onClick={() => useWorkspace.getState().dismissIntro()} className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700">
        <X size={14} />
      </button>
    </div>
  )
}
