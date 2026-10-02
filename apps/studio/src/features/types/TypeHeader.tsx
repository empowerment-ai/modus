import { GitBranch, ShieldCheck } from 'lucide-react'
import { TYPE_ICONS, TypeIcon } from '../../components/icons'
import { cx, Field, Input, Select } from '../../components/ui'
import type { App, ObjectType } from '@modus-bpm/core/model/types'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'

const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#475569']

export const TITLE_TYPES = new Set(['text', 'choice', 'user', 'number', 'currency', 'email', 'date'])

export function TypeHeader({ app, type }: { app: App; type: ObjectType }) {
  const update = (fn: (t: ObjectType) => void) => useDesign.getState().updateType(app.id, type.id, fn)
  const workflows = app.workflows.filter((w) => w.objectTypeId === type.id)

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-xs">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: `${type.color}17`, color: type.color }}>
          <TypeIcon name={type.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900">{type.name || 'Untitled type'}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck size={13} className="shrink-0 text-emerald-600" />
            Every {type.name ? type.name.toLowerCase() : 'object'} is searchable, editable and fully audited — those come free with the type.
          </p>
        </div>
        {workflows.length > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">Used by</span>
            {workflows.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  useUi.getState().setView('workflow')
                  useUi.getState().setWorkflow(w.id)
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
              >
                <GitBranch size={12} /> {w.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 pt-3.5">
        <Field label="Name">
          <Input value={type.name} onChange={(e) => update((t) => void (t.name = e.target.value))} />
        </Field>
        <Field label="Plural name">
          <Input value={type.pluralName} onChange={(e) => update((t) => void (t.pluralName = e.target.value))} />
        </Field>
        <Field label="Number prefix" hint={`New items are numbered ${type.numberPrefix || ''}1001, ${type.numberPrefix || ''}1002…`}>
          <Input value={type.numberPrefix} className="font-mono" onChange={(e) => update((t) => void (t.numberPrefix = e.target.value))} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 pt-3 pb-4">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">Icon</span>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Icon">
            {Object.keys(TYPE_ICONS).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={type.icon === name}
                aria-label={name}
                title={name}
                onClick={() => update((t) => void (t.icon = name))}
                className={cx(
                  'flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                  type.icon === name ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
              >
                <TypeIcon name={name} size={14} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">Color</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={type.color === c}
                aria-label={c}
                onClick={() => update((t) => void (t.color = c))}
                className={cx('h-6 w-6 rounded-full transition-transform hover:scale-110', type.color === c && 'ring-2 ring-slate-900 ring-offset-2')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <Field label="Title field" hint="Names each item on cards and in search results.">
          <Select value={type.titleFieldId ?? ''} onChange={(e) => update((t) => void (t.titleFieldId = e.target.value || undefined))}>
            <option value="">Number only</option>
            {type.fields
              .filter((f) => TITLE_TYPES.has(f.type))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </section>
  )
}
