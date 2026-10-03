import { Plus, Sigma, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef } from 'react'
import { columnAsField } from '@modus-bpm/core/model/conditions'
import { formatFieldValue } from '@modus-bpm/core/model/format'
import { columnSum, newRow, rowsOf } from '@modus-bpm/core/model/tables'
import type { ColumnDef, FieldDef, ListDef, ObjectType, TableRow, User } from '@modus-bpm/core/model/types'
import { currencyFmt } from '@modus-bpm/core/model/util'
import { Button, cx } from './ui'

// A table (multi-row) field: invoice line items, attendees, damaged items.
// Rendered as a compact grid with one input per cell; computed columns
// (Quantity × Unit Price) are read-only and kept current by the form.

interface Props {
  field: FieldDef
  type: ObjectType
  value: unknown
  lists: ListDef[]
  users: User[]
  /** Omit for a read-only table. */
  onChange?: (rows: TableRow[] | undefined) => void
  /** Validation message for the whole table; also marks empty required cells. */
  error?: string
}

/** Narrowest a column may get before the grid scrolls sideways. Read-only text needs no room for a select arrow. */
const MIN_WIDTH: Record<ColumnDef['type'], number> = { text: 110, email: 140, number: 72, currency: 92, date: 124, boolean: 52, choice: 110, user: 120 }
const READ_ONLY_MIN: Partial<Record<ColumnDef['type'], number>> = { text: 88, email: 110, choice: 88, user: 96, date: 100 }
const NUMERIC = new Set<ColumnDef['type']>(['number', 'currency'])
const ROW_NO = 26
const REMOVE = 30

const cellInput =
  'h-8 w-full min-w-0 border-0 bg-transparent px-2 text-sm text-slate-900 placeholder:text-slate-300 focus:bg-white focus:ring-2 focus:ring-brand-500/40 focus:outline-none focus:ring-inset'

function formatCell(c: ColumnDef, v: unknown, lists: ListDef[], users: User[]): string {
  return formatFieldValue(columnAsField(c), v, lists, users)
}

function formulaText(c: ColumnDef, columns: ColumnDef[]): string | undefined {
  if (!c.formula) return undefined
  const [a, b] = c.formula.of.map((id) => columns.find((x) => x.id === id)?.label ?? '?')
  return `${a} ${c.formula.op === 'multiply' ? '×' : '+'} ${b}`
}

/** Columns the footer adds up: the ones a total field sums, else every currency column. */
function totalledColumns(field: FieldDef, type: ObjectType): Map<string, string | undefined> {
  const columns = field.columns ?? []
  const fed = type.fields.filter((f) => f.total?.tableFieldId === field.id)
  if (fed.length) return new Map(fed.filter((f) => columns.some((c) => c.id === f.total!.columnId)).map((f) => [f.total!.columnId, f.label]))
  return new Map(columns.filter((c) => c.type === 'currency').map((c) => [c.id, undefined]))
}

export function TableField({ field, type, value, lists, users, onChange, error }: Props) {
  const columns = field.columns ?? []
  const rows = rowsOf(value)
  const editable = !!onChange
  const totals = totalledColumns(field, type)
  const canAdd = editable && (!field.maxRows || rows.length < field.maxRows)
  const gridRef = useRef<HTMLDivElement>(null)
  // After adding a row from the keyboard, focus this cell once it renders.
  const pendingFocus = useRef<{ row: number; col: number } | null>(null)

  useEffect(() => {
    const p = pendingFocus.current
    if (!p) return
    pendingFocus.current = null
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${p.row}:${p.col}"]`)?.focus()
  }, [rows.length])

  const min = (c: ColumnDef) => (editable ? MIN_WIDTH[c.type] : (READ_ONLY_MIN[c.type] ?? MIN_WIDTH[c.type]))
  const template = [`${ROW_NO}px`, ...columns.map((c) => `minmax(${min(c)}px, ${c.width ?? 1}fr)`), editable ? `${REMOVE}px` : ''].filter(Boolean).join(' ')
  const minWidth = ROW_NO + columns.reduce((s, c) => s + min(c), 0) + (editable ? REMOVE : 0)

  const emit = (next: TableRow[]) => onChange?.(next.length ? next : undefined)
  const setCell = (i: number, c: ColumnDef, v: unknown) => emit(rows.map((r, j) => (j === i ? { ...r, [c.id]: v } : r)))
  const addRow = (focusCol?: number) => {
    if (!canAdd) return
    pendingFocus.current = { row: rows.length, col: focusCol ?? columns.findIndex((c) => !c.formula) }
    emit([...rows, newRow(field)])
  }
  const removeRow = (i: number) => emit(rows.filter((_, j) => j !== i))

  // Enter moves down a row, like a spreadsheet; from the last row it adds one.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>, i: number, col: number) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (i < rows.length - 1) gridRef.current?.querySelector<HTMLElement>(`[data-cell="${i + 1}:${col}"]`)?.focus()
    else addRow(col)
  }

  if (!columns.length) return <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-400">This table has no columns yet.</div>
  if (!editable && !rows.length) return <div className="min-h-8 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-400">No rows</div>

  const missing = (c: ColumnDef, r: TableRow) => !!error && !!c.required && !c.formula && (r[c.id] === undefined || r[c.id] === null || r[c.id] === '')

  return (
    <div>
      <div className={cx('overflow-x-auto rounded-md border', error ? 'border-rose-300' : 'border-slate-200')}>
        <div ref={gridRef} role="table" aria-label={field.label} aria-rowcount={rows.length + 1} className="grid text-sm" style={{ gridTemplateColumns: template, minWidth }}>
          {/* Header */}
          <div role="row" className="contents">
            <div role="columnheader" className="bg-slate-50" aria-label="Row" />
            {columns.map((c) => (
              <div
                key={c.id}
                role="columnheader"
                title={formulaText(c, columns)}
                className={cx(
                  'flex min-w-0 items-center gap-1 border-l border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-600',
                  NUMERIC.has(c.type) && 'justify-end text-right',
                  c.type === 'boolean' && 'justify-center',
                )}
              >
                {c.formula && <Sigma size={10} className="shrink-0 text-slate-400" aria-hidden />}
                <span className="truncate" title={c.label}>
                  {c.label}
                </span>
                {c.required && editable && !c.formula && <span className="text-rose-500">*</span>}
              </div>
            ))}
            {editable && <div role="columnheader" aria-label="Remove" className="border-l border-slate-200 bg-slate-50" />}
          </div>

          {/* Rows */}
          {rows.map((r, i) => (
            <div key={r.id} role="row" className="group contents">
              <div role="cell" className="flex items-center justify-center border-t border-slate-100 text-[11px] text-slate-400 tabular-nums">
                {i + 1}
              </div>
              {columns.map((c, col) => (
                <div key={c.id} role="cell" className={cx('relative min-w-0 border-t border-l border-slate-100', missing(c, r) && 'bg-rose-50/60')}>
                  {c.formula || !editable ? (
                    <div
                      title={c.formula ? formulaText(c, columns) : undefined}
                      className={cx(
                        'flex h-8 min-w-0 items-center px-2 text-sm',
                        NUMERIC.has(c.type) && 'justify-end tabular-nums',
                        c.type === 'boolean' && 'justify-center',
                        c.formula ? 'bg-slate-50/70 text-slate-700' : 'text-slate-800',
                      )}
                    >
                      <span className="truncate">{formatCell(c, r[c.id], lists, users) || <span className="text-slate-300">—</span>}</span>
                    </div>
                  ) : (
                    <CellInput column={c} value={r[c.id]} row={i} col={col} lists={lists} users={users} invalid={missing(c, r)} onValue={(v) => setCell(i, c, v)} onKeyDown={onKeyDown} />
                  )}
                </div>
              ))}
              {editable && (
                <div role="cell" className="flex items-center justify-center border-t border-l border-slate-100">
                  <button
                    type="button"
                    aria-label={`Remove row ${i + 1}`}
                    title="Remove row"
                    onClick={() => removeRow(i)}
                    className="rounded p-1 text-slate-300 group-hover:text-slate-500 hover:bg-slate-100 hover:text-rose-600 focus:text-slate-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {editable && !rows.length && (
            <div role="row" className="contents">
              <div role="cell" className="col-span-full border-t border-slate-100 px-3 py-3 text-center text-xs text-slate-500">
                No rows yet. Add the first one below.
              </div>
            </div>
          )}

          {/* Totals */}
          {rows.length > 0 && totals.size > 0 && (
            <div role="row" className="contents">
              <div role="cell" className="flex items-center justify-center border-t border-slate-200 bg-slate-50/70 text-slate-400">
                <Sigma size={11} aria-label="Totals" />
              </div>
              {columns.map((c, col) => {
                const feeds = totals.get(c.id)
                const shown = totals.has(c.id)
                const sum = shown ? columnSum(rows, c.id) : 0
                return (
                  <div
                    key={c.id}
                    role="cell"
                    title={feeds ? `Sets ${feeds}` : undefined}
                    className={cx(
                      'flex h-8 items-center border-t border-l border-slate-200 bg-slate-50/70 px-2 text-sm',
                      NUMERIC.has(c.type) && 'justify-end tabular-nums',
                      shown ? 'font-semibold text-slate-900' : 'text-[11px] font-medium text-slate-500',
                    )}
                  >
                    {shown ? (c.type === 'currency' ? currencyFmt.format(sum) : sum.toLocaleString()) : col === 0 ? `Total · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : ''}
                  </div>
                )
              })}
              {editable && <div role="cell" className="border-t border-l border-slate-200 bg-slate-50/70" />}
            </div>
          )}
        </div>
      </div>

      {editable && (
        <div className="mt-1.5 flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} disabled={!canAdd} onClick={() => addRow()}>
            Add row
          </Button>
          <span className="text-[11px] text-slate-500 tabular-nums">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            {field.maxRows ? ` of up to ${field.maxRows}` : ''}
            {field.minRows && rows.length < field.minRows ? ` · needs at least ${field.minRows}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

function CellInput({
  column: c,
  value: v,
  row,
  col,
  lists,
  users,
  invalid,
  onValue,
  onKeyDown,
}: {
  column: ColumnDef
  value: unknown
  row: number
  col: number
  lists: ListDef[]
  users: User[]
  invalid: boolean
  onValue: (v: unknown) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>, row: number, col: number) => void
}) {
  const common = {
    'data-cell': `${row}:${col}`,
    'aria-label': `${c.label}, row ${row + 1}`,
    'aria-invalid': invalid || undefined,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, row, col),
  }
  const num = (s: string) => (s === '' ? undefined : Number(s))
  switch (c.type) {
    case 'number':
      return (
        <input
          type="number"
          min={c.min}
          max={c.max}
          className={cx(cellInput, 'text-right tabular-nums')}
          value={v === undefined ? '' : String(v)}
          onChange={(e) => onValue(num(e.target.value))}
          {...common}
        />
      )
    case 'currency':
      return (
        <>
          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-slate-400">$</span>
          <input
            type="number"
            step="0.01"
            min={c.min ?? 0}
            max={c.max}
            className={cx(cellInput, 'pl-5 text-right tabular-nums')}
            value={v === undefined ? '' : String(v)}
            onChange={(e) => onValue(num(e.target.value))}
            {...common}
          />
        </>
      )
    case 'date':
      return <input type="date" className={cellInput} value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)} {...common} />
    case 'boolean':
      return (
        <div className="flex h-8 items-center justify-center">
          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-brand-600" checked={v === true} onChange={(e) => onValue(e.target.checked)} {...common} />
        </div>
      )
    case 'choice': {
      const items = lists.find((l) => l.id === c.listId)?.items.filter((it) => it.parentId === null) ?? []
      return (
        <select className={cx(cellInput, 'pr-6', !v && 'text-slate-400')} value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)} {...common}>
          <option value="">{c.listId ? 'Select…' : 'No list'}</option>
          {items.map((it) => (
            <option key={it.id} value={it.id} className="text-slate-900">
              {it.label}
            </option>
          ))}
        </select>
      )
    }
    case 'user':
      return (
        <select className={cx(cellInput, 'pr-6', !v && 'text-slate-400')} value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)} {...common}>
          <option value="">Select…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id} className="text-slate-900">
              {u.name}
            </option>
          ))}
        </select>
      )
    case 'email':
      return <input type="email" className={cellInput} value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)} {...common} />
    default:
      return <input className={cellInput} value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)} {...common} />
  }
}
