import { Gauge, type LucideIcon, Plus, Power, Shuffle, Timer, TrendingUp, Users, X, Zap } from 'lucide-react'
import type { ScenarioChange } from '@modus-bpm/core'
import type { App, Design, Distribution, Id, ServiceDef, WfNode } from '@modus-bpm/core/model/types'
import { DISTRIBUTION } from '../../components/icons'
import { Button, IconButton, Input, Select } from '../../components/ui'
import { servicesUsedBy } from './lab'
import type { Draft } from './runs'

type Kind = ScenarioChange['kind']

export const KINDS: Array<{ kind: Kind; label: string; icon: LucideIcon }> = [
  { kind: 'staff', label: 'People', icon: Users },
  { kind: 'handling', label: 'Handling time', icon: Timer },
  { kind: 'distribution', label: 'Distribution', icon: Shuffle },
  { kind: 'arrivals', label: 'Arrivals', icon: TrendingUp },
  { kind: 'capacity', label: 'Service capacity', icon: Gauge },
  { kind: 'service-status', label: 'Service status', icon: Power },
  { kind: 'expedite-rate', label: 'Expedite share', icon: Zap },
]

type UserNode = Extract<WfNode, { type: 'user' }>

const userSteps = (app: App) => app.workflows.flatMap((wf) => wf.nodes.filter((n): n is UserNode => n.type === 'user'))
const processes = (app: App) => app.workflows.filter((w) => (w.kind ?? 'process') === 'process')
const teams = (design: Design) => design.groups.filter((g) => g.kind !== 'distribution')

/** Distribution methods a step can switch to without more setup (direct and field need a person). */
function methodsFor(node: UserNode | undefined): Distribution[] {
  const all: Distribution[] = ['load-balance', 'queue', 'manager']
  if (node?.data.userId) all.push('direct')
  if (node?.data.assigneeFieldId) all.push('field')
  return all
}

/** A sensible first version of a new change, aimed at the bottleneck when it fits. */
export function defaultChange(kind: Kind, app: App, design: Design, bottleneckId?: Id): ScenarioChange | undefined {
  const nodes = app.workflows.flatMap((wf) => wf.nodes)
  const bn = nodes.find((n) => n.id === bottleneckId)
  const used = servicesUsedBy(app, design.services)
  const bnService = bn?.type === 'auto' ? design.services.find((s) => s.id === bn.data.serviceId) : undefined
  switch (kind) {
    case 'staff': {
      const steps = userSteps(app)
      const groupId = (bn?.type === 'user' && bn.data.groupId) || steps.find((n) => n.data.groupId)?.data.groupId || teams(design)[0]?.id
      return groupId ? { kind, groupId, delta: 1 } : undefined
    }
    case 'handling': {
      const node = bn?.type === 'user' || bn?.type === 'auto' ? bn : nodes.find((n) => n.type === 'user' || n.type === 'auto')
      return node ? { kind, nodeId: node.id, factor: 0.8 } : undefined
    }
    case 'distribution': {
      const node = bn?.type === 'user' ? bn : userSteps(app)[0]
      if (!node) return undefined
      return { kind, nodeId: node.id, distribution: node.data.distribution === 'load-balance' ? 'queue' : 'load-balance' }
    }
    case 'arrivals': {
      const wf = [...processes(app)].sort((a, b) => b.arrivalsPerHour - a.arrivalsPerHour)[0]
      return wf ? { kind, workflowId: wf.id, factor: 1.2 } : undefined
    }
    case 'capacity': {
      const svc = bnService ?? used.find((s) => s.concurrency) ?? used[0] ?? design.services[0]
      return svc ? { kind, serviceId: svc.id, concurrency: svc.concurrency ? svc.concurrency * 2 : 4 } : undefined
    }
    case 'service-status': {
      const svc = bnService ?? used[0] ?? design.services[0]
      return svc ? { kind, serviceId: svc.id, status: svc.status === 'offline' ? 'online' : 'offline' } : undefined
    }
    case 'expedite-rate': {
      const wf = [...processes(app)].sort((a, b) => b.arrivalsPerHour - a.arrivalsPerHour)[0]
      const now = wf?.expedite?.simulateRate
      return wf ? { kind, workflowId: wf.id, rate: now ? Math.min(0.5, now * 2) : 0.1 } : undefined
    }
  }
}

export function ChangeBuilder({
  app,
  design,
  drafts,
  onAdd,
  onEdit,
  onRemove,
}: {
  app: App
  design: Design
  drafts: Draft[]
  onAdd: (kind: Kind) => void
  onEdit: (key: number, change: ScenarioChange) => void
  onRemove: (key: number) => void
}) {
  return (
    <div className="space-y-2">
      {drafts.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
          No changes yet. Pick a suggested experiment, or add a change below. Running with no changes shows how the current design plays out.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {drafts.map((d) => (
            <ChangeRow key={d.key} app={app} design={design} change={d.change} onChange={(c) => onEdit(d.key, c)} onRemove={() => onRemove(d.key)} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="mr-1 text-[11px] font-medium text-slate-500">Add a change:</span>
        {KINDS.map((k) => (
          <Button key={k.kind} size="sm" variant="subtle" icon={<Plus size={12} />} onClick={() => onAdd(k.kind)}>
            {k.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ChangeRow({ app, design, change, onChange, onRemove }: { app: App; design: Design; change: ScenarioChange; onChange: (c: ScenarioChange) => void; onRemove: () => void }) {
  const meta = KINDS.find((k) => k.kind === change.kind)!
  const Icon = meta.icon
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-slate-600">
      <span className="flex w-[118px] shrink-0 items-center gap-1.5 font-medium text-slate-700">
        <Icon size={13} className="text-brand-600" />
        {meta.label}
      </span>
      <ChangeEditor app={app} design={design} change={change} onChange={onChange} />
      <div className="flex-1" />
      <IconButton label="Remove this change" onClick={onRemove}>
        <X size={14} />
      </IconButton>
    </li>
  )
}

function StepSelect({ app, value, onChange, filter }: { app: App; value: Id; onChange: (id: Id) => void; filter: (n: WfNode) => boolean }) {
  return (
    <Select className="w-56" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Step">
      {app.workflows.map((wf) => {
        const steps = wf.nodes.filter(filter)
        if (!steps.length) return null
        return (
          <optgroup key={wf.id} label={wf.name}>
            {steps.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.label}
              </option>
            ))}
          </optgroup>
        )
      })}
    </Select>
  )
}

function ServiceSelect({ app, design, value, onChange }: { app: App; design: Design; value: Id; onChange: (svc: ServiceDef) => void }) {
  const used = servicesUsedBy(app, design.services)
  const others = design.services.filter((s) => !used.includes(s))
  const pick = (id: Id) => {
    const svc = design.services.find((s) => s.id === id)
    if (svc) onChange(svc)
  }
  return (
    <Select className="w-56" value={value} onChange={(e) => pick(e.target.value)} aria-label="Service">
      <optgroup label={`Used by ${app.name}`}>
        {used.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </optgroup>
      {others.length > 0 && (
        <optgroup label="Other services">
          {others.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  )
}

/** Percent change of a factor: 0.75 ⇄ −25. */
function PercentInput({ factor, onChange, label }: { factor: number; onChange: (factor: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        className="w-20 text-right"
        step={5}
        min={-95}
        max={500}
        aria-label={label}
        value={Math.round((factor - 1) * 100)}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(0.05, 1 + Math.max(-95, Math.min(500, v)) / 100))
        }}
      />
      %
    </span>
  )
}

function ChangeEditor({ app, design, change: c, onChange }: { app: App; design: Design; change: ScenarioChange; onChange: (c: ScenarioChange) => void }) {
  switch (c.kind) {
    case 'staff': {
      const steps = userSteps(app)
      const working = teams(design).filter((g) => steps.some((n) => n.data.groupId === g.id))
      const others = teams(design).filter((g) => !working.includes(g))
      const g = design.groups.find((x) => x.id === c.groupId)
      return (
        <>
          <Input
            type="number"
            className="w-16 text-right"
            min={-20}
            max={20}
            aria-label="People to add (negative to take out)"
            value={c.delta}
            onChange={(e) => onChange({ ...c, delta: Math.max(-20, Math.min(20, Math.round(Number(e.target.value) || 0))) })}
          />
          <span>{Math.abs(c.delta) === 1 ? 'person' : 'people'} in</span>
          <Select className="w-56" value={c.groupId} onChange={(e) => onChange({ ...c, groupId: e.target.value })} aria-label="Group">
            <optgroup label={`Work steps in ${app.name}`}>
              {working.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </optgroup>
            {others.length > 0 && (
              <optgroup label="Other teams">
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          <span className="text-slate-400">{c.delta < 0 ? 'Negative takes people out of rotation.' : `${g?.memberIds.length ?? 0} today`}</span>
        </>
      )
    }
    case 'handling':
      return (
        <>
          <span>at</span>
          <StepSelect app={app} value={c.nodeId} onChange={(nodeId) => onChange({ ...c, nodeId })} filter={(n) => n.type === 'user' || n.type === 'auto'} />
          <PercentInput factor={c.factor} onChange={(factor) => onChange({ ...c, factor })} label="Change in handling time, percent" />
          <span className="text-slate-400">{c.factor < 1 ? 'faster' : c.factor > 1 ? 'slower' : 'no change'}</span>
        </>
      )
    case 'distribution': {
      const node = userSteps(app).find((n) => n.id === c.nodeId)
      return (
        <>
          <span>at</span>
          <StepSelect
            app={app}
            value={c.nodeId}
            onChange={(nodeId) => {
              const next = userSteps(app).find((n) => n.id === nodeId)
              onChange({ ...c, nodeId, distribution: methodsFor(next).includes(c.distribution) ? c.distribution : 'load-balance' })
            }}
            filter={(n) => n.type === 'user'}
          />
          <span>to</span>
          <Select className="w-44" value={c.distribution} onChange={(e) => onChange({ ...c, distribution: e.target.value as Distribution })} aria-label="Distribution method">
            {methodsFor(node).map((m) => (
              <option key={m} value={m}>
                {DISTRIBUTION[m].label}
              </option>
            ))}
          </Select>
          {node && <span className="text-slate-400">now {DISTRIBUTION[node.data.distribution].label.toLowerCase()}</span>}
        </>
      )
    }
    case 'arrivals': {
      const wf = app.workflows.find((w) => w.id === c.workflowId)
      return (
        <>
          <span>in</span>
          <Select className="w-56" value={c.workflowId} onChange={(e) => onChange({ ...c, workflowId: e.target.value })} aria-label="Workflow">
            {processes(app).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <PercentInput factor={c.factor} onChange={(factor) => onChange({ ...c, factor })} label="Change in arrivals, percent" />
          {wf && (
            <span className="text-slate-400">
              {wf.arrivalsPerHour}/h → {Math.round(wf.arrivalsPerHour * c.factor * 10) / 10}/h
            </span>
          )}
        </>
      )
    }
    case 'capacity': {
      const svc = design.services.find((s) => s.id === c.serviceId)
      return (
        <>
          <ServiceSelect app={app} design={design} value={c.serviceId} onChange={(s) => onChange({ ...c, serviceId: s.id, concurrency: s.concurrency ? s.concurrency * 2 : c.concurrency })} />
          <span>to</span>
          <Input
            type="number"
            className="w-16 text-right"
            min={1}
            max={500}
            aria-label="Calls in flight at once"
            value={c.concurrency}
            onChange={(e) => onChange({ ...c, concurrency: Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 1))) })}
          />
          <span>at once</span>
          <span className="text-slate-400">now {svc?.concurrency ?? 'unlimited'}</span>
        </>
      )
    }
    case 'service-status': {
      const svc = design.services.find((s) => s.id === c.serviceId)
      return (
        <>
          <ServiceSelect app={app} design={design} value={c.serviceId} onChange={(s) => onChange({ ...c, serviceId: s.id })} />
          <span>is</span>
          <Select className="w-32" value={c.status} onChange={(e) => onChange({ ...c, status: e.target.value as ServiceDef['status'] })} aria-label="Service status">
            <option value="online">Online</option>
            <option value="degraded">Degraded</option>
            <option value="offline">Offline</option>
          </Select>
          <span className="text-slate-400">now {svc?.status ?? 'unknown'}</span>
        </>
      )
    }
    case 'expedite-rate': {
      const wf = app.workflows.find((w) => w.id === c.workflowId)
      return (
        <>
          <Input
            type="number"
            className="w-16 text-right"
            min={0}
            max={100}
            step={5}
            aria-label="Share of new items expedited, percent"
            value={Math.round(c.rate * 100)}
            onChange={(e) => onChange({ ...c, rate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })}
          />
          <span>% of new items in</span>
          <Select className="w-56" value={c.workflowId} onChange={(e) => onChange({ ...c, workflowId: e.target.value })} aria-label="Workflow">
            {processes(app).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <span>arrive expedited</span>
          <span className="text-slate-400">
            now {Math.round((wf?.expedite?.simulateRate ?? 0) * 100)}%{wf && !wf.expedite ? ' · not set up, uses 2× faster due dates' : ''}
          </span>
        </>
      )
    }
  }
}
