import { Minus, PenLine, Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { WorkflowDiff } from '@modus-bpm/core'
import { cx } from '../../components/ui'

type Kind = 'added' | 'removed' | 'changed'

const MARK: Record<Kind, { icon: typeof Plus; tone: string }> = {
  added: { icon: Plus, tone: 'bg-emerald-50 text-emerald-700' },
  removed: { icon: Minus, tone: 'bg-rose-50 text-rose-700' },
  changed: { icon: PenLine, tone: 'bg-amber-50 text-amber-700' },
}

/** What a version changes, one line per step, path or setting. */
export function ChangeList({ diff, max = 8 }: { diff: WorkflowDiff; max?: number }) {
  const [all, setAll] = useState(false)
  const b = (s: string) => <b className="font-medium text-slate-900">“{s}”</b>
  const rows: Array<{ kind: Kind; key: string; text: ReactNode }> = [
    ...diff.steps.added.map((s) => ({ kind: 'added' as const, key: `sa${s.id}`, text: <>Added step {b(s.label)}</> })),
    ...diff.steps.removed.map((s) => ({ kind: 'removed' as const, key: `sr${s.id}`, text: <>Removed step {b(s.label)}</> })),
    ...diff.steps.changed.map((s) => ({
      kind: 'changed' as const,
      key: `sc${s.id}`,
      text: (
        <>
          Changed {b(s.label)}: {s.detail}
        </>
      ),
    })),
    ...diff.paths.added.map((p) => ({ kind: 'added' as const, key: `pa${p.id}`, text: <>Added path {p.label}</> })),
    ...diff.paths.removed.map((p) => ({ kind: 'removed' as const, key: `pr${p.id}`, text: <>Removed path {p.label}</> })),
    ...diff.paths.changed.map((p) => ({
      kind: 'changed' as const,
      key: `pc${p.id}`,
      text: (
        <>
          Changed path {p.label}: {p.detail}
        </>
      ),
    })),
    ...diff.settings.map((s) => ({ kind: 'changed' as const, key: `st${s}`, text: <>Changed {s.charAt(0).toLowerCase() + s.slice(1)}</> })),
  ]
  const shown = all ? rows : rows.slice(0, max)
  return (
    <ul className="space-y-1">
      {shown.map((r) => {
        const M = MARK[r.kind]
        return (
          <li key={r.key} className="flex items-start gap-2 text-sm text-slate-700">
            <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded', M.tone)}>
              <M.icon size={11} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 break-words">{r.text}</span>
          </li>
        )
      })}
      {rows.length > shown.length && (
        <li>
          <button type="button" onClick={() => setAll(true)} className="pl-6 text-xs font-medium text-brand-700 hover:text-brand-800">
            Show {rows.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  )
}
