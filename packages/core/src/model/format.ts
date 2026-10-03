import { itemLabel } from './lists'
import { tableErrors } from './tables'
import type { FieldDef, FieldType, ListDef, ObjectType, User } from './types'
import { currencyFmt } from './util'

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
  boolean: 'Yes / No',
  choice: 'List choice',
  user: 'Person',
  email: 'Email',
  attachment: 'File upload',
  table: 'Table (rows)',
}

export interface AttachmentValue {
  name: string
  size: number
  kind: string
  url?: string
}

export function formatFieldValue(field: FieldDef, value: unknown, lists: ListDef[], users: User[]): string {
  if (value === undefined || value === null || value === '') return ''
  switch (field.type) {
    case 'currency':
      return currencyFmt.format(Number(value) || 0)
    case 'number':
      return Number(value).toLocaleString()
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'choice':
      return itemLabel(
        lists.find((l) => l.id === field.listId),
        value,
      )
    case 'user':
      return users.find((u) => u.id === value)?.name ?? ''
    case 'date': {
      const d = new Date(`${String(value)}T00:00:00`)
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    case 'attachment': {
      const files = Array.isArray(value) ? (value as AttachmentValue[]) : []
      return files.map((f) => f.name).join(', ')
    }
    case 'table': {
      const n = Array.isArray(value) ? value.length : 0
      return n ? `${n} ${n === 1 ? 'row' : 'rows'}` : ''
    }
    default:
      return String(value)
  }
}

/** A short human title for an object: its title field, or its first summary field. */
export function objectTitle(type: ObjectType | undefined, data: Record<string, unknown>, lists: ListDef[], users: User[]): string {
  if (!type) return ''
  const f = type.fields.find((x) => x.id === type.titleFieldId) ?? type.fields.find((x) => x.summary)
  return f ? formatFieldValue(f, data[f.id], lists, users) : ''
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function validateRequired(type: ObjectType, values: Record<string, unknown>, includeSystem = false): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of type.fields) {
    if (!f.required || (f.system && !includeSystem)) continue
    const v = values[f.id]
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    if (empty) errors[f.id] = `${f.label} is required`
  }
  // Tables: row count limits and required cells, whether or not the table itself is required.
  for (const f of type.fields) {
    if (f.type !== 'table' || errors[f.id] || (f.system && !includeSystem)) continue
    if (!f.required && (values[f.id] === undefined || (Array.isArray(values[f.id]) && !(values[f.id] as unknown[]).length))) continue
    const e = tableErrors(f, values[f.id])
    if (e) errors[f.id] = e
  }
  return errors
}
