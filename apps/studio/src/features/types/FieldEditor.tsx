import { Copy, ListTree, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, Input, Segmented, Select, Toggle } from '../../components/ui'
import { FIELD_TYPE_LABEL } from '@modus-bpm/core/model/format'
import type { App, FieldDef, FieldType, ObjectType } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { blockingReferences, describeRefs, FIELD_TYPE_ORDER, parentCandidates, sanitizeParents, workflowReferences } from './references'
import { TITLE_TYPES } from './TypeHeader'

interface Props {
  app: App
  type: ObjectType
  field: FieldDef
  onSelect: (fieldId: string | null) => void
}

export function FieldEditor({ app, type, field, onSelect }: Props) {
  const toast = useUi((s) => s.toast)
  const [confirmDelete, setConfirmDelete] = useState(false)

  /** Mutate this field (and, if needed, the whole type) in one immer recipe. */
  const update = (fn: (f: FieldDef, t: ObjectType) => void) =>
    useDesign.getState().updateType(app.id, type.id, (t) => {
      const f = t.fields.find((x) => x.id === field.id)
      if (!f) return
      fn(f, t)
      sanitizeParents(t)
    })

  const list = app.lists.find((l) => l.id === field.listId)
  const level = field.level ?? 0
  const candidates = parentCandidates(type.fields, field)
  const children = type.fields.filter((f) => f.parentFieldId === field.id)

  const changeType = (next: FieldType) => {
    if (next === field.type) return
    if (field.type === 'choice' && next !== 'choice' && children.length) {
      toast(`“${field.label}” is the parent of ${children.map((c) => `“${c.label}”`).join(', ')}. Unlink those fields first.`, 'warn')
      return
    }
    const refs = workflowReferences(app, type, field.id)
    update((f) => {
      f.type = next
      delete f.listId
      delete f.level
      delete f.parentFieldId
      delete f.min
      delete f.max
      if (next === 'choice') {
        f.listId = app.lists[0]?.id
        f.level = 0
      }
      if (next === 'textarea') f.width = 'full'
    })
    if (type.titleFieldId === field.id && !TITLE_TYPES.has(next)) useDesign.getState().updateType(app.id, type.id, (t) => void (t.titleFieldId = undefined))
    if (refs.length) toast(`“${field.label}” is used by ${describeRefs(refs)}. Check those rules still make sense for a ${FIELD_TYPE_LABEL[next]} field.`, 'warn')
  }

  const changeList = (listId: string) =>
    update((f) => {
      f.listId = listId || undefined
      f.level = 0
      delete f.parentFieldId
    })

  const changeLevel = (next: number) =>
    update((f, t) => {
      f.level = next
      if (next === 0) {
        delete f.parentFieldId
        return
      }
      const cands = parentCandidates(t.fields, f)
      if (!cands.some((c) => c.id === f.parentFieldId)) {
        if (cands.length === 1) f.parentFieldId = cands[0]!.id
        else delete f.parentFieldId
      }
    })

  const duplicate = () => {
    const id = uid('f')
    useDesign.getState().updateType(app.id, type.id, (t) => {
      const at = t.fields.findIndex((x) => x.id === field.id)
      const copy: FieldDef = { ...structuredClone(field), id, label: `${field.label} (copy)` }
      t.fields.splice(at + 1, 0, copy)
    })
    onSelect(id)
  }

  const remove = () => {
    const refs = blockingReferences(app, type, field.id)
    if (refs.length) {
      setConfirmDelete(false)
      toast(`Can’t delete “${field.label}”: it is used by ${describeRefs(refs)}.`, 'warn')
      return
    }
    const label = field.label
    useDesign.getState().updateApp(app.id, (a) => {
      const t = a.objectTypes.find((x) => x.id === type.id)
      if (!t) return
      t.fields = t.fields.filter((x) => x.id !== field.id)
      if (t.titleFieldId === field.id) t.titleFieldId = t.fields.find((x) => x.summary)?.id ?? t.fields[0]?.id
      for (const wf of a.workflows) {
        if (wf.objectTypeId !== t.id) continue
        for (const n of wf.nodes) if (n.type === 'user') delete n.data.fieldAccess[field.id]
      }
    })
    onSelect(null)
    toast(`Deleted the “${label}” field.`)
  }

  return (
    <div className="border-t border-brand-100 bg-white px-4 pt-3.5 pb-4" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Field label="Label">
          <Input autoFocus value={field.label} onChange={(e) => update((f) => void (f.label = e.target.value))} />
        </Field>
        <Field label="Field type">
          <Select value={field.type} onChange={(e) => changeType(e.target.value as FieldType)}>
            {FIELD_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="col-span-2">
          <Field label="Help text" hint="Shown under the field on the form.">
            <Input value={field.helpText ?? ''} placeholder="Optional guidance for the person filling in the form" onChange={(e) => update((f) => void (f.helpText = e.target.value || undefined))} />
          </Field>
        </div>

        {(field.type === 'number' || field.type === 'currency') && (
          <>
            <Field label="Minimum" hint="Also shapes the simulated values.">
              <Input type="number" value={field.min ?? ''} onChange={(e) => update((f) => void (f.min = e.target.value === '' ? undefined : Number(e.target.value)))} />
            </Field>
            <Field label="Maximum">
              <Input type="number" value={field.max ?? ''} onChange={(e) => update((f) => void (f.max = e.target.value === '' ? undefined : Number(e.target.value)))} />
            </Field>
          </>
        )}

        {field.type === 'choice' && (
          <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              <Field label="Draws its options from">
                <Select value={field.listId ?? ''} onChange={(e) => changeList(e.target.value)}>
                  <option value="">Choose a list…</option>
                  {app.lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.levels.length > 1 ? ` (${l.levels.length} levels)` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              {list && list.levels.length > 1 ? (
                <Field label="Level">
                  <Select value={level} onChange={(e) => changeLevel(Number(e.target.value))}>
                    {list.levels.map((name, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div className="flex items-end pb-1.5 text-[11px] text-slate-500">{list ? 'Flat list: one level of options.' : ''}</div>
              )}
              {list && level > 0 && (
                <div className="col-span-2">
                  <Field label={`Follows (the ${list.levels[level - 1] ?? 'parent'} field)`}>
                    <Select value={field.parentFieldId ?? ''} onChange={(e) => update((f) => void (f.parentFieldId = e.target.value || undefined))}>
                      <option value="">Choose the parent field…</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!field.parentFieldId && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700">
                      <TriangleAlert size={12} className="mt-px shrink-0" />
                      {candidates.length
                        ? `Without a parent field this list has nothing to narrow by, so it shows no options. Pick the ${list.levels[level - 1]} field it follows.`
                        : `Add a field for “${list.levels[level - 1]}” first, or use “Add linked list fields” to create the whole chain at once.`}
                    </p>
                  )}
                  {field.parentFieldId && (
                    <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                      Options narrow to the {list.levels[level]} values under whatever {list.levels[level - 1]} is picked. Changing the parent clears this field.
                    </p>
                  )}
                </div>
              )}
              {list && (
                <div className="col-span-2 -mt-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"
                    onClick={() => {
                      useUi.getState().setList(list.id)
                      useUi.getState().setView('lists')
                    }}
                  >
                    <ListTree size={12} /> Edit the values in “{list.name}”
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2.5 pt-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Width</span>
            <Segmented
              size="sm"
              value={field.width}
              onChange={(w) => update((f) => void (f.width = w))}
              options={[
                { value: 'half', label: 'Half' },
                { value: 'full', label: 'Full' },
              ]}
            />
          </div>
          <Toggle checked={!!field.required} onChange={(v) => update((f) => void (f.required = v || undefined))} label={<span className="text-xs">Required</span>} />
          <Toggle checked={!!field.summary} onChange={(v) => update((f) => void (f.summary = v || undefined))} label={<span className="text-xs">Show in summaries</span>} />
          <Toggle checked={!!field.system} onChange={(v) => update((f) => void (f.system = v || undefined))} label={<span className="text-xs">Set by workflow</span>} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
        <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={duplicate}>
          Duplicate
        </Button>
        {type.titleFieldId !== field.id && TITLE_TYPES.has(field.type) && (
          <Button size="sm" variant="ghost" onClick={() => useDesign.getState().updateType(app.id, type.id, (t) => void (t.titleFieldId = field.id))}>
            Use as title
          </Button>
        )}
        <div className="flex-1" />
        {confirmDelete ? (
          <>
            <span className="text-xs text-slate-500">Delete this field?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={remove}>
              Delete field
            </Button>
          </>
        ) : (
          <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
