import { Shield } from 'lucide-react'
import type { Group, Id, ObjectType } from '@modus-bpm/core/model/types'
import { FIELD_ICONS } from '../../components/icons'
import { Card } from '../../components/ui'
import { useDesign } from '../../store/design'
import { GroupPicker } from './SecurityShared'

/** Sensitive data on the object type: fields only some groups may see, anywhere. */
export function SecuritySensitive({ appId, type, groups }: { appId: Id; type: ObjectType; groups: Group[] }) {
  const updateType = useDesign((s) => s.updateType)
  const restricted = type.fields.filter((f) => f.restrictedTo?.length).length

  const set = (fieldId: Id, ids: Id[]) =>
    updateType(appId, type.id, (t) => {
      const f = t.fields.find((x) => x.id === fieldId)
      if (!f) return
      if (ids.length) f.restrictedTo = ids
      else delete f.restrictedTo
    })

  return (
    <Card>
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <Shield size={14} className="text-violet-600" /> Sensitive fields
        </h3>
        <p className="text-[11px] text-slate-500">
          On every {type.name.toLowerCase()}, in every workflow: only the groups listed can see the field. Everyone else gets it hidden, whatever the step says.{' '}
          {restricted ? `${restricted} restricted.` : 'None restricted yet.'}
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {type.fields.map((f) => {
          const Icon = FIELD_ICONS[f.type]
          return (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
              <span className="flex w-48 min-w-0 items-center gap-1.5 text-xs font-medium text-slate-800">
                <Icon size={13} className="shrink-0 text-slate-400" />
                <span className="truncate">{f.label}</span>
              </span>
              <span className="text-[11px] text-slate-500">Visible only to</span>
              <GroupPicker label={`Restrict ${f.label} to a group`} value={f.restrictedTo ?? []} groups={groups} empty="anyone with access" onChange={(ids) => set(f.id, ids)} />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
