// Table (multi-row) fields: an invoice's line items, a request's attendees, a
// claim's damaged items. Each row is a small record with its own columns;
// computed columns (Quantity × Unit Price) and totals (Amount = sum of Line
// Total) are kept in step here, so forms, the engine and the API agree.

import type { ColumnDef, FieldDef, Id, ObjectType, TableRow } from './types'
import { uid } from './util'

export function rowsOf(value: unknown): TableRow[] {
  return Array.isArray(value) ? (value.filter((r) => r && typeof r === 'object') as TableRow[]) : []
}

export function newRow(field: FieldDef): TableRow {
  const row: TableRow = { id: uid('row') }
  for (const c of field.columns ?? []) if (c.type === 'boolean') row[c.id] = false
  return row
}

const round2 = (n: number) => Math.round(n * 100) / 100

function computeColumn(c: ColumnDef, row: TableRow): unknown {
  if (!c.formula) return row[c.id]
  const [a, b] = c.formula.of.map((id) => Number(row[id]))
  if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return undefined
  return round2(c.formula.op === 'multiply' ? a * b : a + b)
}

/** Sum of a numeric column over the rows (empty cells count as 0). */
export function columnSum(rows: TableRow[], columnId: Id): number {
  return round2(rows.reduce((s, r) => s + (Number(r[columnId]) || 0), 0))
}

/**
 * Bring an item's data up to date: every row has an id, computed columns are
 * recalculated, and total fields equal the sum of their table column. Returns
 * the same object when nothing changed.
 */
export function normalizeData(type: ObjectType, data: Record<string, unknown>): Record<string, unknown> {
  let out = data
  const write = (k: string, v: unknown) => {
    if (JSON.stringify(out[k]) === JSON.stringify(v)) return
    if (out === data) out = { ...data }
    out[k] = v
  }
  for (const f of type.fields) {
    if (f.type !== 'table' || data[f.id] === undefined) continue
    const rows = rowsOf(data[f.id]).map((r) => {
      const next: TableRow = { ...r, id: r.id || uid('row') }
      for (const c of f.columns ?? []) if (c.formula) next[c.id] = computeColumn(c, next)
      return next
    })
    write(f.id, rows)
  }
  for (const f of type.fields) {
    if (!f.total) continue
    const table = type.fields.find((x) => x.id === f.total!.tableFieldId)
    if (table?.type !== 'table') continue
    write(f.id, columnSum(rowsOf(out[table.id]), f.total.columnId))
  }
  return out
}

/** Is this field filled in by the system from a table (a total of one of its columns)? */
export function isComputed(field: FieldDef): boolean {
  return !!field.total
}

/** Problems with a table's rows: too few or too many, or a required cell left empty. */
export function tableErrors(field: FieldDef, value: unknown): string | undefined {
  const rows = rowsOf(value)
  if (field.minRows && rows.length < field.minRows) return `${field.label} needs at least ${field.minRows} row${field.minRows === 1 ? '' : 's'}`
  if (field.maxRows && rows.length > field.maxRows) return `${field.label} allows at most ${field.maxRows} rows`
  for (const [i, r] of rows.entries()) {
    for (const c of field.columns ?? []) {
      if (!c.required || c.formula) continue
      const v = r[c.id]
      if (v === undefined || v === null || v === '') return `Row ${i + 1}: ${c.label} is required`
    }
  }
  return undefined
}

/** Plain text of a row, for search and summaries. */
export function rowText(field: FieldDef, row: TableRow, label: (c: ColumnDef, v: unknown) => string): string {
  return (field.columns ?? [])
    .map((c) => label(c, row[c.id]))
    .filter(Boolean)
    .join(' · ')
}
