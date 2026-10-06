import { Panel } from '@xyflow/react'
import { History, TriangleAlert, Upload } from 'lucide-react'
import { useMemo } from 'react'
import { draftChanges, publishedVersion, versionUsage } from '@modus-bpm/core'
import type { App, Workflow } from '@modus-bpm/core/model/types'
import { plural } from '@modus-bpm/core/model/util'
import { Button, cx } from '../../components/ui'
import { useApp } from '../../store/design'
import { ctxFor, useSimState } from '../../store/sim'
import { useUi } from '../../store/ui'
import { HistoryPanel } from './HistoryPanel'
import { PublishDialog } from './PublishDialog'

const open = (kind: 'publish' | 'history', workflowId: string) => useUi.getState().openVersions({ kind, workflowId })
const close = () => useUi.getState().openVersions(null)

/** Workflow header: which version is live (or that the map is a draft), Publish… and History. */
export function VersionControls({ wf }: { wf: Workflow }) {
  const changes = useMemo(() => draftChanges(wf)?.count ?? 0, [wf])
  const live = publishedVersion(wf)
  if (live === undefined) return null
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => open('history', wf.id)}
        title={changes ? `The map has ${plural(changes, 'change')} not yet published; new items start on version ${live}` : `New items start on version ${live}`}
        className={cx(
          'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
          changes ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100/70' : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100/70',
        )}
      >
        <span className={cx('h-1.5 w-1.5 rounded-full', changes ? 'bg-amber-500' : 'bg-emerald-500')} />
        {changes ? (
          <>
            Draft · {changes}
            <span className="hidden xl:inline"> {changes === 1 ? 'change' : 'changes'}</span>
          </>
        ) : (
          <>
            <span className="xl:hidden">v{live}</span>
            <span className="hidden xl:inline">Version {live}</span> · Live
          </>
        )}
      </button>
      <Button size="sm" variant="ghost" icon={<History size={13} />} aria-label="History" title="Every version, and which items run on it" onClick={() => open('history', wf.id)}>
        <span className="hidden xl:inline">History</span>
      </Button>
      <Button
        size="sm"
        variant={changes ? 'primary' : 'secondary'}
        icon={<Upload size={13} />}
        title={changes ? 'Publish the draft as a new version' : 'Nothing to publish yet'}
        onClick={() => open('publish', wf.id)}
      >
        Publish…
      </Button>
    </div>
  )
}

/** On the map: a quiet note while the map is an unpublished draft, and items at steps it no longer has. */
export function VersionBanners({ app, wf }: { app: App; wf: Workflow }) {
  const draft = useMemo(() => (draftChanges(wf)?.count ?? 0) > 0, [wf])
  const sim = useSimState()
  const ctx = ctxFor(app.id)
  const off = sim && ctx ? versionUsage(sim, ctx, wf.id).missingItems : 0
  if (!draft && !off) return null
  return (
    <Panel position="top-right">
      <div className="flex max-w-[340px] flex-col items-end gap-1.5 xl:max-w-none xl:whitespace-nowrap">
        {draft && (
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 py-1 pr-1.5 pl-3 text-xs text-slate-600 shadow-sm backdrop-blur">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>Draft: changes aren’t live until you publish</span>
            <button type="button" onClick={() => open('publish', wf.id)} className="rounded-full px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-50">
              Publish…
            </button>
          </div>
        )}
        {off > 0 && (
          <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/95 py-1 pr-1.5 pl-3 text-xs text-amber-900 shadow-sm backdrop-blur">
            <TriangleAlert size={12} className="shrink-0 text-amber-600" />
            <span>
              {plural(off, 'item')} {off === 1 ? 'is' : 'are'} at steps that aren’t on this map
            </span>
            <button type="button" onClick={() => open('history', wf.id)} className="rounded-full px-2 py-0.5 font-semibold text-amber-900 hover:bg-amber-100">
              History
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}

/** The publish dialog or version history, wherever it was opened from (the map, a what-if toast, an item). */
export function VersionDialogs() {
  const panel = useUi((s) => s.versions)
  const appId = useUi((s) => s.appId)
  const app = useApp(appId)
  const wf = panel ? app?.workflows.find((w) => w.id === panel.workflowId) : undefined
  if (!panel || !app || !wf) return null
  return panel.kind === 'publish' ? <PublishDialog key={wf.id} app={app} wf={wf} onClose={close} /> : <HistoryPanel key={wf.id} app={app} wf={wf} onClose={close} />
}
