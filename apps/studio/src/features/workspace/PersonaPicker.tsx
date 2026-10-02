import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useClickOutside } from '../../components/Shell'
import { Avatar, cx, Input } from '../../components/ui'
import type { Ctx } from '@modus-bpm/core'
import type { User } from '@modus-bpm/core/model/types'
import { useUi } from '../../store/ui'
import { roleHints } from './personas'

/** "Working as": pick the person whose basket, queues and requests you see. No sign-in in the prototype. */
export function PersonaPicker({ me, people, suggested, ctx }: { me: User; people: User[]; suggested: Array<{ user: User; role: string }>; ctx: Ctx }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const hints = useMemo(() => new Map(people.map((u) => [u.id, roleHints(ctx, u.id)])), [people, ctx])
  const q = query.trim().toLowerCase()
  const matches = q ? people.filter((u) => `${u.name} ${u.title} ${(hints.get(u.id) ?? []).join(' ')}`.toLowerCase().includes(q)) : people

  const pick = (u: User) => {
    useUi.getState().setActingAs(u.id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left shadow-xs hover:border-slate-300 hover:bg-slate-50"
      >
        <Avatar name={me.name} color={me.color} size={30} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">Working as</span>
          <span className="block truncate text-sm font-semibold text-slate-900">{me.name}</span>
          <span className="block truncate text-[11px] text-slate-500">{me.title}</span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <div className="animate-slide-in absolute top-full left-0 z-40 mt-1.5 w-[380px] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches[0]) pick(matches[0])
                  if (e.key === 'Escape') setOpen(false)
                }}
                placeholder="Search people, titles or steps…"
                className="pl-8"
                aria-label="Search people"
              />
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-1.5" role="listbox" aria-label="People">
            {!q && suggested.length > 0 && (
              <>
                <p className="px-2 pt-1 pb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Suggested</p>
                {suggested.map(({ user, role }) => (
                  <PersonRow key={user.id} user={user} role={role} hints={hints.get(user.id) ?? []} active={user.id === me.id} onPick={pick} />
                ))}
                <div className="my-1.5 h-px bg-slate-100" />
                <p className="px-2 pt-1 pb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Everyone in {ctx.app.name}</p>
              </>
            )}
            {matches.map((u) => (
              <PersonRow key={u.id} user={u} hints={hints.get(u.id) ?? []} active={u.id === me.id} onPick={pick} />
            ))}
            {matches.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-500">No one matches “{query}”.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function PersonRow({ user, role, hints, active, onPick }: { user: User; role?: string; hints: string[]; active: boolean; onPick: (u: User) => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={() => onPick(user)}
      className={cx('flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
    >
      <Avatar name={user.name} color={user.color} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-slate-900">{user.name}</span>
          {role && <span className="rounded bg-brand-50 px-1.5 py-px text-[10.5px] font-semibold text-brand-700">{role}</span>}
          {!user.available && <span className="rounded bg-slate-100 px-1.5 py-px text-[10.5px] font-medium text-slate-700">Out</span>}
        </span>
        <span className="block truncate text-[11px] text-slate-500">{user.title}</span>
        {hints.length > 0 && <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{hints.slice(0, 3).join(' · ')}</span>}
      </span>
      {active && <Check size={14} className="mt-1 shrink-0 text-brand-600" />}
    </button>
  )
}
