import { ArrowDown, ArrowUp, FlaskConical, Minus } from 'lucide-react'
import { useState } from 'react'
import { buildIndex, type Ctx, previewPublish, type PublishPreview, stepOf } from '@modus-bpm/core'
import type { App, Id, Workflow } from '@modus-bpm/core/model/types'
import { plural } from '@modus-bpm/core/model/util'
import { Button, cx } from '../../components/ui'
import { ctxFor, useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { KPIS, verdict } from '../scenarios/lab'

const HOURS = [4, 8, 24] as const
const SHOWN = new Set(['completed', 'avgCycle', 'wip', 'overdue'])

interface Run {
  key: string
  preview: PublishPreview
  text: string
  tone: 'good' | 'bad' | 'mixed' | 'neutral'
}

const TONE: Record<Run['tone'], string> = {
  good: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
  bad: 'border-rose-200 bg-rose-50/70 text-rose-950',
  mixed: 'border-amber-200 bg-amber-50/70 text-amber-950',
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
}

/**
 * Try the draft before publishing: run the live simulation forward twice — as
 * it is, and with this version published the way the dialog says — and compare.
 */
export function DraftPreview({ app, wf, who, stepMap, version }: { app: App; wf: Workflow; who: 'new' | 'all'; stepMap: Record<Id, Id>; version: number }) {
  const [hours, setHours] = useState<(typeof HOURS)[number]>(8)
  const [run, setRun] = useState<Run>()
  const [running, setRunning] = useState(false)
  // A result answers one question; changing the choice, the mapping, the map or the length makes it stale.
  const key = JSON.stringify([who, stepMap, hours, wf.nodes, wf.edges])
  const stale = !!run && run.key !== key

  const go = () => {
    setRunning(true)
    // The run is synchronous; yield first so "Running…" paints.
    setTimeout(() => {
      try {
        if (!useSim.getState().sims[app.id]) useSim.getState().refresh()
        const sim = useSim.getState().sims[app.id]
        const ctx = ctxFor(app.id)
        const preview = sim && ctx ? previewPublish(sim, ctx, wf.id, { who, stepMap, hours }) : undefined
        if (!preview || !ctx) return
        // Name steps as the draft does (a renamed step reads by its new name); steps it removed keep their old one.
        const drawn = (id?: Id) => !id || wf.nodes.some((n) => n.id === id)
        const named = drawn(preview.baseline.bottleneckId) && drawn(preview.scenario.bottleneckId) ? asDrawn(ctx, wf.id) : ctx
        const v = verdict(preview, [], named, `Version ${version}`)
        setRun({ key, preview, ...v })
      } catch (e) {
        useUi.getState().toast(`The preview failed: ${e instanceof Error ? e.message : String(e)}`, 'warn')
      } finally {
        setRunning(false)
      }
    }, 40)
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Try it first</h3>
          <p className="text-xs text-slate-500">Run the live state forward with version {version} and without it, same random numbers on both sides.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="How long to simulate">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={hours === h}
                onClick={() => setHours(h)}
                className={cx('rounded px-2 py-0.5 text-xs font-medium tabular-nums', hours === h ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                {h} h
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" icon={<FlaskConical size={13} />} disabled={running} onClick={go}>
            {running ? 'Running…' : run ? 'Run again' : 'Simulate'}
          </Button>
        </div>
      </div>

      {run && (
        <div className={cx('mt-2.5 space-y-2', stale && 'opacity-50')}>
          <p className={cx('rounded-md border px-2.5 py-1.5 text-xs font-medium', TONE[run.tone])}>
            {stale && <span className="font-semibold">Out of date: run it again. </span>}
            {run.text}
          </p>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10.5px] tracking-wide text-slate-500 uppercase">
                <th className="py-1 font-medium">After {run.preview.hours} h</th>
                <th className="py-1 text-right font-medium">As now</th>
                <th className="py-1 text-right font-medium">With v{run.preview.version}</th>
              </tr>
            </thead>
            <tbody>
              {KPIS.filter((k) => SHOWN.has(k.key)).map((k) => {
                const b = run.preview.baseline[k.key] as number
                const s = run.preview.scenario[k.key] as number
                const d = s - b
                const same = Math.abs(d) < (k.key === 'avgCycle' ? 1 : 0.5)
                const good = !same && (k.better === 'up' ? d > 0 : d < 0)
                const Arrow = same ? Minus : d > 0 ? ArrowUp : ArrowDown
                return (
                  <tr key={k.key} className="border-t border-slate-200/70">
                    <td className="py-1 text-slate-600" title={k.hint}>
                      {k.label}
                    </td>
                    <td className="py-1 text-right text-slate-500">{k.format(b)}</td>
                    <td className="py-1 text-right font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-1">
                        <Arrow size={11} strokeWidth={2.5} className={same ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-rose-600'} />
                        {k.format(s)}
                      </span>
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t border-slate-200/70">
                <td className="py-1 text-slate-600">Bottleneck</td>
                <td className="py-1 text-right text-slate-500">{stepName(app, wf, run.preview.baseline.bottleneckId)}</td>
                <td className="py-1 text-right font-semibold text-slate-900">{stepName(app, wf, run.preview.scenario.bottleneckId)}</td>
              </tr>
            </tbody>
          </table>
          {run.preview.migration && run.preview.migration.skipped.length > 0 && (
            <p className="text-xs text-amber-800">
              {plural(run.preview.migration.skipped.length, 'item')} would stay on {run.preview.migration.skipped.length === 1 ? 'its' : 'their'} version: {run.preview.migration.skipped[0]!.reason}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** The context with one workflow read as drawn (its working copy) rather than as published. */
function asDrawn(ctx: Ctx, workflowId: Id): Ctx {
  return { ...ctx, app: { ...ctx.app, workflows: ctx.app.workflows.map((w) => (w.id === workflowId ? { ...w, versions: undefined, published: undefined } : w)) } }
}

function stepName(app: App, wf: Workflow, id?: Id): string {
  if (!id) return 'None'
  const drawn = wf.nodes.find((n) => n.id === id)
  if (drawn) return drawn.data.label
  const ctx = ctxFor(app.id)
  return (ctx && stepOf(buildIndex(ctx), id)?.node.data.label) || 'A removed step'
}
