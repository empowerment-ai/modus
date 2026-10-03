import { ArrowRight, Clock, Search, Sparkles } from 'lucide-react'
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '../../components/ui'
import type { Ctx, SimState } from '@modus-bpm/core'
import type { App, User } from '@modus-bpm/core/model/types'
import { openFound } from './actions'
import type { WorkData } from './live'
import { highlightWords, MOD_KEY, SearchHitRow, useItemSearch } from './searchParts'
import { useWorkspace } from './store'

const SHOW = 8

const STARTERS = ['is:mine', 'is:overdue', 'is:expedited is:open', 'creator:me']

/** ⌘K / "/": search from anywhere in the Workspace. Enter opens the highlighted item; ⌘Enter shows every result. */
export function QuickSearch({
  me,
  app,
  ctx,
  sim,
  tick,
  data,
  onAsk,
  onClose,
}: {
  me: User
  app: App
  ctx: Ctx
  sim: SimState | undefined
  tick: string
  data: WorkData
  onAsk: (question: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const recent = useWorkspace((s) => s.recent[app.id]) ?? []
  const { result, settled } = useItemSearch(sim, ctx, me.id, query, tick, { limit: SHOW })
  const hits = result?.hits ?? []
  const words = useMemo(() => highlightWords(result?.query), [result?.query])
  const held = useMemo(() => new Set(data.basket.map((i) => i.obj.id)), [data.basket])
  const listRef = useRef<HTMLDivElement>(null)
  const typed = query.trim()
  // Results, then "See all" as the last choice.
  const choices = typed ? hits.length + 1 : 0

  useEffect(() => {
    setActive(0)
  }, [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ws = useWorkspace.getState()
  const openHit = (objectId: string) => {
    ws.remember(app.id, typed)
    onClose()
    openFound(objectId, data.basket)
  }
  const seeAll = () => {
    ws.remember(app.id, typed)
    onClose()
    ws.search(typed)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (choices) setActive((a) => (e.key === 'ArrowDown' ? Math.min(choices - 1, a + 1) : Math.max(0, a - 1)))
    } else if (e.key === 'Enter' && typed) {
      e.preventDefault()
      const hit = hits[active]
      if (e.metaKey || e.ctrlKey || !hit) seeAll()
      else openHit(hit.obj.id)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[12vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        className="animate-slide-in flex max-h-[76vh] w-full max-w-[660px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-4">
          <Search size={17} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by number, words or filters…"
            aria-label="Search items"
            role="combobox"
            aria-expanded={choices > 0}
            aria-controls="quick-search-results"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none! placeholder:text-slate-400"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} id="quick-search-results" role="listbox" aria-label="Results" className={cx('min-h-0 flex-1 overflow-y-auto', !settled && 'opacity-70')}>
          {!typed ? (
            <div className="space-y-3 px-4 py-3">
              {recent.length > 0 && (
                <div>
                  <p className="mb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Recent</p>
                  {recent.slice(0, 5).map((q) => (
                    <button key={q} type="button" onClick={() => setQuery(q)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50">
                      <Clock size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate font-mono text-[12px] text-slate-700">{q}</span>
                    </button>
                  ))}
                </div>
              )}
              <div>
                <p className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Try</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQuery(q)}
                      className="hover:border-brand-300 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11.5px] text-brand-700 hover:bg-brand-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Type a number, any words, or filters.{' '}
                  <button type="button" className="font-medium text-brand-700 hover:underline" onClick={seeAll}>
                    Open Search
                  </button>{' '}
                  for every filter and tip.
                </p>
              </div>
            </div>
          ) : (
            <>
              {result && hits.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-slate-500">Nothing you can see matches “{typed}”.</p>}
              <ul className="divide-y divide-slate-100">
                {hits.map((h, i) => (
                  <li key={h.obj.id} role="option" aria-selected={i === active}>
                    <SearchHitRow
                      hit={h}
                      ctx={ctx}
                      userId={me.id}
                      words={words}
                      clock={sim?.clock ?? 0}
                      held={held.has(h.obj.id)}
                      compact
                      active={i === active}
                      onHover={() => setActive(i)}
                      onOpen={() => openHit(h.obj.id)}
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                role="option"
                aria-selected={active === hits.length}
                data-active={active === hits.length || undefined}
                onMouseMove={() => setActive(hits.length)}
                onClick={seeAll}
                className={cx(
                  'flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-[13px] font-medium text-brand-700',
                  active === hits.length ? 'bg-brand-50' : 'hover:bg-slate-50',
                )}
              >
                <Search size={14} />
                <span className="flex-1">{result && result.total > hits.length ? `See all ${result.total.toLocaleString()} results in Search` : 'Open in Search, with filters'}</span>
                <ArrowRight size={14} />
              </button>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Enter</Kbd> open
          </span>
          <span>
            <Kbd>{MOD_KEY}Enter</Kbd> all results
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              onClose()
              onAsk(typed)
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50"
          >
            <Sparkles size={12} /> {typed ? 'Ask Modus instead' : 'Ask Modus'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-slate-200 bg-white px-1 py-px font-sans text-[10.5px] font-medium text-slate-600 shadow-xs">{children}</kbd>
}
