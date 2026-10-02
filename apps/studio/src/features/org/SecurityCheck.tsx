import { UserSearch } from 'lucide-react'
import { useState } from 'react'
import { fieldVerdicts } from '@throughline/core'
import type { FieldAccess, Group, Id, ObjectType, User, Workflow } from '@throughline/core/model/types'
import { FIELD_ICONS } from '../../components/icons'
import { Avatar, Card, Field, Select } from '../../components/ui'
import { AccessChip, orderedUserSteps, passedFor, workersOf } from './SecurityShared'

const CREATE = '__create'
const VIEW = '__view'

/** Pick a person and a step: every field with what they can do and why. */
export function SecurityCheck({ type, wf, groups, users }: { type: ObjectType; wf: Workflow; groups: Group[]; users: User[] }) {
  const steps = orderedUserSteps(wf)
  const workers = new Set(steps.flatMap((n) => workersOf(n, groups)))
  const [userId, setUserId] = useState<Id>(() => (steps[0] && workersOf(steps[0], groups)[0]) || users[0]?.id || '')
  const [where, setWhere] = useState<string>(() => steps[0]?.id ?? CREATE)

  const user = users.find((u) => u.id === userId)
  const node = steps.find((n) => n.id === where)
  const at = node ? node.id : where === CREATE ? CREATE : VIEW
  const verdicts =
    at === CREATE
      ? fieldVerdicts({ type, creating: true, userId, groups })
      : node
        ? fieldVerdicts({ type, wf, node, passed: passedFor(wf, node.id), userId, groups })
        : fieldVerdicts({ type, wf, userId, groups })
  const memberOf = groups.filter((g) => g.memberIds.includes(userId))
  const counts: Record<FieldAccess, number> = { edit: 0, read: 0, hidden: 0 }
  for (const v of Object.values(verdicts)) counts[v.access]++
  const offStep = node && !workersOf(node, groups).includes(userId)

  return (
    <Card>
      <div className="border-b border-slate-200 px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
          <UserSearch size={14} className="text-brand-600" /> Check as a person
        </h3>
        <p className="text-[11px] text-slate-500">What one person can do with each field at one point in {wf.name}, using the same rules the engine enforces.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 px-4 pt-3">
        <Field label="Person" className="w-56">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <optgroup label={`Work steps in ${wf.name}`}>
              {users
                .filter((u) => workers.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Everyone else">
              {users
                .filter((u) => !workers.has(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </optgroup>
          </Select>
        </Field>
        <Field label="Where" className="w-56">
          <Select value={at} onChange={(e) => setWhere(e.target.value)}>
            <option value={CREATE}>Creating a new {type.name.toLowerCase()}</option>
            {steps.map((n) => (
              <option key={n.id} value={n.id}>
                Working “{n.data.label}”
              </option>
            ))}
            <option value={VIEW}>Opening it outside a step</option>
          </Select>
        </Field>
        {user && (
          <div className="flex min-w-0 items-center gap-2 pb-1 text-[11px] text-slate-500">
            <Avatar name={user.name} color={user.color} size={22} />
            <span className="min-w-0">
              <span className="font-medium text-slate-700">{user.title}</span>
              {memberOf.length > 0 && <> · {memberOf.map((g) => g.name).join(', ')}</>}
            </span>
          </div>
        )}
      </div>
      <div className="px-4 pt-2 text-[11px] text-slate-500">
        {counts.edit} editable · {counts.read} read-only · {counts.hidden} hidden
        {offStep && <span className="ml-2 text-amber-700">{user?.name ?? 'This person'} doesn’t work this step, so it wouldn’t reach them; shown as if it did.</span>}
      </div>
      <table className="mt-1 w-full text-left text-xs">
        <tbody>
          {type.fields.map((f) => {
            const v = verdicts[f.id]!
            const Icon = FIELD_ICONS[f.type]
            return (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="w-56 py-1.5 pr-2 pl-4">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-800">
                    <Icon size={13} className="shrink-0 text-slate-400" />
                    <span className="truncate">{f.label}</span>
                  </span>
                </td>
                <td className="w-24 px-2 py-1.5">
                  <AccessChip access={v.access} />
                </td>
                <td className="py-1.5 pr-4 pl-2 text-slate-500">{v.reason ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
