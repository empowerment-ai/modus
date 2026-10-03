import { Inbox, Play, Search, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, cx, EmptyState, Input, Segmented, Select, Toggle } from '../../components/ui'
import { type Ctx, PRIORITIES, type SimState, type WorkItem } from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import type { App, Group, Id, User } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { useUi } from '../../store/ui'
import { getNext } from './actions'
import { UrgencyBadge } from './Expedite'
import { sortItems } from './format'
import type { WorkData } from './live'
import { DueLabel, PageHeader, StateChip, StepName } from './parts'
import { type BasketSort, NO_FILTER, useWorkspace } from './store'
import { WorkItemView } from './WorkItemView'

interface Props {
  me: User
  app: App
  ctx: Ctx
  users: User[]
  groups: Group[]
  sim: SimState | undefined
  tick: string
  data: WorkData
}

const SORTS: Array<{ value: BasketSort; label: string; title: string }> = [
  { value: 'priority', label: 'Priority', title: 'Most urgent first, then earliest due' },
  { value: 'due', label: 'Due', title: 'Earliest due first' },
  { value: 'age', label: 'Age', title: 'Longest at its step first' },
]

const GRID = 'grid-cols-[80px_88px_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_64px_116px_84px]'

/** Your basket: everything assigned to you, with filters, keyboard navigation and the item view beside it. */
export function MyWorkPage({ me, app, ctx, users, groups, sim, tick, data }: Props) {
  const sort = useWorkspace((s) => s.sort)
  const filter = useWorkspace((s) => s.filter)
  const tokenId = useWorkspace((s) => s.tokenId)
  const ws = useWorkspace.getState()
  const { basket, clock, queues } = data

  const typesById = useMemo(() => new Map(app.objectTypes.map((t) => [t.id, t])), [app.objectTypes])
  const titleOf = (i: WorkItem) => objectTitle(typesById.get(i.obj.typeId), i.obj.data, app.lists, users)

  const steps = useMemo(() => {
    const m = new Map<Id, string>()
    for (const i of basket) m.set(i.node.id, i.step.label)
    return [...m]
  }, [basket])

  const rows = useMemo(() => {
    const q = filter.query.trim().toLowerCase()
    const kept = basket.filter((i) => {
      if (filter.stepId && i.node.id !== filter.stepId) return false
      if (filter.priority && i.priority !== filter.priority) return false
      if (filter.overdueOnly && !i.overdue) return false
      if (filter.expeditedOnly && !i.expedited) return false
      return !q || `${i.obj.number} ${titleOf(i)} ${i.step.label} ${i.wf.name}`.toLowerCase().includes(q)
    })
    return sortItems(kept, sort)
  }, [basket, filter, sort, typesById, app.lists, users])

  // Keyboard cursor: follows the open item, moves with ↑/↓ or j/k.
  const [cursor, setCursor] = useState<Id | null>(tokenId ?? null)
  useEffect(() => {
    if (tokenId) setCursor(tokenId)
  }, [tokenId])
  const live = useRef({ rows, cursor, tokenId })
  live.current = { rows, cursor, tokenId }
  const rowEls = useRef(new Map<Id, HTMLElement>())
  useEffect(() => {
    if (cursor) rowEls.current.get(cursor)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return
      if (useUi.getState().createFor || document.querySelector('[role="dialog"]')) return
      const { rows, cursor, tokenId } = live.current
      const i = rows.findIndex((r) => r.token.id === cursor)
      const move = (to: WorkItem | undefined) => {
        if (!to) return
        setCursor(to.token.id)
        // With an item open, the item view follows the cursor.
        if (tokenId) useWorkspace.getState().openItem(to.token.id)
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        move(i < 0 ? rows[0] : rows[Math.min(rows.length - 1, i + 1)])
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        move(i < 0 ? rows[0] : rows[Math.max(0, i - 1)])
      } else if (e.key === 'Enter' && cursor && t.tagName !== 'BUTTON' && t.tagName !== 'A') {
        e.preventDefault()
        useWorkspace.getState().openItem(cursor)
      } else if (e.key === 'Escape' && tokenId) {
        useWorkspace.getState().openItem(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openIndex = tokenId ? rows.findIndex((r) => r.token.id === tokenId) : -1
  const position = openIndex >= 0 ? { index: openIndex, total: rows.length, prev: rows[openIndex - 1]?.token.id, next: rows[openIndex + 1]?.token.id } : undefined

  // After you release / return / delegate, move on to the next item in the list.
  const onDone = () => {
    const i = rows.findIndex((r) => r.token.id === tokenId)
    const next = i >= 0 ? (rows[i + 1] ?? rows[i - 1]) : undefined
    ws.openItem(next?.token.id ?? null)
  }

  const expedited = basket.filter((i) => i.expedited).length
  const filtered = filter.stepId || filter.priority || filter.overdueOnly || filter.expeditedOnly || filter.query
  const open = !!tokenId && !!sim

  return (
    <div className="flex h-full">
      <section className={cx('@container flex min-w-0 flex-col bg-white', open ? 'hidden w-[400px] shrink-0 border-r border-slate-200 xl:flex 2xl:w-[440px]' : 'flex-1')} aria-label="My work">
        <div className={cx('shrink-0 space-y-3 border-b border-slate-200 py-4', open ? 'px-4' : 'px-6')}>
          <PageHeader
            title={
              <span className="flex items-center gap-2">
                My work <span className="text-sm font-medium text-slate-400 tabular-nums">{basket.length}</span>
              </span>
            }
            subtitle={open ? undefined : 'Everything assigned to you. Use ↑ ↓ or j k to move and Enter to open.'}
            actions={
              queues.length > 0 && (
                <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={() => getNext(me.id)} title="Pull the most urgent item from your queues">
                  Get next
                </Button>
              )
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[160px] flex-1">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={filter.query}
                onChange={(e) => ws.setFilter({ query: e.target.value })}
                placeholder="Search number, title, step…"
                className="h-7 pl-8 text-xs"
                aria-label="Search my work"
              />
            </div>
            <Segmented size="sm" value={sort} onChange={ws.setSort} options={SORTS} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter.stepId} onChange={(e) => ws.setFilter({ stepId: e.target.value })} className="h-7 w-auto max-w-[180px] text-xs" aria-label="Step">
              <option value="">All steps</option>
              {steps.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            <Select value={filter.priority} onChange={(e) => ws.setFilter({ priority: e.target.value as typeof filter.priority })} className="h-7 w-auto text-xs" aria-label="Priority">
              <option value="">Any priority</option>
              {[...PRIORITIES].reverse().map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p[0]!.toUpperCase() + p.slice(1)}
                </option>
              ))}
            </Select>
            <Toggle checked={filter.overdueOnly} onChange={(v) => ws.setFilter({ overdueOnly: v })} label={<span className="text-xs text-slate-600">Overdue only</span>} />
            <button
              type="button"
              aria-pressed={filter.expeditedOnly}
              onClick={() => ws.setFilter({ expeditedOnly: !filter.expeditedOnly })}
              title={filter.expeditedOnly ? 'Show everything again' : 'Only expedited items: they go before everything else'}
              className={cx(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
                filter.expeditedOnly ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <Zap size={12} className={cx('text-orange-500', filter.expeditedOnly && 'fill-orange-500')} />
              Expedited
              <span className={cx('tabular-nums', filter.expeditedOnly ? 'text-orange-700' : 'text-slate-400')}>{expedited}</span>
            </button>
            {filtered && (
              <button type="button" onClick={() => ws.setFilter(NO_FILTER)} className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800">
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Inbox size={28} />} title={basket.length ? 'Nothing matches these filters' : 'Nothing in your basket'}>
            {basket.length
              ? 'Try a different search, or clear the filters.'
              : `Work arrives here when it’s assigned to you${queues.length ? ', or press Get next to pull the most urgent item from your queues' : ''}. Colleagues keep working while you’re here, so new items can show up at any time.`}
          </EmptyState>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Work items">
            <div className={cx('sticky top-0 z-10 hidden gap-3 border-b border-slate-200 bg-white px-6 py-2 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase @3xl:grid', GRID)}>
              <span>Priority</span>
              <span>Number</span>
              <span>Title</span>
              <span>Step</span>
              <span>Workflow</span>
              <span className="text-right">At step</span>
              <span>Due</span>
              <span>State</span>
            </div>
            {rows.map((i) => (
              <BasketRow
                key={i.token.id}
                item={i}
                title={titleOf(i)}
                clock={clock}
                open={i.token.id === tokenId}
                cursor={i.token.id === cursor}
                compact={open}
                rowRef={(el) => {
                  if (el) rowEls.current.set(i.token.id, el)
                  else rowEls.current.delete(i.token.id)
                }}
                onOpen={() => {
                  setCursor(i.token.id)
                  ws.openItem(i.token.id)
                }}
              />
            ))}
          </div>
        )}
      </section>

      {open && (
        <div className="min-w-0 flex-1">
          <WorkItemView
            tokenId={tokenId}
            me={me}
            app={app}
            ctx={ctx}
            users={users}
            groups={groups}
            sim={sim}
            tick={tick}
            position={position}
            onMove={(id) => ws.openItem(id)}
            onClose={() => ws.openItem(null)}
            onDone={onDone}
          />
        </div>
      )}
    </div>
  )
}

function BasketRow({
  item: i,
  title,
  clock,
  open,
  cursor,
  compact,
  rowRef,
  onOpen,
}: {
  item: WorkItem
  title: string
  clock: number
  open: boolean
  cursor: boolean
  compact: boolean
  rowRef: (el: HTMLElement | null) => void
  onOpen: () => void
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={open}
      onClick={onOpen}
      className={cx(
        'relative block w-full border-b border-slate-100 text-left text-xs transition-colors',
        compact ? 'px-4 py-2.5' : 'px-6 py-2.5 @3xl:py-2',
        open ? 'bg-brand-50/80' : cursor ? 'bg-slate-50' : 'hover:bg-slate-50',
      )}
    >
      {(open || cursor) && <span className={cx('absolute inset-y-0 left-0 w-0.5', open ? 'bg-brand-600' : 'bg-slate-300')} aria-hidden />}
      {/* Narrow: two lines */}
      <span className="block @3xl:hidden">
        <span className="flex items-center gap-2">
          <UrgencyBadge priority={i.priority} expedited={i.expedited} quietNormal />
          <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">{title || 'Untitled'}</span>
          <DueLabel due={i.due} clock={clock} className="text-[11px]" />
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <StepName item={i} className="flex-1" />
          <span className="whitespace-nowrap tabular-nums">{formatDuration(i.age)}</span>
          {i.token.state === 'working' && <StateChip state="working" />}
        </span>
      </span>
      {/* Wide: one line per item, table columns */}
      <span className={cx('hidden items-center gap-3 @3xl:grid', GRID)}>
        <span>
          <UrgencyBadge priority={i.priority} expedited={i.expedited} />
        </span>
        <span className="font-mono text-[11px] font-medium text-brand-700">{i.obj.number}</span>
        <span className="truncate text-[13px] font-medium text-slate-900">{title || <span className="text-slate-400">Untitled</span>}</span>
        <StepName item={i} className="block text-slate-700" />
        <span className="truncate text-slate-500">{i.wf.name}</span>
        <span className="text-right text-slate-600 tabular-nums">{formatDuration(i.age)}</span>
        <DueLabel due={i.due} clock={clock} />
        <span>
          <StateChip state={i.token.state} />
        </span>
      </span>
    </button>
  )
}
