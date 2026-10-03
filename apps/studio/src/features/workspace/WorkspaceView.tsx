import { Eye, FileText, House, Inbox, Info, Layers, type LucideIcon, Plus, Search, Send, Sparkles, Users, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { cx, EmptyState } from '../../components/ui'
import type { Ctx } from '@modus-bpm/core'
import type { App, Group, User } from '@modus-bpm/core/model/types'
import { formatClock } from '@modus-bpm/core/model/util'
import { useApp, useDesign } from '../../store/design'
import { SPEEDS, useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { AskPanel } from './AskPanel'
import { DistributePage } from './DistributePage'
import { HomePage } from './HomePage'
import { useLiveSim, useWorkData, useWorkspaceCtx } from './live'
import { MyWorkPage } from './MyWorkPage'
import { NewRequestPage } from './NewRequestPage'
import { Count } from './parts'
import { PersonaPicker } from './PersonaPicker'
import { appPeople, suggestedPeople } from './personas'
import { QueuesPage } from './QueuesPage'
import { QuickSearch } from './QuickSearch'
import { RequestsPage } from './RequestsPage'
import { MOD_KEY } from './searchParts'
import { SearchPage } from './SearchPage'
import { type Page, useWorkspace } from './store'
import { SupervisePage } from './SupervisePage'

// The Workspace: what the people doing the work see. Pick who you are working as,
// then work your basket, fetch from queues, hand out work, supervise, search and
// follow your requests while the simulation keeps everyone else busy.

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
  const quickOpen = useWorkspace((s) => s.quickOpen)
  const askOpen = useWorkspace((s) => s.askOpen)
  const dispatches = data.distribution.length > 0
  const supervises = data.supervision.steps.length > 0 || data.supervision.processes.length > 0 || !!me.roles?.includes('admin')
  const page: Page = (stored === 'distribute' && !dispatches) || (stored === 'supervise' && !supervises) ? 'home' : stored

  // "/" or ⌘K / Ctrl+K: quick search from anywhere in the Workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable
      const modK = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
      const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey
      if (!modK && !slash) return
      const ws = useWorkspace.getState()
      if (ws.quickOpen) {
        e.preventDefault()
        if (modK) ws.setQuickOpen(false)
        return
      }
      // Leave dialogs (delegate, expedite, create…) alone.
      if (useUi.getState().createFor || document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      // On the Search page the box is right there.
      if (ws.page === 'search' && !ws.viewId) document.querySelector<HTMLInputElement>('input[aria-label="Search items"]')?.focus()
      else ws.setQuickOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const closeQuick = useCallback(() => useWorkspace.getState().setQuickOpen(false), [])
  const closeAsk = useCallback(() => useWorkspace.getState().setAskOpen(false), [])
  const askModus = useCallback((question?: string) => useWorkspace.getState().openAsk(question), [])

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
  const escalated = data.supervision.steps.reduce((n, s) => n + s.escalated.length, 0)
  const nav: Array<{ page: Page; label: string; icon: LucideIcon; count?: number; tone?: 'red' | 'brand' }> = [
    { page: 'home', label: 'Home', icon: House },
    { page: 'work', label: 'My work', icon: Inbox, count: data.basket.length, tone: overdue ? 'red' : 'brand' },
    { page: 'queues', label: 'Queues', icon: Layers, count: data.queues.reduce((n, q) => n + q.items.length, 0) },
    ...(dispatches ? [{ page: 'distribute' as const, label: 'Distribute', icon: Send, count: data.distribution.reduce((n, d) => n + d.waiting.length, 0) }] : []),
    ...(supervises ? [{ page: 'supervise' as const, label: 'Supervise', icon: Eye, count: escalated, tone: 'red' as const }] : []),
    { page: 'requests', label: 'My requests', icon: FileText, count: data.requests.filter((r) => r.obj.status === 'active').length },
    { page: 'new', label: 'New request', icon: Plus },
    { page: 'search', label: 'Search', icon: Search },
  ]

  const common = { me, app, ctx, users, groups, sim, tick, data }

  return (
    <div className="relative flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-2 p-3">
          <PersonaPicker me={me} people={people} suggested={suggested} ctx={ctx} />
          <button
            type="button"
            onClick={() => useWorkspace.getState().setQuickOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50/70 px-2.5 text-left text-[13px] text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700"
            title={`Search items (/ or ${MOD_KEY}K)`}
          >
            <Search size={14} className="shrink-0" />
            <span className="flex-1">Search…</span>
            <kbd className="rounded border border-slate-200 bg-white px-1 font-sans text-[10.5px] text-slate-500">{MOD_KEY}K</kbd>
          </button>
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
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={() => (askOpen ? closeAsk() : askModus())}
            aria-pressed={askOpen}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              askOpen ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-50',
            )}
          >
            <Sparkles size={16} strokeWidth={1.8} />
            <span className="flex-1 text-left">Ask Modus</span>
          </button>
        </div>
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
          {page === 'supervise' && <SupervisePage {...common} />}
          {page === 'requests' && <RequestsPage {...common} />}
          {page === 'new' && <NewRequestPage {...common} />}
          {page === 'search' && <SearchPage {...common} onAsk={askModus} />}
        </div>
      </div>

      {quickOpen && <QuickSearch me={me} app={app} ctx={ctx} sim={sim} tick={tick} data={data} onAsk={askModus} onClose={closeQuick} />}
      {askOpen && <AskPanel me={me} app={app} ctx={ctx} sim={sim} data={data} onClose={closeAsk} />}
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
