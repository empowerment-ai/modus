import { Mail, PencilLine, Plug, Trash2 } from 'lucide-react'
import { Button, IconButton, Input, Select } from '../../../components/ui'
import type { ActionDef, ObjectType, User } from '@modus-bpm/core/model/types'
import { uid } from '@modus-bpm/core/model/util'
import { NumberInput } from './common'

const DATE_TOKENS = [
  ['{today}', 'Today'],
  ['{today+7}', 'Today + 7 days'],
  ['{today+14}', 'Today + 14 days'],
  ['{today+30}', 'Today + 30 days'],
]

/** Edits the actions an automated step (or a release outcome) performs on the object. */
export function ActionsEditor({
  actions,
  onChange,
  type,
  users,
  kinds = ['setField', 'notify', 'integration'],
}: {
  actions: ActionDef[]
  onChange: (next: ActionDef[]) => void
  type?: ObjectType
  users: User[]
  kinds?: Array<ActionDef['kind']>
}) {
  const set = (i: number, patch: Partial<ActionDef>) => onChange(actions.map((a, j) => (j === i ? ({ ...a, ...patch } as ActionDef) : a)))
  const remove = (i: number) => onChange(actions.filter((_, j) => j !== i))
  // A single value can't fill a table, a file upload or a calculated total.
  const fields = (type?.fields ?? []).filter((f) => f.type !== 'table' && f.type !== 'attachment' && !f.total)

  return (
    <div className="space-y-2">
      {actions.map((a, i) => (
        <div key={a.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-700">
            {a.kind === 'setField' ? <PencilLine size={13} className="text-violet-600" /> : a.kind === 'notify' ? <Mail size={13} className="text-sky-600" /> : <Plug size={13} className="text-amber-600" />}
            {a.kind === 'setField' ? 'Set a field' : a.kind === 'notify' ? 'Send an email' : 'Call another system'}
            <IconButton label="Remove action" className="ml-auto h-6 w-6" onClick={() => remove(i)}>
              <Trash2 size={13} />
            </IconButton>
          </div>
          {a.kind === 'setField' && (
            <div className="grid grid-cols-2 gap-2">
              <Select value={a.fieldId} onChange={(e) => set(i, { fieldId: e.target.value })}>
                {!fields.some((f) => f.id === a.fieldId) && <option value={a.fieldId}>{type?.fields.find((f) => f.id === a.fieldId)?.label ?? 'Removed field'}</option>}
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <ValueInput field={fields.find((f) => f.id === a.fieldId)} value={a.value} users={users} onChange={(value) => set(i, { value })} />
            </div>
          )}
          {a.kind === 'notify' && (
            <div className="space-y-2">
              <Input value={a.to} placeholder="To (e.g. Vendor Contact Email)" onChange={(e) => set(i, { to: e.target.value })} />
              <Input value={a.message} placeholder="Subject — {number} inserts the object number" onChange={(e) => set(i, { message: e.target.value })} />
            </div>
          )}
          {a.kind === 'integration' && (
            <div className="space-y-2">
              <Input value={a.system} placeholder="System and operation, e.g. ERP · post payable" onChange={(e) => set(i, { system: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Select value={a.resultFieldId ?? ''} onChange={(e) => set(i, { resultFieldId: e.target.value || undefined })} title="Store whether the call succeeded">
                  <option value="">Don’t store result</option>
                  {fields
                    .filter((f) => f.type === 'boolean' || f.type === 'text')
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        Result → {f.label}
                      </option>
                    ))}
                </Select>
                <NumberInput value={Math.round(a.successRate * 100)} min={0} max={100} suffix="% ok" onChange={(v) => set(i, { successRate: Math.min(100, Math.max(0, v ?? 0)) / 100 })} />
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {kinds.includes('setField') && (
          <Button size="sm" variant="subtle" icon={<PencilLine size={13} />} disabled={!fields.length} onClick={() => onChange([...actions, { id: uid('a'), kind: 'setField', fieldId: fields[0]?.id ?? '', value: '' }])}>
            Set field
          </Button>
        )}
        {kinds.includes('notify') && (
          <Button size="sm" variant="subtle" icon={<Mail size={13} />} onClick={() => onChange([...actions, { id: uid('a'), kind: 'notify', to: '', message: '' }])}>
            Email
          </Button>
        )}
        {kinds.includes('integration') && (
          <Button size="sm" variant="subtle" icon={<Plug size={13} />} onClick={() => onChange([...actions, { id: uid('a'), kind: 'integration', system: '', successRate: 0.95 }])}>
            Call system
          </Button>
        )}
      </div>
    </div>
  )
}

function ValueInput({ field, value, users, onChange }: { field?: ObjectType['fields'][number]; value: string; users: User[]; onChange: (v: string) => void }) {
  if (field?.type === 'boolean')
    return (
      <Select value={/^(true|yes|1)$/i.test(value) ? 'true' : 'false'} onChange={(e) => onChange(e.target.value)}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    )
  if (field?.type === 'user')
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="{currentUser}">The person releasing it</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
    )
  if (field?.type === 'date')
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {!DATE_TOKENS.some(([t]) => t === value) && <option value={value}>{value || 'Pick…'}</option>}
        {DATE_TOKENS.map(([t, l]) => (
          <option key={t} value={t}>
            {l}
          </option>
        ))}
      </Select>
    )
  return <Input value={value} placeholder="Value" onChange={(e) => onChange(e.target.value)} />
}
