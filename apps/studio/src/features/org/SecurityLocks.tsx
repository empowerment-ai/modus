import { Lock, Plus, Trash2 } from 'lucide-react'
import type { FieldLock, Group, Id, ObjectType, Workflow } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { Button, Card, EmptyState, IconButton, Segmented, Select } from '../../components/ui'
import { useDesign } from '../../store/design'
import { GroupPicker } from './SecurityShared'

/** Workflow-wide locks: read-only or hidden everywhere, or once the item has passed a step. */
export function SecurityLocks({ appId, type, wf, groups }: { appId: Id; type: ObjectType; wf: Workflow; groups: Group[] }) {
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const locks = wf.fieldLocks ?? []
  // Any step an item can pass: everything but the start and the ends.
  const steps = wf.nodes.filter((n) => n.type !== 'start' && n.type !== 'end')

  const patch = (id: Id, fn: (l: FieldLock) => void) =>
    updateWorkflow(appId, wf.id, (w) => {
      const l = w.fieldLocks?.find((x) => x.id === id)
      if (l) fn(l)
    })

  const add = () =>
    updateWorkflow(appId, wf.id, (w) => {
      const fieldId = type.fields.find((f) => !w.fieldLocks?.some((l) => l.fieldId === f.id))?.id ?? type.fields[0]?.id
      if (!fieldId) return
      ;(w.fieldLocks ??= []).push({ id: uid('lk'), fieldId, access: 'read', when: 'always' })
    })

  const remove = (id: Id) =>
    updateWorkflow(appId, wf.id, (w) => {
      w.fieldLocks = (w.fieldLocks ?? []).filter((l) => l.id !== id)
    })

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Lock size={14} className="text-amber-600" /> Workflow locks
          </h3>
          <p className="text-[11px] text-slate-500">Freeze or hide a field everywhere in {wf.name}, or once an item has passed a step. Exempt groups can still change it.</p>
        </div>
        <Button size="sm" icon={<Plus size={13} />} onClick={add} disabled={!type.fields.length}>
          Add lock
        </Button>
      </div>
      {locks.length === 0 ? (
        <EmptyState title="No locks in this workflow">Lock the amount once it has been approved, or hide a field everywhere in this workflow.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {locks.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-slate-600">
              <Select className="w-44" aria-label="Field" value={l.fieldId} onChange={(e) => patch(l.id, (x) => void (x.fieldId = e.target.value))}>
                {type.fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <span>is</span>
              <Segmented<FieldLock['access']>
                size="sm"
                value={l.access}
                onChange={(access) => patch(l.id, (x) => void (x.access = access))}
                options={[
                  { value: 'read', label: 'Read-only' },
                  { value: 'hidden', label: 'Hidden' },
                ]}
              />
              <Select
                className="w-32"
                aria-label="When the lock applies"
                value={l.when}
                onChange={(e) =>
                  patch(l.id, (x) => {
                    x.when = e.target.value as FieldLock['when']
                    if (x.when === 'after' && !x.afterNodeId) x.afterNodeId = steps[0]?.id
                    if (x.when === 'always') delete x.afterNodeId
                  })
                }
              >
                <option value="always">always</option>
                <option value="after">after step…</option>
              </Select>
              {l.when === 'after' && (
                <Select className="w-48" aria-label="After step" value={l.afterNodeId ?? ''} onChange={(e) => patch(l.id, (x) => void (x.afterNodeId = e.target.value))}>
                  {steps.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.label}
                    </option>
                  ))}
                </Select>
              )}
              <span className="ml-1 text-slate-500">except</span>
              <GroupPicker
                label="Add an exempt group"
                value={l.exemptGroupIds ?? []}
                groups={groups}
                empty="no one"
                onChange={(ids) =>
                  patch(l.id, (x) => {
                    if (ids.length) x.exemptGroupIds = ids
                    else delete x.exemptGroupIds
                  })
                }
              />
              <div className="flex-1" />
              <IconButton label="Remove lock" onClick={() => remove(l.id)}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
