import { Eye, EyeOff, type LucideIcon, Pencil, X } from 'lucide-react'
import { fieldVerdicts, type FieldVerdict, reachable } from '@throughline/core'
import type { FieldAccess, Group, Id, ObjectType, User, WfNode, Workflow } from '@throughline/core/model/types'
import { cx, Select } from '../../components/ui'

export type UserNode = Extract<WfNode, { type: 'user' }>

export const RANK: Record<FieldAccess, number> = { edit: 0, read: 1, hidden: 2 }
export const NEXT: Record<FieldAccess, FieldAccess> = { edit: 'read', read: 'hidden', hidden: 'edit' }

export const ACCESS: Record<FieldAccess, { label: string; long: string; icon: LucideIcon; chip: string }> = {
  edit: { label: 'Edit', long: 'Can edit', icon: Pencil, chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  read: { label: 'Read', long: 'Read only', icon: Eye, chip: 'bg-sky-50 text-sky-800 ring-sky-200' },
  hidden: { label: 'Hidden', long: 'Hidden', icon: EyeOff, chip: 'bg-slate-100 text-slate-700 ring-slate-200' },
}

export function AccessChip({ access, muted, className }: { access: FieldAccess; muted?: boolean; className?: string }) {
  const a = ACCESS[access]
  const Icon = a.icon
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        muted ? 'bg-white text-slate-400 line-through decoration-slate-400 ring-slate-200' : a.chip,
        className,
      )}
    >
      <Icon size={11} className="shrink-0" />
      {a.label}
    </span>
  )
}

/** User steps in the order work reaches them (breadth-first from the start), then any unreachable ones. */
export function orderedUserSteps(wf: Workflow): UserNode[] {
  const order: string[] = []
  const queue = wf.nodes.filter((n) => n.type === 'start').map((n) => n.id)
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    for (const e of wf.edges) if (e.source === id) queue.push(e.target)
  }
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length)
  return wf.nodes.filter((n): n is UserNode => n.type === 'user').sort((a, b) => rank(a.id) - rank(b.id) || a.position.x - b.position.x)
}

/** Steps an item has certainly left when it reaches `nodeId` (what "after step X" locks look at), as the security matrix assumes. */
export function passedFor(wf: Workflow, nodeId: Id): Id[] {
  return (wf.fieldLocks ?? []).filter((l) => l.when === 'after' && l.afterNodeId && reachable(wf, l.afterNodeId, nodeId)).map((l) => l.afterNodeId!)
}

/** The people who work a step: the named person for direct assignment, otherwise the group. */
export function workersOf(node: UserNode, groups: Group[]): Id[] {
  if (node.data.distribution === 'direct' && node.data.userId) return [node.data.userId]
  return groups.find((g) => g.id === node.data.groupId)?.memberIds ?? []
}

export interface Effective {
  /** Strictest access anyone working the step gets. */
  access: FieldAccess
  /** Everyone working the step gets the same. */
  uniform: boolean
  /** Distinct outcomes, strictest first, with who gets each. */
  groups: Array<{ verdict: FieldVerdict; userIds: Id[] }>
}

/**
 * Effective access per field for the people who work a step, using the engine's own
 * rules (sensitive data, workflow locks with their exemptions, the step setting).
 */
export function effectiveAtStep(type: ObjectType, wf: Workflow, node: UserNode, groups: Group[]): Record<Id, Effective> {
  const passed = passedFor(wf, node.id)
  const people = workersOf(node, groups)
  const per = people.length
    ? people.map((userId) => ({ userId, v: fieldVerdicts({ type, wf, node, passed, userId, groups }) }))
    : [{ userId: '', v: fieldVerdicts({ type, wf, node, passed, groups }) }]
  const out: Record<Id, Effective> = {}
  for (const f of type.fields) {
    const byKey = new Map<string, { verdict: FieldVerdict; userIds: Id[] }>()
    for (const { userId, v } of per) {
      const verdict = v[f.id]!
      const key = `${verdict.access}|${verdict.reason ?? ''}`
      const entry = byKey.get(key) ?? { verdict, userIds: [] }
      if (userId) entry.userIds.push(userId)
      byKey.set(key, entry)
    }
    const list = [...byKey.values()].sort((a, b) => RANK[b.verdict.access] - RANK[a.verdict.access])
    out[f.id] = { access: list[0]!.verdict.access, uniform: list.length === 1, groups: list }
  }
  return out
}

export function namesOf(ids: Id[], users: User[], max = 3): string {
  const names = ids.map((id) => users.find((u) => u.id === id)?.name ?? 'someone')
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/** Pick several groups: chips with remove buttons plus an "add" select. */
export function GroupPicker({ value, groups, onChange, empty, label }: { value: Id[]; groups: Group[]; onChange: (ids: Id[]) => void; empty: string; label: string }) {
  const chosen = value.map((id) => groups.find((g) => g.id === id)).filter((g): g is Group => !!g)
  const rest = groups.filter((g) => !value.includes(g.id))
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chosen.length === 0 && <span className="text-xs text-slate-400">{empty}</span>}
      {chosen.map((g) => (
        <span key={g.id} className="inline-flex items-center gap-0.5 rounded bg-violet-50 py-0.5 pr-0.5 pl-1.5 text-[11px] font-medium text-violet-800">
          {g.name}
          <button
            type="button"
            aria-label={`Remove ${g.name}`}
            className="rounded p-0.5 text-violet-500 hover:bg-violet-100 hover:text-violet-900"
            onClick={() => onChange(value.filter((x) => x !== g.id))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {rest.length > 0 && (
        <Select aria-label={label} className="h-6 w-auto max-w-[150px] py-0 pr-6 pl-1.5 text-[11px] text-slate-500" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">+ Add group</option>
          {rest.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}
