import { Filter, GitMerge, Hourglass, Plus } from 'lucide-react'
import { cx, Field, Input, Toggle } from '../../../components/ui'
import type { App, NodeOf, SplitData, Workflow } from '@throughline/core/model/types'
import { formatDuration } from '@throughline/core/model/util'
import { useDesign } from '../../../store/design'
import { useSimView } from '../../../store/sim'
import { useUi } from '../../../store/ui'
import { BranchList } from './BranchList'
import { Body, ChoiceCard, deleteNode, NumberInput, PanelHeader, Section, useNodeUpdater } from './common'
import { Stat } from './WorkPanel'

function GatewayIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative flex h-8 w-8 items-center justify-center">
      <span className="absolute inset-[5px] rotate-45 rounded-[4px] border-2 border-indigo-400 bg-indigo-50" />
      <span className="relative text-indigo-600">{children}</span>
    </span>
  )
}

// ---------- Parallel split ----------

export function SplitInspector({ app, wf, node }: { app: App; wf: Workflow; node: NodeOf<'split'> }) {
  const update = useNodeUpdater<NodeOf<'split'>>(app.id, wf.id, node.id)
  const updateWorkflow = useDesign((s) => s.updateWorkflow)
  const m = useSimView()?.nodes[node.id]
  const inclusive = node.data.mode === 'inclusive'

  const setMode = (mode: SplitData['mode']) =>
    updateWorkflow(app.id, wf.id, (w) => {
      const n = w.nodes.find((x) => x.id === node.id)
      if (n?.type !== 'split') return
      n.data.mode = mode
      // Paths of an inclusive split run on rules: give each one an empty rule to fill in.
      if (mode === 'inclusive') for (const e of w.edges) if (e.source === node.id && !e.data.isDefault && !e.data.condition) e.data.condition = { match: 'all', rules: [] }
    })

  return (
    <>
      <PanelHeader
        icon={<GatewayIcon>{inclusive ? <Filter size={11} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}</GatewayIcon>}
        kind="Parallel split"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        <Section title="Split">
          <Field label="Name">
            <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
          </Field>
        </Section>
        <Section title="Which paths run" hint="The item is worked on along several paths at the same time. Bring the paths back together with a Join.">
          <div className="space-y-1.5">
            <ChoiceCard
              active={!inclusive}
              icon={<Plus size={14} strokeWidth={2.5} />}
              title="All paths at once"
              hint="parallel"
              text="Every path leaving this step runs, e.g. post the payment, notify the vendor and archive, all together."
              onClick={() => setMode('all')}
            />
            <ChoiceCard
              active={inclusive}
              icon={<Filter size={13} />}
              title="Every path that matches"
              hint="inclusive"
              text="Each path has a rule; every path whose rule matches runs. The “Otherwise” path runs only when none match."
              onClick={() => setMode('inclusive')}
            />
          </div>
        </Section>
        <Section title={inclusive ? 'Paths and their rules' : 'Paths'} hint={inclusive ? 'Click a path to edit its rule.' : undefined}>
          <BranchList app={app} wf={wf} nodeId={node.id} shares={inclusive} />
          {(m?.stuck ?? 0) > 0 && <p className="mt-2 text-xs font-medium text-rose-600">{m!.stuck} item(s) matched no path and are stuck here. Add an “Otherwise” path.</p>}
        </Section>
        {(m?.entered ?? 0) > 0 && (
          <Section title="Live">
            <p className="text-xs text-slate-600">
              <b className="font-semibold text-slate-800 tabular-nums">{m!.entered.toLocaleString()}</b> item{m!.entered === 1 ? '' : 's'} split so far.
            </p>
          </Section>
        )}
      </Body>
    </>
  )
}

// ---------- Join ----------

export function JoinInspector({ app, wf, node }: { app: App; wf: Workflow; node: NodeOf<'join'> }) {
  const update = useNodeUpdater<NodeOf<'join'>>(app.id, wf.id, node.id)
  const m = useSimView()?.nodes[node.id]
  const d = node.data
  const incoming = wf.edges.filter((e) => e.target === node.id)
  const partial = d.mode !== 'all'

  return (
    <>
      <PanelHeader icon={<GatewayIcon>{<GitMerge size={12} strokeWidth={2.5} />}</GatewayIcon>} kind="Join" title={d.label} onDelete={() => deleteNode(app.id, wf, node.id)} />
      <Body>
        <Section title="Join">
          <Field label="Name">
            <Input value={d.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
          </Field>
        </Section>
        <Section title="When to continue" hint="Branches that were split apart meet here; the item carries on as one.">
          <div className="space-y-1.5">
            <ChoiceCard
              active={d.mode === 'all'}
              title="Wait for all"
              hint="rendezvous"
              text="Continue once every branch that was started has arrived."
              onClick={() => update((n) => void (n.data.mode = 'all'))}
            />
            <ChoiceCard active={d.mode === 'any'} title="First one wins" text="Continue as soon as the first branch arrives." onClick={() => update((n) => void (n.data.mode = 'any'))} />
            <ChoiceCard
              active={d.mode === 'count'}
              title="After some of them"
              text="Continue once a set number of branches have arrived, e.g. two of three quotes."
              onClick={() =>
                update((n) => {
                  n.data.mode = 'count'
                  n.data.count ??= Math.max(1, Math.min(2, incoming.length))
                })
              }
            >
              <div className="flex items-center gap-2 text-xs text-slate-600">
                Continue after
                <NumberInput className="w-[88px]" value={d.count} min={1} max={Math.max(1, incoming.length)} onChange={(v) => update((n) => void (n.data.count = Math.max(1, v ?? 1)))} />
                of {incoming.length} branch{incoming.length === 1 ? '' : 'es'}
              </div>
            </ChoiceCard>
          </div>
        </Section>
        {partial && (
          <Section title="The other branches">
            <Toggle checked={!!d.cancelRemaining} onChange={(on) => update((n) => void (n.data.cancelRemaining = on))} label={<span className="text-sm">Withdraw the branches still running</span>} />
            <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs leading-relaxed text-slate-600">
              {d.cancelRemaining
                ? 'As soon as this join continues, branches still running are withdrawn: their work leaves people’s baskets and waiting service calls are dropped.'
                : 'The other branches finish their own work first. When they reach this join they are absorbed, so nothing after it runs twice.'}
            </p>
          </Section>
        )}
        <Section title={`Paths in (${incoming.length})`}>
          {incoming.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing leads here yet.</p>
          ) : (
            <ul className="space-y-1">
              {incoming.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().select({ kind: 'edge', id: e.id })}
                    className="w-full truncate rounded-md px-1.5 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    from {wf.nodes.find((n) => n.id === e.source)?.data.label ?? 'a removed step'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {m && m.entered > 0 && (
          <Section title="Live">
            <div className="grid grid-cols-2 gap-2 text-center">
              <Stat label="Waiting here" value={m.joining} />
              <Stat label="Arrived so far" value={m.entered} />
            </div>
            {m.joining > 0 && <p className="mt-2 text-[11.5px] text-slate-500">Branches wait here until the rest of their item arrives.</p>}
          </Section>
        )}
      </Body>
    </>
  )
}

// ---------- Timer ----------

const PRESETS: Array<[number, string]> = [
  [15, '15 min'],
  [60, '1 hour'],
  [240, '4 hours'],
  [1440, '1 day'],
  [10080, '1 week'],
]

export function WaitInspector({ app, wf, node }: { app: App; wf: Workflow; node: NodeOf<'wait'> }) {
  const update = useNodeUpdater<NodeOf<'wait'>>(app.id, wf.id, node.id)
  const m = useSimView()?.nodes[node.id]
  return (
    <>
      <PanelHeader
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-600">
            <Hourglass size={16} />
          </span>
        }
        kind="Timer"
        title={node.data.label}
        onDelete={() => deleteNode(app.id, wf, node.id)}
      />
      <Body>
        <Section title="Timer" hint="Items pause here, then continue on their own: a cooling-off period, a reminder delay, or time for something outside to happen.">
          <div className="space-y-3">
            <Field label="Name">
              <Input value={node.data.label} onChange={(e) => update((n) => void (n.data.label = e.target.value))} />
            </Field>
            <Field label="Wait for" hint={node.data.minutes >= 60 ? `That is ${formatDuration(node.data.minutes)}.` : undefined}>
              <NumberInput value={node.data.minutes} min={1} suffix="min" onChange={(v) => update((n) => void (n.data.minutes = Math.max(1, v ?? 1)))} />
            </Field>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map(([min, label]) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => update((n) => void (n.data.minutes = min))}
                  className={cx('rounded-md px-2 py-1 text-[11px] font-medium', node.data.minutes === min ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Section>
        {m && m.entered > 0 && (
          <Section title="Live">
            <div className="grid grid-cols-2 gap-2 text-center">
              <Stat label="On the timer" value={m.waiting} />
              <Stat label="Passed" value={m.exited} />
            </div>
          </Section>
        )}
      </Body>
    </>
  )
}
