import { CircleHelp, MapPin } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '../../components/Shell'
import { Badge, cx } from '../../components/ui'
import { type Ctx, type ParsedQuery, type SearchHit, searchItems, type SearchResult, type SimState } from '@modus-bpm/core'
import type { App, Id } from '@modus-bpm/core/model/types'
import { PriorityBadge } from '../objects/PriorityBadge'
import { agoText } from './format'
import { DueLabel, STATUS, titleHidden } from './parts'
import type { SearchSort } from './store'

// Shared by the Search page, the quick-search overlay and Ask Modus: running a
// search as you type, highlighting why something matched, facets and tips.

/** "⌘" on a Mac, "Ctrl+" elsewhere: for showing the quick-search shortcut. */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

/** The value, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/** Live search as you type (debounced), scoped to what the person may see; follows the simulation via `tick`. */
export function useItemSearch(sim: SimState | undefined, ctx: Ctx, userId: Id, query: string, tick: string, opts: { sort?: SearchSort; limit: number }): { result?: SearchResult; settled: boolean } {
  const q = useDebounced(query.trim(), 150)
  const { sort, limit } = opts
  const result = useMemo(() => (sim && q ? searchItems(sim, ctx, q, { userId, limit, sort }) : undefined), [sim, ctx, userId, q, sort, limit, tick])
  return { result, settled: q === query.trim() }
}

// ---------- Highlighting ----------

const BUILT_IN = new Set(['is', 'status', 'priority', 'step', 'assignee', 'creator', 'type', 'workflow', 'number', 'created', 'due'])

/** Words to mark in results: the words and phrases searched for, and text values of field filters (vendor:acme). */
export function highlightWords(parsed: ParsedQuery | undefined): string[] {
  if (!parsed) return []
  const values = parsed.filters.filter((f) => !f.negate && (f.op === ':' || f.op === '=') && !BUILT_IN.has(f.key) && f.value.length > 1).map((f) => f.value.toLowerCase())
  return [...parsed.terms, ...parsed.phrases, ...values]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!text || !words.length) return <>{text}</>
  const re = new RegExp(
    `(${[...words]
      .sort((a, b) => b.length - a.length)
      .map(escapeRe)
      .join('|')})`,
    'gi',
  )
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-px text-inherit">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

// ---------- Editing the query ----------

/** Split a query into tokens, keeping "quoted phrases" together (as the engine does). */
export function splitQuery(q: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of q) {
    if (ch === '"') quoted = !quoted
    if (/\s/.test(ch) && !quoted) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

const norm = (t: string) => t.toLowerCase().replace(/"/g, '')

export const quoteValue = (s: string) => (/[\s:"]/.test(s) ? `"${s.replace(/"/g, '')}"` : s)

export function hasToken(q: string, token: string): boolean {
  return splitQuery(q).some((t) => norm(t) === norm(token))
}

export function withoutTokens(q: string, drop: (token: string) => boolean): string {
  return splitQuery(q)
    .filter((t) => !drop(t))
    .join(' ')
}

/** Add a filter (replacing others of the same kind), or take it away if it is already there. */
export function toggleToken(q: string, token: string, sameKind?: (token: string) => boolean): string {
  if (hasToken(q, token)) return withoutTokens(q, (t) => norm(t) === norm(token))
  return `${sameKind ? withoutTokens(q, sameKind) : q.trim()} ${token}`.trim()
}

// ---------- Facets ----------

export interface FacetGroup {
  title: string
  chips: Array<{ label: string; count: number; token: string }>
  /** Tokens of the same kind: picking a chip replaces them. */
  sameKind: (token: string) => boolean
}

const keyed =
  (...keys: string[]) =>
  (t: string) => {
    const m = /^-?([a-z]+)(>=|<=|[:=<>])/i.exec(t)
    return !!m && keys.includes(m[1]!.toLowerCase())
  }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export function facetGroups(facets: SearchResult['facets'], multiType: boolean): FacetGroup[] {
  const ordered = (rec: Record<string, number>, order: string[]) => order.filter((k) => rec[k]).map((k) => [k, rec[k]!] as const)
  const groups: FacetGroup[] = [
    {
      title: 'Status',
      chips: ordered(facets.status, ['active', 'completed', 'rejected', 'cancelled']).map(([k, count]) => ({
        label: STATUS[k as keyof typeof STATUS].label,
        count,
        token: k === 'active' ? 'is:open' : `status:${k}`,
      })),
      sameKind: (t) => keyed('status')(t) || /^is:(open|active|closed|done)$/i.test(t),
    },
    {
      title: 'Priority',
      chips: ordered(facets.priority, ['expedited', 'urgent', 'high', 'normal', 'low']).map(([k, count]) => ({ label: cap(k), count, token: k === 'expedited' ? 'is:expedited' : `priority:${k}` })),
      sameKind: (t) => keyed('priority')(t) || /^is:(expedited|rush)$/i.test(t),
    },
    {
      title: 'Where it is now',
      chips: Object.entries(facets.step)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, count]) => ({ label: k, count, token: k === 'Finished' ? 'is:closed' : `step:${quoteValue(k)}` })),
      sameKind: (t) => keyed('step', 'at')(t) || /^is:(closed|done)$/i.test(t),
    },
  ]
  if (multiType)
    groups.push({
      title: 'Type',
      chips: Object.entries(facets.type)
        .sort((a, b) => b[1] - a[1])
        .map(([k, count]) => ({ label: k, count, token: `type:${quoteValue(k)}` })),
      sameKind: keyed('type'),
    })
  return groups.filter((g) => g.chips.length > 0)
}

// ---------- Results ----------

export function SearchHitRow({
  hit,
  ctx,
  userId,
  words,
  clock,
  held,
  typeName,
  compact,
  active,
  onOpen,
  onHover,
}: {
  hit: SearchHit
  ctx: Ctx
  /** Who is looking: a title from a field they may not see is left out. */
  userId: Id
  words: string[]
  clock: number
  /** In your basket right now. */
  held: boolean
  /** Shown when the app has more than one item type. */
  typeName?: string
  compact?: boolean
  active?: boolean
  onOpen: () => void
  onHover?: () => void
}) {
  const o = hit.obj
  const s = STATUS[o.status]
  const title = titleHidden(ctx, o, userId) ? '' : hit.title
  // Searching by number: the number is the reason it matched, not the file names that contain it.
  const byNumber = words.length > 0 && words.every((w) => o.number.toLowerCase().includes(w))
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseMove={onHover}
      data-active={active || undefined}
      className={cx('block w-full text-left transition-colors', compact ? 'px-3 py-2' : 'px-4 py-3', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
    >
      <span className="flex items-center gap-2">
        <PriorityBadge priority={o.priority} expedited={!!o.expedite} reason={o.expedite?.reason} quietNormal />
        <span className="font-mono text-[11px] font-medium text-brand-700">
          <Highlight text={o.number} words={words} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">{title ? <Highlight text={title} words={words} /> : <span className="text-slate-400">Untitled</span>}</span>
        {held && <Badge tone="sky">In your basket</Badge>}
        {o.status !== 'active' ? <Badge tone={s.tone}>{s.label}</Badge> : o.dueBy !== undefined && <DueLabel due={o.dueBy} clock={clock} className="text-[11px]" />}
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
        <MapPin size={11} className="shrink-0 text-slate-400" />
        <span className="min-w-0 truncate">{hit.where || 'Between steps'}</span>
        {!compact && (
          <span className="shrink-0 whitespace-nowrap">
            <span aria-hidden>· </span>
            {typeName && `${typeName} · `}created {agoText(clock - o.createdAt)}
          </span>
        )}
      </span>
      {hit.matches.length > 0 && !byNumber && (
        <span className="mt-1 block space-y-0.5">
          {hit.matches.slice(0, compact ? 1 : 3).map((m) => (
            <span key={m.label} className="block truncate text-[11.5px] text-slate-600">
              <span className="text-slate-400">matched in {m.label}:</span> <Highlight text={m.snippet} words={words} />
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

// ---------- Tips ----------

/** The query language, with examples that fit this application's fields, lists and steps. */
export function tipsFor(app: App): Array<{ example: string; text: string }> {
  const type = app.objectTypes[0]
  const money = type?.fields.find((f) => f.type === 'currency' && f.summary) ?? type?.fields.find((f) => f.type === 'currency')
  const choice = type?.fields.find((f) => f.type === 'choice' && f.listId && f.id !== type.priorityFieldId)
  const items = app.lists.find((l) => l.id === choice?.listId)?.items ?? []
  const lead = (s: string) => s.toLowerCase().split(/\s+/)[0]!
  const step = app.workflows.flatMap((w) => (w.kind === 'subflow' ? [] : w.nodes)).find((n) => n.type === 'user')?.data.label
  const phrase = items
    .find((i) => i.label.split(/\s+/).length >= 2)
    ?.label.toLowerCase()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ')
  const key = (label: string) => quoteValue(label.toLowerCase())
  return [
    { example: 'is:overdue', text: 'Past its due date. Also is:expedited, is:mine, is:stuck, is:unassigned, is:escalated, is:open and is:closed.' },
    { example: 'priority:urgent', text: 'Low, normal, high or urgent.' },
    ...(money ? [{ example: `${key(money.label)}>10k`, text: `${money.label} over 10,000. Also <, >= and <=.` }] : []),
    ...(choice && items[0] ? [{ example: `${key(choice.label)}:${lead(items[0].label)}`, text: 'Any field or line-item column, by its name.' }] : []),
    ...(step ? [{ example: `step:${quoteValue(step.toLowerCase())}`, text: 'Where it is now.' }] : []),
    { example: 'assignee:me', text: 'Who has it now, or anyone by name. creator:me finds what you started.' },
    { example: 'created:<2d', text: 'Created in the last 2 days (m, h, d, w). due:<4h finds what is due soon.' },
    ...(items[1] ? [{ example: `-${lead(items[1].label)}`, text: 'Put - before a word to leave out items that mention it.' }] : []),
    ...(phrase ? [{ example: `"${phrase}"`, text: 'Quotes match words together, in that order.' }] : []),
  ]
}

export function TipsList({ app, onPick }: { app: App; onPick: (example: string) => void }) {
  const tips = useMemo(() => tipsFor(app), [app])
  return (
    <div>
      <p className="mb-2.5 text-xs leading-snug text-slate-600">
        Type words to match any field, line item or comment, or a number like {app.objectTypes[0]?.numberPrefix ?? 'INV-'}1042. Add filters to narrow it down. Click an example to try it.
      </p>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5">
        {tips.map((t) => (
          <Fragment key={t.example}>
            <button
              type="button"
              onClick={() => onPick(t.example)}
              className="hover:border-brand-300 justify-self-start rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11.5px] text-brand-700 hover:bg-brand-50"
            >
              {t.example}
            </button>
            <span className="text-xs leading-snug text-slate-600">{t.text}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** "Search tips": the query language in a popover. */
export function SearchTips({ app, onPick }: { app: App; onPick: (example: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx('inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-slate-100 hover:text-slate-800', open ? 'bg-slate-100 text-slate-800' : 'text-slate-500')}
      >
        <CircleHelp size={14} /> Search tips
      </button>
      {open && (
        <div className="animate-slide-in absolute top-9 right-0 z-30 w-[440px] rounded-lg border border-slate-200 bg-white p-3.5 shadow-xl">
          <TipsList
            app={app}
            onPick={(e) => {
              onPick(e)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
