import { Check, Clock, Search, SearchX, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, cx, EmptyState, Segmented } from '../../components/ui'
import type { Ctx, SimState } from '@modus-bpm/core'
import type { App, Group, User } from '@modus-bpm/core/model/types'
import { openFound } from './actions'
import type { WorkData } from './live'
import { PageHeader } from './parts'
import { ItemReadView } from './RequestsPage'
import { facetGroups, highlightWords, MOD_KEY, SearchHitRow, SearchTips, splitQuery, TipsList, toggleToken, useItemSearch, withoutTokens } from './searchParts'
import { type SearchSort, useWorkspace } from './store'

interface Props {
  me: User
  app: App
  ctx: Ctx
  users: User[]
  groups: Group[]
  sim: SimState | undefined
  tick: string
  data: WorkData
  /** Ask Modus a question (opens the panel). */
  onAsk: (question: string) => void
}

const SORTS: Array<{ value: SearchSort; label: string; title: string }> = [
  { value: 'relevance', label: 'Best match', title: 'Best matches first' },
  { value: 'newest', label: 'Newest', title: 'Most recently created first' },
  { value: 'due', label: 'Due soon', title: 'Earliest due first' },
  { value: 'priority', label: 'Priority', title: 'Open items first: expedited, then urgent, then earliest due' },
]

const PAGE = 50

/** Quick starting points before you type anything. */
const BROWSE: Array<{ label: string; query: string }> = [
  { label: 'In my basket', query: 'is:mine' },
  { label: 'Started by me', query: 'creator:me' },
  { label: 'Overdue', query: 'is:overdue' },
  { label: 'Expedited', query: 'is:expedited is:open' },
  { label: 'Urgent and open', query: 'priority:urgent is:open' },
  { label: 'Created today', query: 'created:<1d' },
]

/** Find any item you can see: live results, why each matched, facets to narrow down, and recent searches. */
export function SearchPage({ me, app, ctx, users, groups, sim, tick, data, onAsk }: Props) {
  const query = useWorkspace((s) => s.searchQuery)
  const sort = useWorkspace((s) => s.searchSort)
  const viewId = useWorkspace((s) => s.viewId)
  const recent = useWorkspace((s) => s.recent[app.id]) ?? []
  const ws = useWorkspace.getState()
  const [limit, setLimit] = useState(PAGE)
  const inputRef = useRef<HTMLInputElement>(null)
  const { result, settled } = useItemSearch(sim, ctx, me.id, query, tick, { sort, limit })

  useEffect(() => {
    setLimit(PAGE)
  }, [query, sort])
  // Typing "/" or ⌘K here focuses the box instead of opening the overlay.
  useEffect(() => {
    if (!viewId) inputRef.current?.focus()
  }, [viewId])

  const words = useMemo(() => highlightWords(result?.query), [result?.query])
  const held = useMemo(() => new Set(data.basket.map((i) => i.obj.id)), [data.basket])
  const multiType = app.objectTypes.length > 1
  const typeName = useMemo(() => new Map(app.objectTypes.map((t) => [t.id, t.name])), [app.objectTypes])
  const facets = useMemo(() => (result ? facetGroups(result.facets, multiType) : []), [result, multiType])
  const filters = splitQuery(query).filter((t) => /^-?("[^"]+"|[\w$#-]+)(>=|<=|[:=<>])./.test(t) || (t.startsWith('-') && t.length > 1))

  const viewed = viewId ? sim?.objects[viewId] : undefined
  if (viewed && sim) return <ItemReadView me={me} app={app} ctx={ctx} users={users} groups={groups} sim={sim} obj={viewed} crumb="Search" onBack={() => ws.view(null)} />

  const setQuery = (q: string) => ws.setSearchQuery(q)
  const pick = (example: string) => {
    setQuery(toggleToken(query, example))
    inputRef.current?.focus()
  }
  const open = (objectId: string) => {
    ws.remember(app.id, query)
    openFound(objectId, data.basket)
  }
  const shown = result?.hits ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-4 px-6 py-6">
        <PageHeader
          title="Search"
          subtitle={`Everything you may see in ${app.name}: numbers, any field, line items and comments. Press / or ${MOD_KEY}K anywhere in the Workspace to search quickly.`}
        />

        <div className="relative">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ws.remember(app.id, query)
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
            placeholder={`Search by number, words or filters, e.g. ${firstExample(app)}`}
            aria-label="Search items"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white pr-[230px] pl-10 text-[15px] text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none!"
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
            {query && (
              <button type="button" aria-label="Clear search" title="Clear" onClick={() => setQuery('')} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={15} />
              </button>
            )}
            <SearchTips app={app} onPick={pick} />
            <Button size="sm" variant="subtle" icon={<Sparkles size={13} className="text-brand-600" />} onClick={() => onAsk(query)} title="Ask Modus in plain words instead">
              Ask
            </Button>
          </div>
        </div>

        {!query.trim() ? (
          <StartHere app={app} recent={recent} onPick={setQuery} onTip={pick} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className={cx('text-[13px] text-slate-600 transition-opacity', !settled && 'opacity-60')}>
                {result ? (
                  <>
                    <span className="font-semibold text-slate-900 tabular-nums">{result.total.toLocaleString()}</span> {result.total === 1 ? 'item' : 'items'}
                  </>
                ) : (
                  'Searching…'
                )}
              </p>
              {filters.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setQuery(withoutTokens(query, (t) => t === f))}
                  title="Remove this filter"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pr-1.5 pl-2 font-mono text-[11px] text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                >
                  {f}
                  <X size={11} className="text-slate-400" />
                </button>
              ))}
              <div className="flex-1" />
              <Segmented size="sm" value={sort} onChange={ws.setSearchSort} options={SORTS} />
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_250px]">
              <Card>
                {result && result.total === 0 ? (
                  <EmptyState icon={<SearchX size={26} />} title={`Nothing matches “${query.trim()}”`}>
                    <span className="block">
                      Check the spelling, take a filter away, or ask in plain words. You only find items you’re allowed to see, and fields you may not see are never searched.
                    </span>
                    <span className="mt-3 flex justify-center gap-2">
                      {filters.length > 0 && splitQuery(query).length > filters.length && (
                        <Button size="sm" onClick={() => setQuery(withoutTokens(query, (t) => filters.includes(t)))}>
                          Keep just the words
                        </Button>
                      )}
                      <Button size="sm" icon={<Sparkles size={13} />} onClick={() => onAsk(query)}>
                        Ask Modus
                      </Button>
                    </span>
                  </EmptyState>
                ) : (
                  <ul className={cx('divide-y divide-slate-100 transition-opacity', !settled && 'opacity-60')}>
                    {shown.map((h) => (
                      <li key={h.obj.id}>
                        <SearchHitRow
                          hit={h}
                          ctx={ctx}
                          userId={me.id}
                          words={words}
                          clock={sim?.clock ?? 0}
                          held={held.has(h.obj.id)}
                          typeName={multiType ? typeName.get(h.obj.typeId) : undefined}
                          onOpen={() => open(h.obj.id)}
                        />
                      </li>
                    ))}
                    {result && result.total > shown.length && (
                      <li className="px-4 py-2.5 text-center">
                        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setLimit((l) => l + PAGE)}>
                          Show more ({(result.total - shown.length).toLocaleString()} more)
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </Card>

              {facets.length > 0 && (
                <aside className="space-y-4" aria-label="Narrow down">
                  {facets.map((g) => (
                    <section key={g.title}>
                      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{g.title}</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {g.chips.map((c) => {
                          const on = splitQuery(query).some((t) => t.toLowerCase().replace(/"/g, '') === c.token.toLowerCase().replace(/"/g, ''))
                          return (
                            <button
                              key={c.token}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setQuery(toggleToken(query, c.token, g.sameKind))}
                              title={on ? `Remove ${c.token}` : `Only ${c.label.toLowerCase()} (${c.token})`}
                              className={cx(
                                'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                                on ? 'border-brand-300 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                              )}
                            >
                              {on && <Check size={11} className="shrink-0" />}
                              <span className="truncate">{c.label}</span>
                              <span className={cx('tabular-nums', on ? 'text-brand-600' : 'text-slate-400')}>{c.count.toLocaleString()}</span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ))}
                </aside>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function firstExample(app: App): string {
  const type = app.objectTypes[0]
  const money = type?.fields.find((f) => f.type === 'currency' && f.summary)
  return money ? `is:overdue ${money.label.toLowerCase()}>10k` : 'is:overdue priority:urgent'
}

/** Before you type: recent searches, quick starting points, and how the search language works. */
function StartHere({ app, recent, onPick, onTip }: { app: App; recent: string[]; onPick: (q: string) => void; onTip: (example: string) => void }) {
  const ws = useWorkspace.getState()
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Recent searches
            {recent.length > 0 && (
              <button type="button" className="text-[11px] font-medium tracking-normal text-slate-500 normal-case hover:text-slate-800" onClick={() => ws.forget(app.id)}>
                Clear
              </button>
            )}
          </h3>
          <Card>
            {recent.length === 0 ? (
              <p className="px-4 py-3.5 text-xs text-slate-500">Searches you run (press Enter, or open a result) show up here so you can repeat them.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((q) => (
                  <li key={q} className="group flex items-center">
                    <button type="button" onClick={() => onPick(q)} className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2 text-left hover:bg-slate-50">
                      <Clock size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate font-mono text-[12px] text-slate-800">{q}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget “${q}”`}
                      title="Forget this search"
                      onClick={() => ws.forget(app.id, q)}
                      className="mr-2 rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600 focus:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Start with</h3>
          <div className="flex flex-wrap gap-2">
            {BROWSE.map((b) => (
              <button
                key={b.query}
                type="button"
                onClick={() => onPick(b.query)}
                className="hover:border-brand-300 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left shadow-xs hover:bg-brand-50/40"
              >
                <span className="block text-[13px] font-medium text-slate-800">{b.label}</span>
                <span className="block font-mono text-[10.5px] text-slate-500">{b.query}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <section>
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">How to search</h3>
        <Card className="p-4">
          <TipsList app={app} onPick={onTip} />
        </Card>
      </section>
    </div>
  )
}
