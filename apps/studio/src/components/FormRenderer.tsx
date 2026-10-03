import { EyeOff, Lock, Paperclip, Sigma, Upload, X } from 'lucide-react'
import { useRef } from 'react'
import { dependentFields, optionsForField } from '@modus-bpm/core/model/lists'
import { type AttachmentValue, formatBytes, formatFieldValue } from '@modus-bpm/core/model/format'
import { isComputed, normalizeData } from '@modus-bpm/core/model/tables'
import type { FieldAccess, FieldDef, ListDef, ObjectType, User } from '@modus-bpm/core/model/types'
import { TableField } from './TableField'
import { cx, Input, Select, Textarea, Toggle } from './ui'

// The UI is a by-product of the object type definition: this one component
// renders the create form, the step forms (with per-step field access), the
// designer preview, and the object detail view.

interface Props {
  type: ObjectType
  lists: ListDef[]
  users: User[]
  values: Record<string, unknown>
  /** Omit for a read-only rendering. */
  onChange?: (values: Record<string, unknown>) => void
  /** Per-field access for a workflow step's form. Fields not listed are editable. */
  access?: Record<string, FieldAccess>
  /** Include system fields (set by workflow steps). */
  includeSystem?: boolean
  errors?: Record<string, string>
  /** Highlight a field (used by the designer when a field is selected). */
  highlightFieldId?: string
  onFieldClick?: (fieldId: string) => void
}

export function FormRenderer({ type, lists, users, values, onChange, access, includeSystem, errors, highlightFieldId, onFieldClick }: Props) {
  const fields = type.fields.filter((f) => (includeSystem || !f.system) && access?.[f.id] !== 'hidden')
  const hiddenCount = access ? type.fields.filter((f) => (includeSystem || !f.system) && access[f.id] === 'hidden').length : 0

  const setValue = (field: FieldDef, v: unknown) => {
    if (!onChange) return
    const next = { ...values, [field.id]: v }
    // Changing a parent in a linked list clears everything beneath it.
    for (const dep of dependentFields(type, field.id)) delete next[dep.id]
    // Keep computed columns and totals (Amount = sum of Line Total) current as people type.
    onChange(normalizeData(type, next))
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        {fields.map((f) => {
          const computed = isComputed(f)
          const readOnly = !onChange || access?.[f.id] === 'read' || computed
          const source = f.total ? type.fields.find((x) => x.id === f.total!.tableFieldId) : undefined
          const column = source?.columns?.find((c) => c.id === f.total!.columnId)
          return (
            <div
              key={f.id}
              onClick={onFieldClick ? () => onFieldClick(f.id) : undefined}
              className={cx(
                'min-w-0',
                f.width === 'full' || f.type === 'table' ? 'col-span-2' : 'col-span-2 sm:col-span-1',
                onFieldClick && 'cursor-pointer rounded-md p-1.5 -m-1.5 hover:bg-slate-50',
                highlightFieldId === f.id && 'bg-brand-50 ring-2 ring-brand-300 hover:bg-brand-50',
              )}
            >
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span>{f.label}</span>
                {f.required && !readOnly && <span className="text-rose-500">*</span>}
                {readOnly && onChange && !computed && <Lock size={11} className="text-slate-400" aria-label="Read only at this step" />}
                {computed && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500" title="Calculated: it can’t be typed in">
                    <Sigma size={9} /> calculated
                  </span>
                )}
                {f.system && <span className="rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500">set by workflow</span>}
              </div>
              <FieldControl field={f} type={type} lists={lists} users={users} values={values} readOnly={readOnly} error={errors?.[f.id]} onValue={(v) => setValue(f, v)} />
              {errors?.[f.id] ? (
                <p className="mt-1 text-[11px] text-rose-600">{errors[f.id]}</p>
              ) : computed && onChange ? (
                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                  Adds up {column?.label ?? 'a column'} across {source?.label ?? 'a table'}.
                </p>
              ) : (
                f.helpText && !readOnly && <p className="mt-1 text-[11px] leading-snug text-slate-500">{f.helpText}</p>
              )}
            </div>
          )
        })}
      </div>
      {hiddenCount > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-slate-500">
          <EyeOff size={12} /> {hiddenCount} field{hiddenCount === 1 ? '' : 's'} hidden at this step
        </p>
      )}
    </div>
  )
}

function FieldControl({
  field,
  type,
  lists,
  users,
  values,
  readOnly,
  error,
  onValue,
}: {
  field: FieldDef
  type: ObjectType
  lists: ListDef[]
  users: User[]
  values: Record<string, unknown>
  readOnly: boolean
  error?: string
  onValue: (v: unknown) => void
}) {
  const v = values[field.id]
  if (field.type === 'table') return <TableField field={field} type={type} value={v} lists={lists} users={users} onChange={readOnly ? undefined : onValue} error={error} />
  if (readOnly) {
    if (field.type === 'attachment') return <AttachmentList files={Array.isArray(v) ? (v as AttachmentValue[]) : []} />
    const text = formatFieldValue(field, v, lists, users)
    return (
      <div
        className={cx('min-h-8 rounded-md border border-transparent bg-slate-50 px-2.5 py-1.5 text-sm', text ? 'text-slate-800' : 'text-slate-400', field.type === 'textarea' && 'whitespace-pre-wrap')}
      >
        {text || '—'}
      </div>
    )
  }
  switch (field.type) {
    case 'textarea':
      return <Textarea value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value)} />
    case 'number':
      return <Input type="number" min={field.min} max={field.max} value={v === undefined ? '' : String(v)} onChange={(e) => onValue(e.target.value === '' ? undefined : Number(e.target.value))} />
    case 'currency':
      return (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-slate-400">$</span>
          <Input
            type="number"
            step="0.01"
            min={0}
            className="pl-6 tabular-nums"
            value={v === undefined ? '' : String(v)}
            onChange={(e) => onValue(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      )
    case 'date':
      return <Input type="date" value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)} />
    case 'boolean':
      return (
        <div className="flex h-8 items-center">
          <Toggle checked={v === true} onChange={onValue} label={<span className="text-sm text-slate-600">{v === true ? 'Yes' : 'No'}</span>} />
        </div>
      )
    case 'email':
      return <Input type="email" value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value)} />
    case 'user':
      return (
        <Select value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value || undefined)}>
          <option value="">Select a person…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.title}
            </option>
          ))}
        </Select>
      )
    case 'choice': {
      const list = lists.find((l) => l.id === field.listId)
      const options = optionsForField(field, list, values)
      const parent = field.parentFieldId ? type.fields.find((f) => f.id === field.parentFieldId) : undefined
      const waiting = parent && !values[parent.id]
      return (
        <Select value={(v as string) ?? ''} disabled={!!waiting || !list} onChange={(e) => onValue(e.target.value || undefined)}>
          <option value="">{!list ? 'No list selected' : waiting ? `Choose ${parent!.label} first` : `Select ${field.label.toLowerCase()}…`}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      )
    }
    case 'attachment':
      return <AttachmentInput files={Array.isArray(v) ? (v as AttachmentValue[]) : []} onChange={onValue} />
    default:
      return <Input value={(v as string) ?? ''} onChange={(e) => onValue(e.target.value)} />
  }
}

export function AttachmentList({ files }: { files: AttachmentValue[] }) {
  if (!files.length) return <div className="min-h-8 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-400">No files</div>
  return (
    <ul className="space-y-1">
      {files.map((f, i) => (
        <li key={i} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
          <Paperclip size={13} className="shrink-0 text-slate-400" />
          {f.url ? (
            <a href={f.url} target="_blank" rel="noreferrer" className="truncate text-brand-700 hover:underline">
              {f.name}
            </a>
          ) : (
            <span className="truncate text-slate-700">{f.name}</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{formatBytes(f.size)}</span>
        </li>
      ))}
    </ul>
  )
}

function AttachmentInput({ files, onChange }: { files: AttachmentValue[]; onChange: (v: AttachmentValue[] | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1.5">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
          <Paperclip size={13} className="shrink-0 text-slate-400" />
          <span className="truncate text-slate-700">{f.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{formatBytes(f.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => {
              const next = files.filter((_, j) => j !== i)
              onChange(next.length ? next : undefined)
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 text-xs font-medium text-slate-600 hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-700"
      >
        <Upload size={13} /> Upload file
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size, kind: f.type, url: URL.createObjectURL(f) }))
          if (picked.length) onChange([...files, ...picked])
          e.target.value = ''
        }}
      />
    </div>
  )
}
