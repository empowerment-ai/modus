import { Avatar, Badge, cx, Meter } from '../../components/ui'
import type { SimView, WorkingOn } from '@modus-bpm/core'
import type { App, Group, Id, User } from '@modus-bpm/core/model/types'

interface Row {
  user: User
  groups: string[]
  open: number
  working?: WorkingOn
  completed: number
  utilization: number | null
}

/** Everyone who can receive work in this app: members of groups used by user steps, plus direct assignees. */
export function appPeople(app: App, users: User[], groups: Group[]): Array<{ user: User; groups: string[] }> {
  const groupIds = new Set<Id>()
  const direct = new Set<Id>()
  for (const wf of app.workflows)
    for (const n of wf.nodes) {
      if (n.type !== 'user') continue
      if (n.data.groupId) groupIds.add(n.data.groupId)
      if (n.data.distribution === 'direct' && n.data.userId) direct.add(n.data.userId)
    }
  const byUser = new Map<Id, string[]>()
  for (const g of groups) {
    if (!groupIds.has(g.id)) continue
    for (const m of g.memberIds) byUser.set(m, [...(byUser.get(m) ?? []), g.name])
  }
  for (const id of direct) if (!byUser.has(id)) byUser.set(id, [])
  return users.filter((u) => byUser.has(u.id)).map((u) => ({ user: u, groups: byUser.get(u.id)! }))
}

/**
 * `working`: what each person is working on (core's `workingNow`). `utilization` is off on a server, where
 * nobody's time is simulated; `onOpenItem` is left out where the item can't be opened (Live).
 */
export function WorkloadTable({
  app,
  users,
  groups,
  view,
  working,
  clock,
  utilization = true,
  onOpenItem,
}: {
  app: App
  users: User[]
  groups: Group[]
  view: SimView | undefined
  working: Record<Id, WorkingOn>
  clock: number
  utilization?: boolean
  onOpenItem?: (id: Id) => void
}) {
  const rows: Row[] = appPeople(app, users, groups).map(({ user, groups: gs }) => {
    const v = view?.users[user.id]
    const w = working[user.id]
    const busy = (v?.busyMinutes ?? 0) + (w?.startedAt !== undefined ? clock - w.startedAt : 0)
    return {
      user,
      groups: gs,
      open: v?.open ?? 0,
      working: w,
      completed: v?.completed ?? 0,
      utilization: clock > 0 ? Math.min(1, busy / clock) : null,
    }
  })
  rows.sort((a, b) => b.open - a.open || b.completed - a.completed || a.user.name.localeCompare(b.user.name))
  const maxOpen = Math.max(1, ...rows.map((r) => r.open))

  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
            <th className="py-2 pr-2 pl-4 font-semibold">Person</th>
            <th className="w-[150px] px-2 py-2 font-semibold">Open items</th>
            <th className="px-2 py-2 font-semibold">Working on</th>
            <th className={cx('px-2 py-2 text-right font-semibold', !utilization && 'pr-4')}>Done</th>
            {utilization && (
              <th className="py-2 pr-4 pl-2 text-right font-semibold" title="Share of simulated time spent working">
                Utilization
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user.id} className={cx('border-b border-slate-100 tabular-nums last:border-0', !r.user.available && 'bg-amber-50/40')}>
              <td className="py-1.5 pr-2 pl-4">
                <div className="flex items-center gap-2">
                  <Avatar name={r.user.name} color={r.user.color} size={24} />
                  <div className="min-w-0 leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-slate-800">{r.user.name}</span>
                      {!r.user.available && <Badge tone="amber">Out of office</Badge>}
                    </div>
                    <div className="truncate text-[11px] text-slate-500" title={r.groups.join(', ')}>
                      {r.user.title}
                      {r.groups.length > 0 && ` · ${r.groups.join(', ')}`}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 text-right font-semibold text-slate-900">{r.open}</span>
                  <Meter value={r.open} max={maxOpen} className="flex-1" color={!r.user.available && r.open > 0 ? '#d97706' : undefined} />
                </div>
              </td>
              <td className="px-2 py-1.5">
                {r.working ? (
                  <span className="inline-flex items-center gap-1">
                    {onOpenItem ? (
                      <button type="button" onClick={() => onOpenItem(r.working!.itemId)} className="font-mono text-[11px] font-medium text-brand-700 hover:underline">
                        {r.working.number}
                      </button>
                    ) : (
                      <span className="font-mono text-[11px] font-medium text-slate-700">{r.working.number}</span>
                    )}
                    {r.working.also > 0 && (
                      <span className="text-[10px] text-slate-500" title={`${r.working.also} more started and not yet released`}>
                        +{r.working.also}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400">Idle</span>
                )}
              </td>
              <td className={cx('px-2 py-1.5 text-right text-slate-700', !utilization && 'pr-4')}>{r.completed}</td>
              {utilization && <td className="py-1.5 pr-4 pl-2 text-right text-slate-700">{r.utilization === null ? '—' : `${Math.round(r.utilization * 100)}%`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
