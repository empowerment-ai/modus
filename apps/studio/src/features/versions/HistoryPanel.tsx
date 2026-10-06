import { ArrowUpToLine, ChevronDown, History, RotateCcw, TriangleAlert, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { diffWorkflow, draftChanges, itemVersion, missingSteps, publishedVersion, versionUsage, type WorkflowVersion } from '@modus-bpm/core'
import type { App, Id, Workflow } from '@modus-bpm/core/model/types'
import { formatClock, plural } from '@modus-bpm/core/model/util'
import { Badge, Button, cx, IconButton } from '../../components/ui'
import { ctxFor, useSimState } from '../../store/sim'
import { useUi } from '../../store/ui'
import { moveItems, restoreAsDraft } from './actions'
import { ChangeList } from './ChangeList'
import { StepMapping } from './StepMapping'

const PANEL_KEYFRAMES = '@keyframes history-in{from{transform:translateX(28px);opacity:0}to{transform:none;opacity:1}}'

/** Every version of a workflow: its note, when it was published, who runs it, and what you can do with it. */
export function HistoryPanel({ app, wf, onClose }: { app: App; wf: Workflow; onClose: () => void }) {
  const sim = useSimState()
  const ctx = ctxFor(app.id)
  const usage = sim && ctx ? versionUsage(sim, ctx, wf.id) : undefined
  const live = publishedVersion(wf)
  const draft = draftChanges(wf)
  const versions = [...(wf.versions ?? [])].reverse()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <style>{PANEL_KEYFRAMES}</style>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Version history of ${wf.name}`}
        className="flex h-full w-[460px] max-w-full flex-col bg-white shadow-2xl"
        style={{ animation: 'history-in 180ms ease-out' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 pt-4 pb-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <History size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">Version history</h2>
            <p className="truncate text-sm text-slate-500">{wf.name}</p>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className={cx('rounded-lg border px-3.5 py-3', draft?.count ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50')}>
            <div className="flex items-center gap-2">
              <span className={cx('h-2 w-2 shrink-0 rounded-full', draft?.count ? 'bg-amber-500' : 'bg-slate-300')} />
              <span className="flex-1 text-sm font-medium text-slate-800">{draft?.count ? `Draft · ${plural(draft.count, 'change')}` : 'Draft'}</span>
              {!!draft?.count && (
                <Button size="sm" variant="primary" icon={<Upload size={13} />} onClick={() => useUi.getState().openVersions({ kind: 'publish', workflowId: wf.id })}>
                  Publish…
                </Button>
              )}
            </div>
            <p className="mt-1 pl-4 text-xs text-slate-600">
              {draft?.count ? `What you see on the map. Not live yet: new items start on version ${live}.` : `The map matches version ${live}. Change it and publish when you’re ready.`}
            </p>
          </div>

          {!!usage?.missingItems && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-white px-3.5 py-2.5 text-xs text-amber-900">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                {plural(usage.missingItems, 'item')} {usage.missingItems === 1 ? 'is' : 'are'} at steps that aren’t on the map ({usage.missing.map((m) => `“${m.label}”`).join(', ')}).{' '}
                {usage.missingItems === 1 ? 'It runs' : 'They run'} an older version; move {usage.missingItems === 1 ? 'it' : 'them'} to the latest below.
              </span>
            </p>
          )}

          <ol className="space-y-2.5">
            {versions.map((v, i) => (
              <VersionCard
                key={v.version}
                app={app}
                wf={wf}
                v={v}
                prev={versions[i + 1]}
                live={v.version === live}
                latest={live}
                inFlight={usage?.counts[v.version] ?? 0}
                draftChanged={!!draft?.count}
              />
            ))}
          </ol>
        </div>
      </aside>
    </div>
  )
}

function VersionCard({
  app,
  wf,
  v,
  prev,
  live,
  latest,
  inFlight,
  draftChanged,
}: {
  app: App
  wf: Workflow
  v: WorkflowVersion
  prev?: WorkflowVersion
  live: boolean
  latest?: number
  inFlight: number
  draftChanged: boolean
}) {
  const sim = useSimState()
  const [showChanges, setShowChanges] = useState(false)
  const [moving, setMoving] = useState(false)
  const [stepMap, setStepMap] = useState<Record<Id, Id>>({})
  const changes = prev ? diffWorkflow(prev.snapshot, v.snapshot) : undefined
  const target = wf.versions?.find((x) => x.version === latest)
  const ctx = ctxFor(app.id)
  const missing = moving && sim && ctx && target ? missingSteps(sim, ctx, wf.id, target.snapshot.nodes, { version: v.version }) : []

  const move = () => {
    if (latest === undefined) return
    if (!moving && sim && ctx && target && missingSteps(sim, ctx, wf.id, target.snapshot.nodes, { version: v.version }).length) return setMoving(true)
    const objectIds = Object.values(sim?.objects ?? {})
      .filter((o) => o.status === 'active' && itemVersion(wf, o) === v.version)
      .map((o) => o.id)
    moveItems(wf.id, latest, { objectIds, stepMap })
    setMoving(false)
    setStepMap({})
  }

  const restore = () => {
    if (draftChanged && !window.confirm(`Replace the draft of ${wf.name} with version ${v.version}? Changes you haven’t published are lost.`)) return
    restoreAsDraft(app.id, wf.id, v.version)
  }

  return (
    <li className={cx('rounded-lg border px-3.5 py-3', live ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200')}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">Version {v.version}</span>
        {live && <Badge tone="green">Live</Badge>}
        <span className="ml-auto text-xs text-slate-500 tabular-nums">{inFlight ? `${plural(inFlight, 'item')} in flight` : 'No items in flight'}</span>
      </div>
      {v.note && <p className="mt-1 text-sm text-slate-700">{v.note}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
        Published {formatClock(v.publishedAt)}
        {changes && (
          <>
            {' · '}
            <button type="button" onClick={() => setShowChanges(!showChanges)} className="inline-flex items-center gap-0.5 font-medium text-slate-600 hover:text-slate-900" aria-expanded={showChanges}>
              {changes.count ? `${plural(changes.count, 'change')} from version ${prev!.version}` : `Same as version ${prev!.version}`}
              {changes.count > 0 && <ChevronDown size={12} className={cx('transition-transform', showChanges && 'rotate-180')} />}
            </button>
          </>
        )}
      </p>
      {showChanges && changes && changes.count > 0 && (
        <div className="mt-2 rounded-md bg-white px-2.5 py-2 ring-1 ring-slate-100">
          <ChangeList diff={changes} />
        </div>
      )}

      {moving && (
        <div className="mt-2.5">{missing.length > 0 && <StepMapping missing={missing} targets={target?.snapshot.nodes ?? []} toVersion={latest!} value={stepMap} onChange={setStepMap} />}</div>
      )}

      {(!live || draftChanged) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {!live && inFlight > 0 && (
            <Button size="sm" variant={moving ? 'primary' : 'secondary'} icon={<ArrowUpToLine size={13} />} onClick={move}>
              {moving ? `Move ${plural(inFlight, 'item')} to version ${latest}` : 'Move these items to the latest version'}
            </Button>
          )}
          {moving && (
            <Button size="sm" variant="ghost" onClick={() => setMoving(false)}>
              Cancel
            </Button>
          )}
          {!moving && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={restore} title="Copy this version onto the map as the draft">
              Restore as draft
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
