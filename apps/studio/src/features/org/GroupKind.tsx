import { type LucideIcon, UserCog, Users } from 'lucide-react'
import type { GroupKind } from '@modus-bpm/core/model/types'
import { cx } from '../../components/ui'

export const GROUP_KINDS: Record<GroupKind, { label: string; icon: LucideIcon; tile: string; help: string; placeholder: string }> = {
  team: {
    label: 'Team',
    icon: Users,
    tile: 'bg-brand-50 text-brand-600',
    help: 'Does the work at the steps it is assigned to.',
    placeholder: 'e.g. Enters and codes incoming invoices.',
  },
  distribution: {
    label: 'Distribution group',
    icon: UserCog,
    tile: 'bg-violet-50 text-violet-600',
    help: 'Dispatchers who hand work to a team. Any member can distribute; work waits for them.',
    placeholder: 'e.g. Supervisors who hand approvals to budget managers.',
  },
}

export const groupKind = (g: { kind?: GroupKind }): GroupKind => g.kind ?? 'team'

/** Two side-by-side choices with a line on what each kind of group does. */
export function GroupKindPicker({ value, onChange }: { value: GroupKind; onChange: (k: GroupKind) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kind of group">
      {(Object.keys(GROUP_KINDS) as GroupKind[]).map((k) => {
        const m = GROUP_KINDS[k]
        const Icon = m.icon
        const on = value === k
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(k)}
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
              on ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', m.tile)}>
              <Icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-800">{m.label}</span>
              <span className="block text-[11px] leading-snug text-slate-500">{m.help}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
