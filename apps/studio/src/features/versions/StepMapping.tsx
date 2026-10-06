import { ArrowRight, Layers } from 'lucide-react'
import type { MissingStep } from '@modus-bpm/core'
import type { Id, WfNode } from '@modus-bpm/core/model/types'
import { plural } from '@modus-bpm/core/model/util'
import { Select } from '../../components/ui'

export const STEP_KIND: Record<WfNode['type'], string> = {
  start: 'Start',
  user: 'User step',
  auto: 'Automated',
  decision: 'Decision',
  split: 'Parallel split',
  join: 'Join',
  subflow: 'Subflow',
  wait: 'Timer',
  end: 'End',
}

/**
 * Items at steps the target version doesn't have: for each step, where its
 * items go (any step of the target version), or leave them where they are.
 */
export function StepMapping({
  missing,
  targets,
  toVersion,
  value,
  onChange,
}: {
  missing: MissingStep[]
  targets: WfNode[]
  toVersion: number
  value: Record<Id, Id>
  onChange: (next: Record<Id, Id>) => void
}) {
  if (!missing.length) return null
  const one = new Set(missing.flatMap((m) => m.objectIds)).size === 1
  const options = targets.filter((n) => n.type !== 'start')
  const set = (from: Id, to: Id) => {
    const next = { ...value }
    if (to) next[from] = to
    else delete next[from]
    onChange(next)
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
      <p className="text-xs font-medium text-amber-900">
        {one ? `This item is at a step version ${toVersion} doesn’t have. Choose where it goes.` : `Some items are at steps version ${toVersion} doesn’t have. Choose where they go.`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {missing.map((m) =>
          m.inside ? (
            <li key={m.nodeId} className="flex items-start gap-1.5 text-xs text-slate-600">
              <Layers size={13} className="mt-0.5 shrink-0 text-teal-600" />
              <span>
                {plural(m.count, 'item')} {m.count === 1 ? 'is' : 'are'} inside <b className="font-medium text-slate-800">“{m.label}”</b>; {m.count === 1 ? 'it stays' : 'they stay'} where{' '}
                {m.count === 1 ? 'it is' : 'they are'} until {m.count === 1 ? 'it comes' : 'they come'} out of that subflow.
              </span>
            </li>
          ) : (
            <li key={m.nodeId} className="space-y-1">
              <span className="block text-sm text-slate-800">
                “{m.label}” <span className="text-xs text-slate-500">· {plural(m.count, 'item')}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <ArrowRight size={13} className="shrink-0 text-slate-400" />
                <Select aria-label={`Where the items at “${m.label}” go`} value={value[m.nodeId] ?? ''} onChange={(e) => set(m.nodeId, e.target.value)} className="w-full min-w-0">
                  <option value="">{m.versions.length === 1 ? `Leave ${m.count === 1 ? 'it' : 'them'} on version ${m.versions[0]}` : 'Leave them on their versions'}</option>
                  {options.map((n) => (
                    <option key={n.id} value={n.id}>
                      {STEP_KIND[n.type]} · {n.data.label}
                    </option>
                  ))}
                </Select>
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
