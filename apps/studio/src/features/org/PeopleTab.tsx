import { ArrowRightLeft, Search, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar, Badge, Button, cx, IconButton, Input, Toggle } from '../../components/ui'
import { activeTokens, adminRedistribute, adminReturnToPool } from '@modus-bpm/core'
import type { Id, User } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { useDesign } from '../../store/design'
import { useSim, useSimView } from '../../store/sim'
import { useUi } from '../../store/ui'
import { InlineInput } from './InlineInput'
import { userDeleteBlockers } from './usage'

const PALETTE = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#2563eb', '#65a30d', '#0d9488', '#c2410c', '#9333ea']

function speedWord(speed: number): { text: string; tone: 'green' | 'slate' | 'amber' } {
  if (speed < 0.95) return { text: 'Fast', tone: 'green' }
  if (speed > 1.05) return { text: 'Slow', tone: 'amber' }
  return { text: 'Average', tone: 'slate' }
}

/** Take a person's waiting items out of their basket and spread them across each step's available members. */
export function reassignWork(user: User): { returned: number; steps: number } {
  return useSim.getState().act((sim, ctx) => {
    const nodes = new Set<Id>()
    let returned = 0
    for (const t of activeTokens(sim)) {
      if (t.userId === user.id && t.state === 'assigned' && adminReturnToPool(sim, ctx, t.id).ok) {
        returned++
        nodes.add(t.nodeId)
      }
    }
    for (const nodeId of nodes) adminRedistribute(sim, ctx, nodeId)
    return { returned, steps: nodes.size }
  })
}

/** Free typing, committed (and clamped to 0.5–2) on blur, Enter or a spinner click. */
function SpeedInput({ speed, onCommit }: { speed: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(speed))
  useEffect(() => setText(String(speed)), [speed])
  const commit = (raw: string) => {
    const v = Number(raw)
    if (raw.trim() === '' || Number.isNaN(v)) return setText(String(speed))
    const clamped = Math.round(Math.min(2, Math.max(0.5, v)) * 100) / 100
    setText(String(clamped))
    if (clamped !== speed) onCommit(clamped)
  }
  return (
    <div className="relative">
      <Input
        aria-label="Handling speed multiplier"
        type="number"
        min={0.5}
        max={2}
        step={0.05}
        className="h-7 w-[72px] pr-5 tabular-nums"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          // Spinner arrows produce complete values; commit those immediately.
          if ((e.nativeEvent as InputEvent).inputType === undefined) commit(e.target.value)
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-slate-400">×</span>
    </div>
  )
}

export function PeopleTab() {
  const users = useDesign((s) => s.design.users)
  const groups = useDesign((s) => s.design.groups)
  const update = useDesign((s) => s.update)
  const toast = useUi((s) => s.toast)
  const view = useSimView()
  const [q, setQ] = useState('')
  const [focusId, setFocusId] = useState<Id | null>(null)

  const query = q.trim().toLowerCase()
  const shown = users.filter(
    (u) =>
      !query ||
      u.name.toLowerCase().includes(query) ||
      u.title.toLowerCase().includes(query) ||
      groups.some((g) => g.memberIds.includes(u.id) && g.name.toLowerCase().includes(query)),
  )
  const outCount = users.filter((u) => !u.available).length

  const patch = (id: Id, fn: (u: User) => void) =>
    update((d) => {
      const u = d.users.find((x) => x.id === id)
      if (u) fn(u)
    })

  const setAvailable = (u: User, on: boolean) => {
    patch(u.id, (x) => {
      x.available = on
    })
    if (on) {
      toast(`${u.name} is back and can receive work again.`, 'success')
      return
    }
    const w = view?.users[u.id]
    const waiting = w ? w.open - (w.working ? 1 : 0) : 0
    if (waiting > 0)
      toast(`${u.name} is out of office. ${waiting} item${waiting === 1 ? '' : 's'} in their basket will wait — use “Reassign their work” to move ${waiting === 1 ? 'it' : 'them'}.`, 'warn')
    else toast(`${u.name} is out of office and will not receive new work.`)
  }

  const onReassign = (u: User) => {
    const { returned, steps } = reassignWork(u)
    if (returned === 0) toast(`${u.name} has no waiting items to reassign. Work already in progress stays with them.`)
    else toast(`Took ${returned} item${returned === 1 ? '' : 's'} from ${u.name}’s basket and redistributed across ${steps} step${steps === 1 ? '' : 's'}.`, 'success')
  }

  const addPerson = () => {
    const id = uid('u')
    update((d) => {
      d.users.push({ id, name: 'New person', title: 'Team member', color: PALETTE[d.users.length % PALETTE.length]!, speed: 1, available: true })
    })
    setQ('')
    setFocusId(id)
  }

  const removePerson = (u: User) => {
    const reasons = userDeleteBlockers(useDesign.getState().design, u.id)
    if (reasons.length) {
      toast(`Can’t remove ${u.name}: ${reasons.join('; ')}.`, 'warn')
      return
    }
    if (!window.confirm(`Remove ${u.name} from the organization and all groups?`)) return
    update((d) => {
      d.users = d.users.filter((x) => x.id !== u.id)
      for (const g of d.groups) g.memberIds = g.memberIds.filter((m) => m !== u.id)
    })
    toast(`${u.name} removed.`)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative w-72">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <Input className="pl-8" placeholder="Search people, titles or groups" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="text-xs text-slate-500">
          {users.length} people{outCount > 0 && <span className="text-amber-700"> · {outCount} out of office</span>}
        </span>
        <div className="flex-1" />
        <Button variant="primary" icon={<UserPlus size={14} />} onClick={addPerson}>
          Add person
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Groups</th>
              <th className="px-3 py-2" title="Multiplies each step's average handling time. 0.8 means 20% faster than average.">
                Handling speed
              </th>
              <th className="px-3 py-2">Availability</th>
              <th className="px-3 py-2">Live workload</th>
              <th className="w-px px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((u) => {
              const memberOf = groups.filter((g) => g.memberIds.includes(u.id))
              const supervises = groups.filter((g) => g.supervisorId === u.id)
              const w = view?.users[u.id]
              const waiting = w ? w.open - (w.working ? 1 : 0) : 0
              const sw = speedWord(u.speed)
              return (
                <tr key={u.id} className={cx('align-middle', !u.available && 'bg-amber-50/40')}>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.name} color={u.color} size={26} />
                      <InlineInput
                        aria-label="Name"
                        className="font-medium"
                        value={u.name}
                        autoFocus={focusId === u.id}
                        onFocus={(e) => focusId === u.id && e.target.select()}
                        onChange={(e) => patch(u.id, (x) => void (x.name = e.target.value))}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <InlineInput aria-label="Title" className="text-slate-600" value={u.title} onChange={(e) => patch(u.id, (x) => void (x.title = e.target.value))} />
                  </td>
                  <td className="max-w-[260px] px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {memberOf.slice(0, 3).map((g) => (
                        <Badge key={g.id}>{g.name}</Badge>
                      ))}
                      {memberOf.length > 3 && <Badge>+{memberOf.length - 3}</Badge>}
                      {supervises.map((g) => (
                        <Badge key={`s${g.id}`} tone="violet">
                          Supervises {g.name}
                        </Badge>
                      ))}
                      {!memberOf.length && !supervises.length && <span className="text-xs text-slate-400">No groups</span>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <SpeedInput speed={u.speed} onCommit={(v) => patch(u.id, (x) => void (x.speed = v))} />
                      <Badge tone={sw.tone}>{sw.text}</Badge>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Toggle checked={u.available} onChange={(on) => setAvailable(u, on)} label={<span className="sr-only">Available</span>} />
                      {u.available ? <span className="text-xs text-slate-500">Available</span> : <Badge tone="amber">Out of office</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {w ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className={cx('tabular-nums font-semibold', w.open ? 'text-slate-800' : 'text-slate-400')} title="Open items assigned to this person">
                          {w.open} open
                        </span>
                        {w.working && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                            working
                          </span>
                        )}
                        <span className="text-slate-400 tabular-nums">{w.completed} done</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      {waiting > 0 && (
                        <Button
                          size="sm"
                          variant={u.available ? 'ghost' : 'secondary'}
                          className={cx(!u.available && 'border-amber-300 text-amber-800 hover:bg-amber-50')}
                          icon={<ArrowRightLeft size={13} />}
                          onClick={() => onReassign(u)}
                          title={`Move ${waiting} waiting item${waiting === 1 ? '' : 's'} to other members of each step's group`}
                        >
                          Reassign their work
                        </Button>
                      )}
                      <IconButton label={`Remove ${u.name}`} onClick={() => removePerson(u)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                  No one matches “{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Handling speed and availability drive the simulation: an out-of-office person gets no new work, and anything already in their basket waits until it is reassigned.
      </p>
    </div>
  )
}
