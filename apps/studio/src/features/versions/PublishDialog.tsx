import { useMemo, useState } from 'react'
import { draftChanges, latestVersion, missingSteps, publishedVersion, versionUsage } from '@modus-bpm/core'
import type { App, Id, Workflow } from '@modus-bpm/core/model/types'
import { plural } from '@modus-bpm/core/model/util'
import { Badge, Button, cx, Field, Input, Modal } from '../../components/ui'
import { ctxFor, useSimState } from '../../store/sim'
import { type Audience, publishDraft } from './actions'
import { ChangeList } from './ChangeList'
import { StepMapping } from './StepMapping'

/** Publish a workflow's draft as its next version, and choose who runs it. */
export function PublishDialog({ app, wf, onClose }: { app: App; wf: Workflow; onClose: () => void }) {
  const sim = useSimState()
  const ctx = ctxFor(app.id)
  const live = publishedVersion(wf) ?? 0
  const next = latestVersion(wf) + 1
  const diff = useMemo(() => draftChanges(wf), [wf])
  const [note, setNote] = useState('')
  const [who, setWho] = useState<Audience>('new')
  const [stepMap, setStepMap] = useState<Record<Id, Id>>({})
  const inFlight = sim && ctx ? versionUsage(sim, ctx, wf.id).total : 0
  const missing = who === 'all' && sim && ctx ? missingSteps(sim, ctx, wf.id, wf.nodes) : []
  const changes = diff?.count ?? 0

  const choices: Array<{ value: Audience; title: string; hint: string; recommended?: boolean }> = [
    { value: 'new', title: 'New items only', hint: 'Items in flight finish on the version they started.', recommended: true },
    {
      value: 'all',
      title: 'New items and items in flight',
      hint: inFlight ? `Move the ${plural(inFlight, 'item')} in flight onto version ${next} now.` : `No items are in flight, so this is the same as new items only.`,
    },
    { value: 'draft', title: 'Nobody yet', hint: `Keep it as a draft; new items keep using version ${live}.` },
  ]

  const confirm = () => {
    publishDraft(app.id, wf.id, { who, note, stepMap })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Publish version ${next} of ${wf.name}`}
      subtitle={`Version ${live} is live now. Every version is kept, and you can see who runs which in History.`}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={who !== 'draft' && changes === 0} onClick={confirm}>
            {who === 'draft' ? 'Keep as draft' : `Publish version ${next}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            What changes{' '}
            {changes > 0 && (
              <span className="font-normal normal-case">
                · {plural(changes, 'change')} since version {live}
              </span>
            )}
          </h3>
          {diff && changes > 0 ? <ChangeList diff={diff} /> : <p className="text-sm text-slate-500">The draft matches version {live}. Change the map first, then publish it.</p>}
        </section>

        <Field label="Note" hint="Optional. Shown in History next to this version.">
          <Input value={note} placeholder="What changed and why, e.g. Controllers approve invoices over $25k" onChange={(e) => setNote(e.target.value)} />
        </Field>

        <section>
          <h3 id="publish-who" className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Who uses version {next}?
          </h3>
          <div className="space-y-1.5" role="radiogroup" aria-labelledby="publish-who">
            {choices.map((c) => {
              const active = who === c.value
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setWho(c.value)}
                  className={cx(
                    'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active ? 'border-brand-400 bg-brand-50/60 ring-2 ring-brand-500/15' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-brand-600' : 'border-slate-300')}>
                    {active && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                      {c.title}
                      {c.recommended && <Badge tone="green">Recommended</Badge>}
                    </span>
                    <span className="block text-xs text-slate-500">{c.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {who === 'all' && <StepMapping missing={missing} targets={wf.nodes} toVersion={next} value={stepMap} onChange={setStepMap} />}
      </div>
    </Modal>
  )
}
