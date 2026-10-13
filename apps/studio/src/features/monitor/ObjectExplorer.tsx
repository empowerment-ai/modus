import { RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Avatar, Badge, Button, cx, EmptyState, Input, Select } from '../../components/ui'
import { explorerCache, exploreItems, explorerRow, type ExplorerRow, type ExplorerStatus, explorerSteps, type SimObject, type SimState } from '@modus-bpm/core'
import type { App, Id, ObjectType, User } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { liveStore } from '../../server/live'
import { useLive } from '../../server/useLive'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

const ROW_LIMIT = 200

const STATE_BADGE: Record<string, { label: string; tone: 'slate' | 'brand' | 'green' | 'amber' | 'red' | 'sky' | 'violet' }> = {
  unassigned: { label: 'Waiting', tone: 'amber' },
  queued: { label: 'Queued', tone: 'amber' },
  joining: { label: 'Joining', tone: 'slate' },
  waiting: { label: 'Timer', tone: 'slate' },
  assigned: { label: 'Assigned', tone: 'sky' },
  working: { label: 'Working', tone: 'brand' },
  stuck: { label: 'Stuck', tone: 'red' },
  auto: { label: 'Automated', tone: 'violet' },
  completed: { label: 'Done', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}

/** The explorer's filters; '' is "any". */
export interface ExplorerFilters {
  q: string
  status: ExplorerStatus
  type: Id | ''
  step: Id | ''
  assignee: Id | ''
}

const noFilters: ExplorerFilters = { q: '', status: 'all', type: '', step: '', assignee: '' }

/** The simulation's explorer: filtered in the browser over every simulated object. */
export function SimExplorer({ app, users, sim, version }: { app: App; users: User[]; sim: SimState | undefined; version: number }) {
  const openObject = useUi((s) => s.openObject)
  const [filters, setFilters] = useState(noFilters)
  const { q: query, status, type: typeId, step: nodeId, assignee } = filters

  // Search text per item for this app (the explorer is keyed by app); a reset simulation starts it over.
  const [cache] = useState(explorerCache)
  const cacheOwner = useRef(sim)
  if (cacheOwner.current !== sim) {
    cache.entries.clear()
    cacheOwner.current = sim
  }

  // While the simulation runs this re-renders every tick; refilter about twice a second.
  // When paused, every change (fast-forward, admin actions) refilters immediately.
  const running = useSim((s) => s.running)
  const bucket = running ? Math.floor(version / 5) : version
  // The same filters, search and order as the server's explorer (core), which caches search text per item.
  const { matched, total } = useMemo(() => {
    if (!sim) return { matched: [] as SimObject[], total: 0 }
    const r = exploreItems(sim, { app, users }, { status, typeId, stepId: nodeId, assignee, q: query }, { limit: ROW_LIMIT, cache })
    return { matched: r.items, total: r.total }
  }, [sim, bucket, query, status, typeId, nodeId, assignee, app, users, cache])

  // Includes steps the map no longer has, where items on older versions can still be.
  const steps = useMemo(() => explorerSteps(app), [app])
  const clock = sim?.clock ?? 0
  // The same rows the server's explorer sends, so both modes draw from one shape.
  const rows = matched.map((o) => explorerRow(o, { app, users }, clock, steps))
  const any = !!sim && Object.keys(sim.objects).length > 0

  return (
    <ExplorerTable
      app={app}
      users={users}
      filters={filters}
      onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      rows={rows}
      count={total > ROW_LIMIT ? `Showing ${ROW_LIMIT} of ${total.toLocaleString()}` : countText(total)}
      empty={any ? undefined : { title: 'No objects yet', text: 'Run the simulation or create an object from the workflow designer.' }}
      onOpenItem={openObject}
    />
  )
}

const countText = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'object' : 'objects'}`

/** The server's explorer: filtered and paged by the server; the search waits for a pause in typing. */
export function LiveExplorer({ app, users }: { app: App; users: User[] }) {
  const ex = useLive((s) => s.explorer)
  const [q, setQ] = useState(ex.filters.q)
  useEffect(() => {
    if (q === liveStore.getState().explorer.filters.q) return
    const t = setTimeout(() => liveStore.getState().setFilters({ q }), 300)
    return () => clearTimeout(t)
  }, [q])

  const f = ex.filters
  const filters: ExplorerFilters = { q, status: f.status, type: f.type ?? '', step: f.step ?? '', assignee: f.assignee ?? '' }
  const onFilters = (patch: Partial<ExplorerFilters>) => {
    if (patch.q !== undefined) setQ(patch.q)
    const { q: _q, ...rest } = patch
    if (!Object.keys(rest).length) return
    const none = (v: string | undefined) => (v === '' ? undefined : v)
    liveStore.getState().setFilters({
      ...(rest.status ? { status: rest.status } : {}),
      ...('type' in rest ? { type: none(rest.type) } : {}),
      ...('step' in rest ? { step: none(rest.step) } : {}),
      ...('assignee' in rest ? { assignee: none(rest.assignee) } : {}),
    })
  }
  const shown = ex.rows.length
  // The live refetch re-reads at most the server's page limit; rows past it keep what they said when loaded.
  const maybeStale = shown > ROW_LIMIT

  return (
    <ExplorerTable
      app={app}
      users={users}
      filters={filters}
      onFilters={onFilters}
      rows={ex.rows}
      count={ex.loading && !shown ? 'Loading…' : ex.total > shown ? `Showing ${shown.toLocaleString()} of ${ex.total.toLocaleString()}` : countText(ex.total)}
      footer={
        (ex.next || maybeStale) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-2">
            {maybeStale && (
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-amber-800">
                <TriangleAlert size={13} className="shrink-0" />
                Rows past the first {ROW_LIMIT} aren’t refreshed live, so they may be out of date.
                <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => liveStore.getState().setFilters({})}>
                  Refresh
                </Button>
              </p>
            )}
            {ex.next && (
              <Button size="sm" className="ml-auto" disabled={ex.loading} onClick={() => void liveStore.getState().loadMore()}>
                {ex.loading ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )
      }
    />
  )
}

/** Filters, table and footer: the same in both modes. `empty` replaces "nothing matches" when there's nothing at all. */
function ExplorerTable({
  app,
  users,
  filters,
  onFilters,
  rows,
  count,
  empty,
  footer,
  onOpenItem,
}: {
  app: App
  users: User[]
  filters: ExplorerFilters
  onFilters: (patch: Partial<ExplorerFilters>) => void
  rows: ExplorerRow[]
  count: string
  empty?: { title: string; text: string }
  footer?: ReactNode
  onOpenItem?: (id: Id) => void
}) {
  const { q: query, status, type: typeId, step: nodeId, assignee } = filters
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const typesById = useMemo(() => new Map(app.objectTypes.map((t) => [t.id, t])), [app.objectTypes])
  // Summary columns come from one object type: the only one, or the one filtered to.
  const columnType: ObjectType | undefined = app.objectTypes.length === 1 ? app.objectTypes[0] : typeId ? typesById.get(typeId) : undefined
  const summaryFields = columnType ? columnType.fields.filter((f) => f.summary && f.id !== columnType.titleFieldId) : []
  const stepOptions = app.workflows.map((wf) => ({ wf, nodes: wf.nodes.filter((n) => n.type !== 'start' && n.type !== 'decision') }))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => onFilters({ q: e.target.value })} placeholder="Search number, vendor, amount, any field…" className="pl-8" aria-label="Search objects" />
        </div>
        <Select value={status} onChange={(e) => onFilters({ status: e.target.value as ExplorerStatus })} className="w-auto" aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </Select>
        {app.objectTypes.length > 1 && (
          <Select value={typeId} onChange={(e) => onFilters({ type: e.target.value })} className="w-auto" aria-label="Object type">
            <option value="">All types</option>
            {app.objectTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.pluralName}
              </option>
            ))}
          </Select>
        )}
        <Select value={nodeId} onChange={(e) => onFilters({ step: e.target.value })} className="w-auto max-w-[200px]" aria-label="Step">
          <option value="">Any step</option>
          {stepOptions.map(({ wf, nodes }) =>
            app.workflows.length > 1 ? (
              <optgroup key={wf.id} label={wf.name}>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.data.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.data.label}
                </option>
              ))
            ),
          )}
        </Select>
        <Select value={assignee} onChange={(e) => onFilters({ assignee: e.target.value })} className="w-auto max-w-[190px]" aria-label="Assignee">
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{count}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Search size={26} />} title={empty?.title ?? 'Nothing matches these filters'}>
          {empty?.text ?? 'Try a different search or clear a filter.'}
        </EmptyState>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
                <th className="py-2 pr-2 pl-4 font-semibold">Number</th>
                <th className="px-2 py-2 font-semibold">{columnType?.fields.find((f) => f.id === columnType.titleFieldId)?.label ?? 'Title'}</th>
                {summaryFields.map((f) => (
                  <th key={f.id} className={cx('px-2 py-2 font-semibold', (f.type === 'currency' || f.type === 'number') && 'text-right')}>
                    {f.label}
                  </th>
                ))}
                <th className="px-2 py-2 font-semibold">Step</th>
                <th className="px-2 py-2 font-semibold">Assignee</th>
                <th className="px-2 py-2 font-semibold">State</th>
                <th className="py-2 pr-4 pl-2 text-right font-semibold">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const type = typesById.get(o.typeId)
                const user = o.assignee ? usersById.get(o.assignee) : undefined
                const badge = STATE_BADGE[o.state] ?? { label: o.state, tone: 'slate' as const }
                return (
                  <tr
                    key={o.id}
                    onClick={onOpenItem && (() => onOpenItem(o.id))}
                    className={cx('border-b border-slate-100 tabular-nums last:border-0 hover:bg-slate-50', onOpenItem && 'cursor-pointer')}
                  >
                    <td className="py-1.5 pr-2 pl-4">
                      <span className={cx('inline-flex items-center gap-1.5 font-mono text-[11px] font-medium', onOpenItem ? 'text-brand-700' : 'text-slate-700')}>
                        <TypeIcon name={type?.icon ?? 'file'} size={13} className="text-slate-400" />
                        {o.number}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-1.5 text-slate-800">{o.title || <span className="text-slate-400">—</span>}</td>
                    {summaryFields.map((f) => (
                      <td key={f.id} className={cx('max-w-[180px] truncate px-2 py-1.5 text-slate-700', (f.type === 'currency' || f.type === 'number') && 'text-right')}>
                        {o.summary[f.id] || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-slate-700">
                      {o.step ?? <span className="text-slate-400">{o.status === 'active' ? 'Removed step' : '—'}</span>}
                      {o.more > 0 && (
                        <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-semibold text-indigo-700" title="Parallel branches">
                          +{o.more}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {user ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                          <Avatar name={user.name} color={user.color} size={18} />
                          {user.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">{o.state === 'unassigned' ? 'Unassigned' : '—'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td className="py-1.5 pr-4 pl-2 text-right text-slate-600">{formatDuration(o.age)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {footer}
    </div>
  )
}
