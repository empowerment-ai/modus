import { Users, X } from 'lucide-react'
import { Avatar, Select } from '../../../components/ui'
import type { Audience, Group, Id, User } from '@modus-bpm/core/model/types'

/** A set of people: named users and whole groups, as removable chips plus one "add" picker. */
export function AudiencePicker({
  value,
  onChange,
  users,
  groups,
  placeholder = 'Add a person or group…',
  emptyText,
}: {
  value: Audience | undefined
  onChange: (a: Audience | undefined) => void
  users: User[]
  groups: Group[]
  placeholder?: string
  emptyText?: string
}) {
  const userIds = value?.userIds ?? []
  const groupIds = value?.groupIds ?? []

  // Store undefined (not empty arrays) when nobody is left.
  const emit = (u: Id[], g: Id[]) => onChange(u.length || g.length ? { userIds: u.length ? u : undefined, groupIds: g.length ? g : undefined } : undefined)

  const add = (key: string) => {
    const [kind, id] = [key.slice(0, 2), key.slice(2)]
    if (!id) return
    if (kind === 'u:') emit([...userIds, id], groupIds)
    else emit(userIds, [...groupIds, id])
  }

  const people = userIds.map((id) => ({ id, user: users.find((u) => u.id === id) }))
  const teams = groupIds.map((id) => ({ id, group: groups.find((g) => g.id === id) }))

  return (
    <div>
      {people.length + teams.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {teams.map(({ id, group }) => (
            <span key={`g${id}`} className="inline-flex items-center gap-1 rounded-full bg-violet-50 py-0.5 pr-0.5 pl-1.5 text-[11px] font-medium text-violet-800 ring-1 ring-violet-100">
              <Users size={11} className="shrink-0" />
              {group ? `${group.name} (${group.memberIds.length})` : 'Removed group'}
              <RemoveChip
                label={`Remove ${group?.name ?? 'group'}`}
                onClick={() =>
                  emit(
                    userIds,
                    groupIds.filter((x) => x !== id),
                  )
                }
              />
            </span>
          ))}
          {people.map(({ id, user }) => (
            <span key={`u${id}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pr-0.5 pl-0.5 text-[11px] font-medium text-slate-700">
              {user ? <Avatar name={user.name} color={user.color} size={16} /> : null}
              {user?.name ?? 'Removed person'}
              <RemoveChip
                label={`Remove ${user?.name ?? 'person'}`}
                onClick={() =>
                  emit(
                    userIds.filter((x) => x !== id),
                    groupIds,
                  )
                }
              />
            </span>
          ))}
        </div>
      ) : (
        emptyText && <p className="mb-1.5 text-[11px] text-slate-500">{emptyText}</p>
      )}
      <Select className="h-7 text-xs" value="" onChange={(e) => add(e.target.value)} aria-label={placeholder}>
        <option value="">{placeholder}</option>
        <optgroup label="People">
          {users
            .filter((u) => !userIds.includes(u.id))
            .map((u) => (
              <option key={u.id} value={`u:${u.id}`}>
                {u.name} — {u.title}
              </option>
            ))}
        </optgroup>
        <optgroup label="Groups (everyone in them)">
          {groups
            .filter((g) => !groupIds.includes(g.id))
            .map((g) => (
              <option key={g.id} value={`g:${g.id}`}>
                {g.name} ({g.memberIds.length})
              </option>
            ))}
        </optgroup>
      </Select>
    </div>
  )
}

function RemoveChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-full p-0.5 text-current opacity-60 hover:bg-black/5 hover:opacity-100">
      <X size={11} />
    </button>
  )
}

/** Names of everyone an audience covers, for tooltips: "Carla Diaz, Finance Leadership (3)". */
export function audienceText(a: Audience | undefined, users: User[], groups: Group[]): string {
  const names = [
    ...(a?.userIds ?? []).map((id) => users.find((u) => u.id === id)?.name),
    ...(a?.groupIds ?? []).map((id) => {
      const g = groups.find((x) => x.id === id)
      return g ? `${g.name} (${g.memberIds.length})` : undefined
    }),
  ].filter(Boolean)
  return names.join(', ')
}

export function audienceSize(a: Audience | undefined): number {
  return (a?.userIds?.length ?? 0) + (a?.groupIds?.length ?? 0)
}
