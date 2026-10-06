// Publishing a workflow's draft and moving items between its versions: change
// the design, run the engine's migration, then say plainly what happened.

import { type Migration, migrateItems, pinInFlight, publishedVersion, publishWorkflow, restoreDraft } from '@modus-bpm/core'
import type { Id, Workflow } from '@modus-bpm/core/model/types'
import { plural } from '@modus-bpm/core/model/util'
import { useDesign } from '../../store/design'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

/** Who runs a newly published version. */
export type Audience = 'new' | 'all' | 'draft'

export function workflowOf(appId: Id, workflowId: Id): Workflow | undefined {
  return useDesign
    .getState()
    .design.apps.find((a) => a.id === appId)
    ?.workflows.find((w) => w.id === workflowId)
}

function replaceWorkflow(appId: Id, next: Workflow) {
  useDesign.getState().updateApp(appId, (a) => {
    const i = a.workflows.findIndex((w) => w.id === next.id)
    if (i >= 0) a.workflows[i] = next
  })
}

/** "12 items moved to version 3; 2 stayed on their version: “Manager review” isn’t in version 3…" */
function report(m: Migration, toVersion: number, lead = '') {
  const ui = useUi.getState()
  if (!m.moved && !m.skipped.length) return ui.toast(`${lead}Nothing to move: every item is already on version ${toVersion}.`, lead ? 'success' : 'info')
  const moved = `${plural(m.moved, 'item')} moved to version ${toVersion}`
  if (!m.skipped.length) return ui.toast(`${lead}${moved}.`, 'success')
  ui.toast(`${lead}${moved}; ${plural(m.skipped.length, 'item')} stayed on ${m.skipped.length === 1 ? 'its' : 'their'} version. ${m.skipped[0]!.reason}`, 'warn')
}

/**
 * Publish the draft as the next version. `new`: new items start on it, items in
 * flight finish where they are. `all`: move the items in flight onto it now too
 * (work at removed steps goes where `stepMap` says, or stays). `draft`: nothing yet.
 */
export function publishDraft(appId: Id, workflowId: Id, opts: { who: Audience; note?: string; stepMap?: Record<Id, Id> }) {
  const wf = workflowOf(appId, workflowId)
  const ui = useUi.getState()
  if (!wf) return
  const live = publishedVersion(wf)
  if (opts.who === 'draft') return ui.toast(`Kept as a draft. New items still start on version ${live ?? 1}.`)
  const sim = useSim.getState()
  // Items that started before this workflow had versions keep running what they run now.
  sim.act((s, c) => pinInFlight(s, c))
  const next = publishWorkflow(wf, { at: sim.sims[appId]?.clock ?? 0, note: opts.note })
  const version = next.published!
  replaceWorkflow(appId, next)
  const lead = `Version ${version} of ${wf.name} is live. `
  if (opts.who === 'new') return ui.toast(`${lead}New items start on it; items in flight finish on the version they started.`, 'success')
  const r = useSim.getState().act((s, c) => migrateItems(s, c, workflowId, version, { stepMap: opts.stepMap }))
  if (!r.ok) return ui.toast(r.error, 'warn')
  report(r.value, version, lead)
}

/** Move items (all on other versions, or just `objectIds`) to a version of the workflow. */
export function moveItems(workflowId: Id, toVersion: number, opts: { objectIds?: Id[]; stepMap?: Record<Id, Id> } = {}): Migration | undefined {
  const r = useSim.getState().act((s, c) => migrateItems(s, c, workflowId, toVersion, opts))
  if (!r.ok) {
    useUi.getState().toast(r.error, 'warn')
    return undefined
  }
  report(r.value, toVersion)
  return r.value
}

/** Start the draft over from a version. */
export function restoreAsDraft(appId: Id, workflowId: Id, version: number) {
  const wf = workflowOf(appId, workflowId)
  if (!wf) return
  replaceWorkflow(appId, restoreDraft(wf, version))
  useUi.getState().toast(`The draft of ${wf.name} now matches version ${version}. Publish it to make it live.`, 'success')
}
