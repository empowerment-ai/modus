import { ArrowUpToLine, GitCommitHorizontal } from 'lucide-react'
import { useState } from 'react'
import { itemVersion, missingSteps, publishedVersion, type SimObject, versionOf } from '@modus-bpm/core'
import type { App, Id, Workflow } from '@modus-bpm/core/model/types'
import { Button } from '../../components/ui'
import { ctxFor, useSim } from '../../store/sim'
import { moveItems } from './actions'
import { StepMapping } from './StepMapping'

/** The workflows an item runs right now (its process, then any subflow it is inside), with its version of each. */
export function itemVersions(app: App, obj: SimObject): Array<{ wf: Workflow; version: number; live: number }> {
  const ids = [obj.workflowId, ...obj.tokens.flatMap((t) => [...t.calls.map((c) => c.workflowId), t.workflowId])]
  const out: Array<{ wf: Workflow; version: number; live: number }> = []
  for (const id of new Set(ids)) {
    const wf = app.workflows.find((w) => w.id === id)
    const version = itemVersion(wf, obj)
    const live = publishedVersion(wf)
    if (wf && version !== undefined && live !== undefined) out.push({ wf, version, live })
  }
  return out
}

/** "Version 2 of Invoice Approval (latest: 3)". */
export function VersionLine({ app, obj }: { app: App; obj: SimObject }) {
  const runs = itemVersions(app, obj)
  if (!runs.length || obj.status !== 'active') return null
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
      {runs.map(({ wf, version, live }) => (
        <span key={wf.id} className="inline-flex items-center gap-1">
          <GitCommitHorizontal size={12} className="shrink-0 text-slate-400" />
          Version {version} of {wf.name}
          <span className={version === live ? 'text-slate-400' : 'font-medium text-amber-700'}>{version === live ? '(latest)' : `(latest: ${live})`}</span>
        </span>
      ))}
    </p>
  )
}

/** Administrator: move this item onto the latest version, choosing where work goes when its step is gone. */
export function MoveToLatest({ app, obj, wf, version, live }: { app: App; obj: SimObject; wf: Workflow; version: number; live: number }) {
  const [mapping, setMapping] = useState(false)
  const [stepMap, setStepMap] = useState<Record<Id, Id>>({})
  const target = versionOf(wf, live)
  const sim = useSim.getState().sims[app.id]
  const ctx = ctxFor(app.id)
  const missing = sim && ctx && target ? missingSteps(sim, ctx, wf.id, target.snapshot.nodes, { objectIds: [obj.id] }) : []

  // One item moves whole or not at all: every step it is at needs a place in the new version.
  const blocked = mapping && missing.some((m) => m.inside || !stepMap[m.nodeId])

  const move = () => {
    if (!mapping && missing.length) return setMapping(true)
    moveItems(wf.id, live, { objectIds: [obj.id], stepMap })
    setMapping(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm text-slate-700">
          On version {version} of {wf.name}; version {live} is live.
        </span>
        <Button variant={mapping ? 'primary' : 'secondary'} icon={<ArrowUpToLine size={14} />} disabled={blocked} onClick={move}>
          Move to version {live}
        </Button>
        {mapping && (
          <Button variant="ghost" onClick={() => setMapping(false)}>
            Cancel
          </Button>
        )}
      </div>
      {mapping && <StepMapping missing={missing} targets={target?.snapshot.nodes ?? []} toVersion={live} value={stepMap} onChange={setStepMap} />}
    </div>
  )
}
