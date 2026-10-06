import { Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Avatar, Badge, cx, EmptyState, Input, Select } from '../../components/ui'
import type { SimObject, SimState } from '@modus-bpm/core'
import { columnAsField } from '@modus-bpm/core/model/conditions'
import { formatFieldValue, objectTitle } from '@modus-bpm/core/model/format'
import { rowsOf, rowText } from '@modus-bpm/core/model/tables'
import type { App, Id, ObjectType, User, WfNode } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

type StatusFilter = 'all' | 'active' | 'completed' | 'rejected'

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

function stateKey(o: SimObject): string {
  return o.status === 'active' ? (o.tokens[0]?.state ?? 'auto') : o.status
}

export function ObjectExplorer({ app, users, sim, version }: { app: App; users: User[]; sim: SimState | undefined; version: number }) {
  const openObject = useUi((s) => s.openObject)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [typeId, setTypeId] = useState<Id | ''>('')
  const [nodeId, setNodeId] = useState<Id | ''>('')
  const [assignee, setAssignee] = useState<Id | ''>('')

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const typesById = useMemo(() => new Map(app.objectTypes.map((t) => [t.id, t])), [app.objectTypes])
  const nodesById = useMemo(() => {
    const m = new Map<Id, WfNode>()
    for (const wf of app.workflows) for (const n of wf.nodes) m.set(n.id, n)
    // Steps the map no longer has, where items on older versions can still be.
    for (const wf of app.workflows) for (const v of [...(wf.versions ?? [])].reverse()) for (const n of v.snapshot.nodes) if (!m.has(n.id)) m.set(n.id, n)
    return m
  }, [app.workflows])

  // Search text per object, rebuilt only when its history grows (every data change is audited).
  const searchCache = useRef(new Map<Id, { len: number; text: string }>())
  const cacheOwner = useRef<SimState | undefined>(undefined)
  if (cacheOwner.current !== sim) {
    // A reset simulation reuses object ids; start the cache over.
    searchCache.current.clear()
    cacheOwner.current = sim
  }
  const searchText = (o: SimObject): string => {
    const hit = searchCache.current.get(o.id)
    if (hit && hit.len === o.history.length) return hit.text
    const type = typesById.get(o.typeId)
    const parts = [o.number]
    for (const f of type?.fields ?? []) {
      const v = formatFieldValue(f, o.data[f.id], app.lists, users)
      if (v) parts.push(v)
      // Line items are searchable by their contents, not just "3 rows".
      if (f.type === 'table') for (const r of rowsOf(o.data[f.id])) parts.push(rowText(f, r, (c, cv) => formatFieldValue(columnAsField(c), cv, app.lists, users)))
    }
    const text = parts.join(' \u0001 ').toLowerCase()
    searchCache.current.set(o.id, { len: o.history.length, text })
    return text
  }

  // While the simulation runs this re-renders every tick; refilter about twice a second.
  // When paused, every change (fast-forward, admin actions) refilters immediately.
  const running = useSim((s) => s.running)
  const bucket = running ? Math.floor(version / 5) : version
  const { rows, total } = useMemo(() => {
    if (!sim) return { rows: [] as SimObject[], total: 0 }
    const q = query.trim().toLowerCase()
    const all = Object.values(sim.objects)
    const matched: SimObject[] = []
    for (const o of all) {
      if (status !== 'all' && (status === 'rejected' ? o.status !== 'rejected' && o.status !== 'cancelled' : o.status !== status)) continue
      if (typeId && o.typeId !== typeId) continue
      if (nodeId && !o.tokens.some((t) => t.nodeId === nodeId || t.calls.some((c) => c.nodeId === nodeId))) continue
      if (assignee && !o.tokens.some((t) => t.userId === assignee)) continue
      if (q && !searchText(o).includes(q)) continue
      matched.push(o)
    }
    matched.sort((a, b) => b.createdAt - a.createdAt || b.number.localeCompare(a.number))
    return { rows: matched.slice(0, ROW_LIMIT), total: matched.length }
  }, [sim, bucket, query, status, typeId, nodeId, assignee, typesById])

  // Summary columns come from one object type: the only one, or the one filtered to.
  const columnType: ObjectType | undefined = app.objectTypes.length === 1 ? app.objectTypes[0] : typeId ? typesById.get(typeId) : undefined
  const summaryFields = columnType ? columnType.fields.filter((f) => f.summary && f.id !== columnType.titleFieldId) : []
  const clock = sim?.clock ?? 0
  const stepOptions = app.workflows.map((wf) => ({ wf, nodes: wf.nodes.filter((n) => n.type !== 'start' && n.type !== 'decision') }))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number, vendor, amount, any field…" className="pl-8" aria-label="Search objects" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-auto" aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </Select>
        {app.objectTypes.length > 1 && (
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-auto" aria-label="Object type">
            <option value="">All types</option>
            {app.objectTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.pluralName}
              </option>
            ))}
          </Select>
        )}
        <Select value={nodeId} onChange={(e) => setNodeId(e.target.value)} className="w-auto max-w-[200px]" aria-label="Step">
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
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-auto max-w-[190px]" aria-label="Assignee">
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{total > ROW_LIMIT ? `Showing ${ROW_LIMIT} of ${total.toLocaleString()}` : `${total.toLocaleString()} ${total === 1 ? 'object' : 'objects'}`}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Search size={26} />} title={sim && Object.keys(sim.objects).length ? 'Nothing matches these filters' : 'No objects yet'}>
          {sim && Object.keys(sim.objects).length ? 'Try a different search or clear a filter.' : 'Run the simulation or create an object from the workflow designer.'}
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
                const tok = o.tokens[0]
                const node = nodesById.get(tok?.nodeId ?? o.endNodeId ?? '')
                const holder = o.tokens.find((t) => t.userId)
                const user = holder?.userId ? usersById.get(holder.userId) : undefined
                const badge = STATE_BADGE[stateKey(o)] ?? { label: stateKey(o), tone: 'slate' as const }
                const more = o.tokens.length > 1 ? o.tokens.length - 1 : 0
                const age = (o.completedAt ?? clock) - o.createdAt
                return (
                  <tr key={o.id} onClick={() => openObject(o.id)} className="cursor-pointer border-b border-slate-100 tabular-nums last:border-0 hover:bg-slate-50">
                    <td className="py-1.5 pr-2 pl-4">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-brand-700">
                        <TypeIcon name={type?.icon ?? 'file'} size={13} className="text-slate-400" />
                        {o.number}
                      </span>
                    </td>
                    <td className="max-w-[200px] truncate px-2 py-1.5 text-slate-800">{objectTitle(type, o.data, app.lists, users) || <span className="text-slate-400">—</span>}</td>
                    {summaryFields.map((f) => (
                      <td key={f.id} className={cx('max-w-[180px] truncate px-2 py-1.5 text-slate-700', (f.type === 'currency' || f.type === 'number') && 'text-right')}>
                        {formatFieldValue(f, o.data[f.id], app.lists, users) || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-slate-700">
                      {node?.data.label ?? <span className="text-slate-400">{o.status === 'active' ? 'Removed step' : '—'}</span>}
                      {more > 0 && <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-semibold text-indigo-700" title="Parallel branches">+{more}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {user ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-700">
                          <Avatar name={user.name} color={user.color} size={18} />
                          {user.name}
                        </span>
                      ) : (
                        <span className="text-slate-400">{o.status === 'active' && tok?.state === 'unassigned' ? 'Unassigned' : '—'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td className="py-1.5 pr-4 pl-2 text-right text-slate-600">{formatDuration(age)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
