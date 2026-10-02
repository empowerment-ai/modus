import { FileStack, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { TypeIcon } from '../../components/icons'
import { Button, cx, EmptyState, Field, IconButton, Input, Modal } from '../../components/ui'
import { blankObjectType } from '@modus-bpm/core/model/seed'
import type { App, ObjectType } from '@modus-bpm/core/model/types'
import { useApp, useDesign } from '../../store/design'
import { useUi } from '../../store/ui'
import { FieldList } from './FieldList'
import { FormPreview } from './FormPreview'
import { TypeHeader } from './TypeHeader'

export function TypesView() {
  const appId = useUi((s) => s.appId)
  const typeId = useUi((s) => s.typeId)
  const app = useApp(appId)
  const [selected, setSelected] = useState<{ typeId: string; fieldId: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<ObjectType | null>(null)

  if (!app) return null
  const type = app.objectTypes.find((t) => t.id === typeId) ?? app.objectTypes[0]
  const selectedFieldId = type && selected?.typeId === type.id && type.fields.some((f) => f.id === selected.fieldId) ? selected.fieldId : null
  const selectField = (fieldId: string | null) => setSelected(type && fieldId ? { typeId: type.id, fieldId } : null)

  const askDelete = (t: ObjectType) => {
    const users = app.workflows.filter((w) => w.objectTypeId === t.id)
    if (users.length) {
      useUi.getState().toast(`Can’t delete “${t.name}”: the ${users.map((w) => `“${w.name}”`).join(', ')} workflow${users.length > 1 ? 's use' : ' uses'} it.`, 'warn')
      return
    }
    setDeleting(t)
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Object Types</h2>
            <p className="text-[11px] text-slate-500">{app.objectTypes.length} in {app.name}</p>
          </div>
          <IconButton label="New object type" onClick={() => setCreating(true)}>
            <Plus size={16} />
          </IconButton>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {app.objectTypes.map((t) => {
            const active = t.id === type?.id
            return (
              <li key={t.id} className="group relative">
                <button
                  type="button"
                  onClick={() => useUi.getState().setType(t.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-2 pr-8 text-left transition-colors', active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${t.color}17`, color: t.color }}>
                    <TypeIcon name={t.icon} size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className={cx('block truncate text-sm font-medium', active ? 'text-brand-800' : 'text-slate-800')}>{t.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      {t.fields.length} field{t.fields.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
                <IconButton
                  label={`Delete ${t.name}`}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-rose-600"
                  onClick={() => askDelete(t)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            )
          })}
        </ul>
        <div className="border-t border-slate-200 p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New object type
          </Button>
        </div>
      </aside>

      {type ? (
        <>
          <div className="min-w-0 flex-1 overflow-y-auto bg-canvas">
            <div className="mx-auto max-w-3xl space-y-4 p-5">
              <TypeHeader app={app} type={type} />
              <FieldList app={app} type={type} selectedId={selectedFieldId} onSelect={selectField} />
            </div>
          </div>
          <FormPreview key={type.id} app={app} type={type} selectedFieldId={selectedFieldId} onFieldClick={(id) => selectField(id)} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-canvas">
          <EmptyState icon={<FileStack size={32} />} title="No object types yet">
            An object type models a business object such as an invoice: its fields become the form, and workflow rules decide on its values.
            <div className="mt-3">
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                New object type
              </Button>
            </div>
          </EmptyState>
        </div>
      )}

      <NewTypeModal open={creating} onClose={() => setCreating(false)} app={app} />
      <DeleteTypeModal type={deleting} onClose={() => setDeleting(null)} app={app} />
    </div>
  )
}

function NewTypeModal({ open, onClose, app }: { open: boolean; onClose: () => void; app: App }) {
  const [name, setName] = useState('')
  const create = () => {
    const t = blankObjectType(name.trim() || 'New Type')
    useDesign.getState().updateApp(app.id, (a) => {
      a.objectTypes.push(t)
    })
    useUi.getState().setType(t.id)
    useUi.getState().toast(`Created the “${t.name}” object type. Add its fields next.`, 'success')
    setName('')
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New object type"
      subtitle="A business object your process works on, such as a contract, claim or purchase request."
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create}>
            Create type
          </Button>
        </>
      }
    >
      <Field label="Name (singular)">
        <Input autoFocus value={name} placeholder="e.g. Contract" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
      </Field>
    </Modal>
  )
}

function DeleteTypeModal({ type, onClose, app }: { type: ObjectType | null; onClose: () => void; app: App }) {
  const remove = () => {
    if (!type) return
    useDesign.getState().updateApp(app.id, (a) => {
      a.objectTypes = a.objectTypes.filter((t) => t.id !== type.id)
    })
    const next = app.objectTypes.find((t) => t.id !== type.id)
    useUi.getState().setType(next?.id)
    useUi.getState().toast(`Deleted the “${type.name}” object type.`)
    onClose()
  }
  return (
    <Modal
      open={!!type}
      onClose={onClose}
      title={`Delete “${type?.name ?? ''}”?`}
      subtitle="Its field definitions are removed from this application. This can’t be undone."
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={<Trash2 size={14} />} onClick={remove}>
            Delete type
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {type?.fields.length ?? 0} field{type?.fields.length === 1 ? '' : 's'} will be removed. No workflow uses this type, so no running work is affected.
      </p>
    </Modal>
  )
}
