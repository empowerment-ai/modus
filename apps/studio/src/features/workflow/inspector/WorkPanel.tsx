import { Scale, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Avatar, Badge, Button, cx, EmptyState, Meter, Select } from '../../../components/ui'
import { DISTRIBUTION } from '../../../components/icons'
import { activeTokens, adminAssign, adminRedistribute, adminReturnToPool, type Token } from '@throughline/core'
import { objectTitle } from '@throughline/core/model/format'
import type { App, User, WfNode, Workflow } from '@throughline/core/model/types'
import { currencyShort, formatDuration } from '@throughline/core/model/util'
import { useDesign } from '../../../store/design'
import { useSim, useSimState, useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { Section } from './common'

type UserStep = Extract<WfNode, { type: 'user' }>

const STATE_BADGE: Record<string, { label: string; tone: 'slate' | 'brand' | 'green' | 'amber' | 'red' }> = {
  unassigned: { label: 'Waiting', tone: 'amber' },
  assigned: { label: 'In basket', tone: 'brand' },
  working: { label: 'Working', tone: 'green' },
  stuck: { label: 'Stuck', tone: 'red' },
  queued: { label: 'Queued', tone: 'amber' },
  joining: { label: 'Joining', tone: 'slate' },
  waiting: { label: 'Timer', tone: 'slate' },
}

/** Live work at a user step: who has what, and the administrator's levers to rebalance it. */
export function WorkPanel({ app, wf, node }: { app: App; wf: Workflow; node: UserStep }) {
  const sim = useSimState()
  const view = useSimView()
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const m = view?.nodes[node.id]
  const d = node.data
  const group = groups.find((g) => g.id === d.groupId)
  const memberIds = d.distribution === 'direct' ? (d.userId ? [d.userId] : []) : (group?.memberIds ?? [])
  const members = memberIds.map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u)
  const type = app.objectTypes.find((t) => t.id === wf.objectTypeId)
  const amountField = type?.fields.find((f) => f.type === 'currency')

  const items = useMemo(() => {
    if (!sim) return [] as Token[]
    return activeTokens(sim)
      .filter((t) => t.nodeId === node.id)
      .sort((a, b) => a.enteredAt - b.enteredAt)
  }, [sim, node.id, view])

  if (!sim || !m) return <EmptyState title="No simulation yet">Run the simulation to see work arrive at this step.</EmptyState>

  const maxLoad = Math.max(3, ...members.map((u) => (m.byUser[u.id]?.assigned ?? 0) + (m.byUser[u.id]?.working ?? 0)))
  const movable = m.unassigned + m.assigned
  const dist = DISTRIBUTION[d.distribution]

  const redistribute = () => {
    const moved = useSim.getState().act((s, ctx) => adminRedistribute(s, ctx, node.id))
    useUi.getState().toast(moved ? `Redistributed ${moved} item${moved === 1 ? '' : 's'} evenly across ${group?.name ?? 'the group'}.` : 'Work is already evenly spread.', moved ? 'success' : 'info')
  }

  const reassign = (t: Token, userId: string) => {
    const r = useSim.getState().act((s, ctx) => (userId ? adminAssign(s, ctx, t.id, userId) : adminReturnToPool(s, ctx, t.id)))
    if (!r.ok) useUi.getState().toast(r.error, 'warn')
  }

  return (
    <div>
      <Section title="Right now">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label={d.distribution === 'manager' ? 'To hand out' : 'Waiting'} value={m.unassigned} tone={m.unassigned ? 'amber' : undefined} />
          <Stat label="In baskets" value={m.assigned} />
          <Stat label="Working" value={m.working} tone={m.working ? 'green' : undefined} />
          <Stat label="Oldest" value={formatDuration(m.oldestAge)} tone={m.slaBreaches ? 'red' : undefined} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-3 text-[11.5px] text-slate-500">
          <span>
            Avg wait <b className="font-semibold text-slate-700">{formatDuration(m.avgWait)}</b>
          </span>
          <span>
            Avg time here <b className="font-semibold text-slate-700">{formatDuration(m.avgTime)}</b>
          </span>
          <span>
            Released <b className="font-semibold text-slate-700">{m.exited}</b>
          </span>
          {m.slaBreaches > 0 && (
            <span className="flex items-center gap-1 font-medium text-rose-600">
              <TriangleAlert size={11} /> {m.slaBreaches} past SLA
            </span>
          )}
        </div>
      </Section>

      <Section
        title={`Workload · ${d.distribution === 'direct' ? 'direct' : (group?.name ?? 'no group')}`}
        hint={dist.help}
        action={
          d.distribution !== 'direct' && (
            <Button size="sm" variant="primary" icon={<Scale size={13} />} disabled={!movable} onClick={redistribute} title="Spread everything not yet being worked evenly across available members">
              {d.distribution === 'manager' && m.unassigned ? 'Hand out evenly' : 'Redistribute'}
            </Button>
          )
        }
      >
        <ul className="space-y-1.5">
          {members.map((u) => {
            const l = m.byUser[u.id] ?? { assigned: 0, working: 0 }
            const total = l.assigned + l.working
            return (
              <li key={u.id} className="flex items-center gap-2">
                <Avatar name={u.name} color={u.color} size={22} />
                <span className={cx('w-[108px] truncate text-xs', u.available ? 'text-slate-700' : 'text-slate-400 line-through')}>{u.name}</span>
                <Meter value={total} max={maxLoad} className="flex-1" color={u.available ? 'var(--color-brand-500)' : '#fbbf24'} />
                <span className="w-[54px] text-right text-[11px] text-slate-500 tabular-nums">
                  {total}
                  {l.working ? <span className="text-emerald-600"> · 1▶</span> : ''}
                </span>
                {!u.available && <Badge tone="amber">Out</Badge>}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={`Items here (${items.length})`} hint="Reassign any item, or send it back to the pool.">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing at this step right now.</p>
        ) : (
          <ul className="-mx-1 divide-y divide-slate-100">
            {items.slice(0, 80).map((t) => {
              const o = sim.objects[t.objectId]!
              const b = STATE_BADGE[t.state] ?? { label: t.state, tone: 'slate' as const }
              return (
                <li key={t.id} className="flex items-center gap-2 px-1 py-1.5">
                  <button type="button" onClick={() => useUi.getState().openObject(o.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-brand-700 hover:underline">{o.number}</span>
                      <Badge tone={b.tone}>{b.label}</Badge>
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {objectTitle(type, o.data, app.lists, users)}
                      {amountField && o.data[amountField.id] !== undefined ? ` · ${currencyShort.format(Number(o.data[amountField.id]))}` : ''} · {formatDuration(sim.clock - t.enteredAt)}
                    </div>
                  </button>
                  <div className="w-[138px] shrink-0">
                    <Select className="h-7 text-xs" value={t.userId ?? ''} disabled={t.state === 'stuck'} onChange={(e) => reassign(t, e.target.value)} aria-label={`Assignee for ${o.number}`}>
                      <option value="">{d.distribution === 'queue' ? '— Queue —' : d.distribution === 'manager' ? '— Supervisor —' : '— Pool —'}</option>
                      <optgroup label={d.distribution === 'direct' ? 'Assignee' : (group?.name ?? 'Group')}>
                        {members.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.available ? '' : ' (out)'}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Everyone else">
                        {users
                          .filter((u) => !members.some((mm) => mm.id === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                              {u.available ? '' : ' (out)'}
                            </option>
                          ))}
                      </optgroup>
                    </Select>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {items.length > 80 && <p className="mt-2 text-[11px] text-slate-500">Showing the 80 oldest of {items.length}.</p>}
      </Section>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'amber' | 'green' | 'red' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1 py-2">
      <div className={cx('text-lg leading-none font-semibold tabular-nums', tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : tone === 'red' ? 'text-rose-600' : 'text-slate-800')}>
        {value}
      </div>
      <div className="mt-1 text-[10px] font-medium tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  )
}
