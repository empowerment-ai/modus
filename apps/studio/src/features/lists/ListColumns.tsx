import { ChevronRight, CornerDownLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { cx } from '../../components/ui'
import { childrenOf, withoutItemTree } from '@throughline/core/model/lists'
import type { Id, ListDef, ListItem } from '@throughline/core/model/types'
import { uid } from '@throughline/core/model/util'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

export function pluralize(word: string): string {
  if (!word) return word
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`
  return `${word}s`
}

/**
 * Miller-columns editor: one column per level. Column N lists the children of
 * whatever is selected in column N-1, which is exactly how the cascading
 * dropdowns behave on a form.
 */
export function ListColumns({ list, appId }: { list: ListDef; appId: Id }) {
  const [path, setPath] = useState<Id[]>([])
  const updateApp = useDesign((s) => s.updateApp)
  const toast = useUi((s) => s.toast)
  const linked = list.levels.length > 1

  const mutate = (fn: (l: ListDef) => void) =>
    updateApp(appId, (app) => {
      const l = app.lists.find((x) => x.id === list.id)
      if (l) fn(l)
    })

  // Keep only the part of the selection path that still exists.
  const valid: Id[] = []
  for (let i = 0; i < path.length && i < list.levels.length - 1; i++) {
    const item = list.items.find((x) => x.id === path[i])
    if (!item || item.parentId !== (i === 0 ? null : valid[i - 1])) break
    valid.push(item.id)
  }

  const select = (level: number, id: Id) => setPath([...valid.slice(0, level), id])

  const addItems = (labels: string[], parentId: Id | null, levelName: string) => {
    const existing = new Set(childrenOf(list, parentId).map((i) => i.label.trim().toLowerCase()))
    const fresh: string[] = []
    let skipped = 0
    for (const raw of labels) {
      const label = raw.trim()
      if (!label) continue
      if (existing.has(label.toLowerCase())) {
        skipped++
        continue
      }
      existing.add(label.toLowerCase())
      fresh.push(label)
    }
    if (fresh.length)
      mutate((l) => {
        for (const label of fresh) l.items.push({ id: uid('li'), label, parentId })
      })
    if (skipped) toast(`Skipped ${skipped} duplicate ${skipped === 1 ? levelName.toLowerCase() : pluralize(levelName).toLowerCase()}.`, 'warn')
    else if (fresh.length > 1) toast(`Added ${fresh.length} ${pluralize(levelName).toLowerCase()}.`, 'success')
  }

  const rename = (id: Id, label: string) =>
    mutate((l) => {
      const it = l.items.find((x) => x.id === id)
      if (it && label.trim()) it.label = label.trim()
    })

  const remove = (item: ListItem) => {
    const beneath = list.items.length - withoutItemTree(list, item.id).length - 1
    if (beneath > 0 && !window.confirm(`Delete “${item.label}” and the ${beneath} item${beneath === 1 ? '' : 's'} beneath it?`)) return
    mutate((l) => {
      l.items = withoutItemTree(l, item.id)
    })
  }

  return (
    <div className="flex h-full min-h-[340px] w-max min-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
      {list.levels.map((level, i) => {
        const parentId = i === 0 ? null : (valid[i - 1] ?? null)
        const enabled = i === 0 || parentId !== null
        const items = enabled ? childrenOf(list, parentId) : []
        const parent = parentId ? list.items.find((x) => x.id === parentId) : undefined
        const isLast = i === list.levels.length - 1
        return (
          <Column
            key={i}
            index={i}
            level={level}
            parentLevel={i > 0 ? list.levels[i - 1]! : undefined}
            parentLabel={parent?.label}
            items={items}
            list={list}
            enabled={enabled}
            isLast={isLast}
            wide={!linked}
            selectedId={valid[i]}
            onSelect={(id) => select(i, id)}
            onAdd={(labels) => addItems(labels, parentId, level)}
            onRename={rename}
            onRemove={remove}
          />
        )
      })}
    </div>
  )
}

function Column({
  index,
  level,
  parentLevel,
  parentLabel,
  items,
  list,
  enabled,
  isLast,
  wide,
  selectedId,
  onSelect,
  onAdd,
  onRename,
  onRemove,
}: {
  index: number
  level: string
  parentLevel?: string
  parentLabel?: string
  items: ListItem[]
  list: ListDef
  enabled: boolean
  isLast: boolean
  wide: boolean
  selectedId?: Id
  onSelect: (id: Id) => void
  onAdd: (labels: string[]) => void
  onRename: (id: Id, label: string) => void
  onRemove: (item: ListItem) => void
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cx('flex shrink-0 flex-col border-r border-slate-200 last:border-r-0', wide ? 'w-[440px]' : 'w-[252px]', !enabled && 'bg-slate-50/60')}>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold', enabled ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500')}>
          {index + 1}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-xs font-semibold text-slate-800">{level}</div>
          <div className="truncate text-[11px] text-slate-500">
            {index === 0 ? (
              wide ? (
                'Flat list'
              ) : (
                'Top level'
              )
            ) : parentLabel ? (
              <>
                for <span className="font-medium text-brand-700">{parentLabel}</span>
              </>
            ) : (
              `Waiting for a ${parentLevel?.toLowerCase()}`
            )}
          </div>
        </div>
        {enabled && <span className="ml-auto text-[11px] text-slate-400 tabular-nums">{items.length}</span>}
      </div>

      <ul className="min-h-0 flex-1 space-y-px overflow-y-auto py-1.5">
        {!enabled && (
          <li className="px-4 py-8 text-center text-xs leading-relaxed text-slate-400">
            Pick a {parentLevel} to see its {pluralize(level)}.
          </li>
        )}
        {enabled && items.length === 0 && (
          <li className="px-4 py-8 text-center text-xs leading-relaxed text-slate-400">
            No {pluralize(level).toLowerCase()} {parentLabel ? `for ${parentLabel} ` : ''}yet.
            <br />
            Add the first one below.
          </li>
        )}
        {items.map((item) => (
          <Row
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            isLast={isLast}
            childCount={isLast ? 0 : childrenOf(list, item.id).length}
            onSelect={() => onSelect(item.id)}
            onRename={(label) => onRename(item.id, label)}
            onRemove={() => onRemove(item)}
          />
        ))}
      </ul>

      <div className="border-t border-slate-200 p-2">
        <div className="relative">
          <Plus size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            aria-label={`Add ${level}`}
            disabled={!enabled}
            value={draft}
            placeholder={enabled ? `Add ${level}…` : `Choose a ${parentLevel?.toLowerCase()} first`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onAdd([draft])
                setDraft('')
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (!/\r?\n/.test(text)) return
              e.preventDefault()
              onAdd(text.split(/\r?\n/))
              setDraft('')
            }}
            className="h-8 w-full rounded-md border border-slate-300 bg-white pr-8 pl-7 text-sm shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50"
          />
          {draft.trim() && <CornerDownLeft size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400" />}
        </div>
        {enabled && <p className="mt-1 px-0.5 text-[10.5px] text-slate-400">Enter adds one · paste several lines to add many</p>}
      </div>
    </div>
  )
}

function Row({
  item,
  selected,
  isLast,
  childCount,
  onSelect,
  onRename,
  onRemove,
}: {
  item: ListItem
  selected: boolean
  isLast: boolean
  childCount: number
  onSelect: () => void
  onRename: (label: string) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.label)

  const commit = () => {
    if (text.trim() && text.trim() !== item.label) onRename(text)
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="mx-1.5">
        <input
          autoFocus
          aria-label="Rename item"
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setText(item.label)
              setEditing(false)
            }
          }}
          className="h-8 w-full rounded-md border border-brand-500 bg-white px-2 text-sm ring-2 ring-brand-500/20 focus:outline-none"
        />
      </li>
    )
  }

  const action = cx('rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100', selected ? 'text-white/80 hover:bg-white/15 hover:text-white' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700')

  return (
    <li className={cx('group relative mx-1.5 flex h-8 items-center rounded-md pr-1', selected ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100')}>
      <button
        type="button"
        className={cx('flex h-full min-w-0 flex-1 items-center pl-2.5 text-left text-sm', isLast ? 'cursor-default' : 'cursor-pointer', selected && 'font-medium')}
        onClick={() => !isLast && onSelect()}
        onDoubleClick={() => {
          setText(item.label)
          setEditing(true)
        }}
        title={isLast ? 'Double-click to rename' : 'Click to see what is beneath it · double-click to rename'}
      >
        <span className="truncate">{item.label}</span>
      </button>
      <button
        type="button"
        aria-label={`Rename ${item.label}`}
        className={action}
        onClick={() => {
          setText(item.label)
          setEditing(true)
        }}
      >
        <Pencil size={12} />
      </button>
      <button type="button" aria-label={`Delete ${item.label}`} className={action} onClick={onRemove}>
        <Trash2 size={12} />
      </button>
      {!isLast && (
        <span className={cx('ml-0.5 flex items-center gap-0.5 text-[11px] tabular-nums', selected ? 'text-white/85' : 'text-slate-400')}>
          {childCount}
          <ChevronRight size={14} />
        </span>
      )}
    </li>
  )
}
