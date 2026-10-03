// The What-if lab's plain logic: naming changes, suggesting experiments from the
// live bottleneck, judging a run in one sentence, and turning a run back into
// design edits. No React here.

import { applyChanges, buildIndex, type Ctx, type Index, type ScenarioChange, type ScenarioKpis, type ScenarioResult, serviceOf, type SimView } from '@modus-bpm/core'
import type { App, Design, Distribution, Id, ServiceDef, WfNode } from '@modus-bpm/core/model/types'
import { formatDuration } from '@modus-bpm/core/model/util'
import { DISTRIBUTION } from '../../components/icons'
import { useDesign } from '../../store/design'

export type ChangeKind = ScenarioChange['kind']

/** Step kinds that hold work (decisions, splits, starts and ends are instantaneous). */
export const HOLDING = new Set<WfNode['type']>(['user', 'auto', 'subflow', 'join', 'wait'])

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
const pct = (factor: number) => Math.round(Math.abs(factor - 1) * 100)
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function nodeLabel(idx: Index, id?: Id): string {
  return (id && idx.node.get(id)?.node.data.label) || 'a removed step'
}

function names(idx: Index, c: ScenarioChange) {
  switch (c.kind) {
    case 'staff':
      return idx.group.get(c.groupId)?.name ?? 'a removed group'
    case 'handling':
    case 'distribution':
      return nodeLabel(idx, c.nodeId)
    case 'arrivals':
    case 'expedite-rate':
      return idx.wf.get(c.workflowId)?.name ?? 'a removed workflow'
    default:
      return idx.service.get(c.serviceId)?.name ?? 'a removed service'
  }
}

/** Short label for a change, e.g. "Add 2 people to Finance Leadership". */
export function describeChange(idx: Index, c: ScenarioChange): string {
  const name = names(idx, c)
  switch (c.kind) {
    case 'staff':
      return c.delta >= 0 ? `Add ${people(c.delta)} to ${name}` : `Take ${people(-c.delta)} out of ${name}`
    case 'handling':
      return c.factor <= 1 ? `Cut handling time at ${name} by ${pct(c.factor)}%` : `Handling time at ${name} +${pct(c.factor)}%`
    case 'arrivals':
      return `Arrivals in ${name} ${c.factor >= 1 ? '+' : '−'}${pct(c.factor)}%`
    case 'distribution':
      return `Switch ${name} to ${lower(DISTRIBUTION[c.distribution].label)}`
    case 'capacity': {
      const now = idx.service.get(c.serviceId)?.concurrency
      return `${name} capacity ${now ? `${now} → ` : ''}${c.concurrency}`
    }
    case 'service-status':
      return c.status === 'online' ? `Bring ${name} online` : c.status === 'offline' ? `Take ${name} offline` : `Degrade ${name}`
    case 'expedite-rate':
      return `Expedite ${Math.round(c.rate * 100)}% of new items in ${name}`
  }
}

/** The change as the subject of a sentence: "Adding 2 people to Finance Leadership". */
function gerund(idx: Index, c: ScenarioChange): string {
  const name = names(idx, c)
  switch (c.kind) {
    case 'staff':
      return c.delta >= 0 ? `adding ${people(c.delta)} to ${name}` : `taking ${people(-c.delta)} out of ${name}`
    case 'handling':
      return c.factor <= 1 ? `cutting handling time at ${name} by ${pct(c.factor)}%` : `slowing ${name} down by ${pct(c.factor)}%`
    case 'arrivals':
      return `${c.factor >= 1 ? 'raising' : 'lowering'} arrivals in ${name} by ${pct(c.factor)}%`
    case 'distribution':
      return `switching ${name} to ${lower(DISTRIBUTION[c.distribution].label)}`
    case 'capacity': {
      const now = idx.service.get(c.serviceId)?.concurrency
      return `${now && c.concurrency < now ? 'lowering' : 'raising'} ${name} capacity to ${c.concurrency}`
    }
    case 'service-status':
      return c.status === 'online' ? `bringing ${name} back online` : c.status === 'offline' ? `taking ${name} offline` : `degrading ${name}`
    case 'expedite-rate':
      return `expediting ${Math.round(c.rate * 100)}% of new items in ${name}`
  }
}

function subject(idx: Index, changes: ScenarioChange[]): string {
  if (changes.length === 0) return 'Changing nothing'
  if (changes.length === 1) return upper(gerund(idx, changes[0]!))
  if (changes.length === 2) return upper(`${gerund(idx, changes[0]!)} and ${gerund(idx, changes[1]!)}`)
  return `These ${changes.length} changes`
}

// ---------- Suggested experiments ----------

export interface Suggestion {
  id: string
  tag: 'Fix' | 'Stress test' | 'Resilience'
  title: string
  detail: string
  changes: ScenarioChange[]
}

/** Services the app's automated steps call. */
export function servicesUsedBy(app: App, services: ServiceDef[]): ServiceDef[] {
  const ids = new Set<Id>()
  for (const wf of app.workflows) for (const n of wf.nodes) if (n.type === 'auto' && n.data.serviceId) ids.add(n.data.serviceId)
  return services.filter((s) => ids.has(s.id))
}

/** Experiments worth trying right now, starting from the live bottleneck. */
export function suggestions(view: SimView | undefined, ctx: Ctx): Suggestion[] {
  const idx = buildIndex(ctx)
  const out: Suggestion[] = []
  const found = view?.bottleneckId ? idx.node.get(view.bottleneckId) : undefined
  const m = view && found ? view.nodes[found.node.id] : undefined

  if (found && m && found.node.type === 'user') {
    const node = found.node
    const d = node.data
    const g = d.groupId ? idx.group.get(d.groupId) : undefined
    // Work sent to one named person never reaches new people unless the step is shared.
    const named = d.distribution === 'direct' || d.distribution === 'field'
    if (g) {
      out.push({
        id: 'staff',
        tag: 'Fix',
        title: `Add 2 people to ${g.name}`,
        detail: named ? `“${d.label}” goes to one named person, so the new people share it (load balanced).` : `${people(m.availableMembers)} available for “${d.label}” today.`,
        changes: named
          ? [
              { kind: 'staff', groupId: g.id, delta: 2 },
              { kind: 'distribution', nodeId: node.id, distribution: 'load-balance' },
            ]
          : [{ kind: 'staff', groupId: g.id, delta: 2 }],
      })
    }
    out.push({
      id: 'handling',
      tag: 'Fix',
      title: `Cut handling time at ${d.label} by 25%`,
      detail: `From ${formatDuration(d.avgMinutes)} to ${formatDuration(d.avgMinutes * 0.75)} per item: better tools, a template, a simpler form.`,
      changes: [{ kind: 'handling', nodeId: node.id, factor: 0.75 }],
    })
    if (d.distribution !== 'load-balance' && g) {
      out.push({
        id: 'distribution',
        tag: 'Fix',
        title: `Switch ${d.label} to load balanced`,
        detail: `Share it evenly across ${g.name} (${people(g.memberIds.length)}) instead of ${lower(DISTRIBUTION[d.distribution].label)}.`,
        changes: [{ kind: 'distribution', nodeId: node.id, distribution: 'load-balance' }],
      })
    }
  } else if (found && m && found.node.type === 'auto') {
    const node = found.node
    const { svc } = serviceOf(idx, node.data)
    if (svc?.concurrency) {
      out.push({
        id: 'capacity',
        tag: 'Fix',
        title: `Raise ${svc.name} capacity from ${svc.concurrency} to ${svc.concurrency * 2}`,
        detail: `${m.queued} items are waiting for a free slot at “${node.data.label}”.`,
        changes: [{ kind: 'capacity', serviceId: svc.id, concurrency: svc.concurrency * 2 }],
      })
    }
    if (svc && svc.status !== 'online') {
      out.push({
        id: 'online',
        tag: 'Fix',
        title: `Bring ${svc.name} back online`,
        detail: `It is ${svc.status} now.`,
        changes: [{ kind: 'service-status', serviceId: svc.id, status: 'online' }],
      })
    }
    out.push({
      id: 'handling',
      tag: 'Fix',
      title: `Make ${node.data.label} 25% faster`,
      detail: svc ? `Shorter calls to ${svc.name}: a faster model, a smaller payload.` : 'Shorter processing time.',
      changes: [{ kind: 'handling', nodeId: node.id, factor: 0.75 }],
    })
  }

  const busiest = ctx.app.workflows.filter((w) => (w.kind ?? 'process') === 'process' && w.arrivalsPerHour > 0).sort((a, b) => b.arrivalsPerHour - a.arrivalsPerHour)[0]
  if (busiest) {
    out.push({
      id: 'stress',
      tag: 'Stress test',
      title: `Arrivals +50% in ${busiest.name}`,
      detail: `From ${round1(busiest.arrivalsPerHour)} to ${round1(busiest.arrivalsPerHour * 1.5)} an hour. Where does it break first?`,
      changes: [{ kind: 'arrivals', workflowId: busiest.id, factor: 1.5 }],
    })
  }

  const used = servicesUsedBy(ctx.app, ctx.services ?? [])
  const calls = (s: ServiceDef) => view?.services[s.id]?.calls ?? 0
  const mostUsed = [...used].sort((a, b) => calls(b) - calls(a))[0]
  if (mostUsed && mostUsed.status !== 'offline') {
    out.push({
      id: 'offline',
      tag: 'Resilience',
      title: `Take ${mostUsed.name} offline for the run`,
      detail: calls(mostUsed) ? `${calls(mostUsed).toLocaleString()} calls so far. What piles up, and where, if it goes down?` : 'What piles up, and where, if it goes down?',
      changes: [{ kind: 'service-status', serviceId: mostUsed.id, status: 'offline' }],
    })
  }
  return out
}

export const round1 = (n: number) => Math.round(n * 10) / 10

// ---------- Judging a run ----------

export type Tone = 'good' | 'bad' | 'mixed' | 'neutral'

export interface Verdict {
  tone: Tone
  text: string
}

/** What the app's work items are called ("invoices"), for sentences. */
export function nounFor(app: App): { one: string; many: string } {
  const wf = app.workflows.filter((w) => (w.kind ?? 'process') === 'process').sort((a, b) => b.arrivalsPerHour - a.arrivalsPerHour)[0]
  const t = app.objectTypes.find((x) => x.id === wf?.objectTypeId) ?? app.objectTypes[0]
  return t ? { one: t.name.toLowerCase(), many: t.pluralName.toLowerCase() } : { one: 'item', many: 'items' }
}

function hoursText(minutes: number): string {
  const h = Math.abs(minutes) / 60
  return h >= 1 ? `${h.toFixed(1)}h` : formatDuration(Math.abs(minutes))
}

/** One plain sentence on what the change did, plus whether that is good news. */
export function verdict(result: ScenarioResult, changes: ScenarioChange[], ctx: Ctx): Verdict {
  const idx = buildIndex(ctx)
  const { baseline: b, scenario: s, hours } = result
  const noun = nounFor(ctx.app)
  const facts: string[] = []
  let pos = 0
  let neg = 0
  // Completions and cycle time matter most; end-of-run counts are supporting evidence.
  const count = (better: boolean, weight = 1) => (better ? (pos += weight) : (neg += weight))

  const dDone = s.completed - b.completed
  if (Math.abs(dDone) >= Math.max(2, b.completed * 0.03)) {
    facts.push(`${Math.abs(dDone).toLocaleString()} ${dDone > 0 ? 'more' : 'fewer'} ${Math.abs(dDone) === 1 ? noun.one : noun.many} completed`)
    count(dDone > 0, 2)
  }
  const dCycle = s.avgCycle - b.avgCycle
  const dWip = s.wip - b.wip
  if (b.avgCycle > 0 && s.avgCycle > 0 && Math.abs(dCycle) >= Math.max(5, b.avgCycle * 0.05)) {
    // Clearing a backlog finishes its oldest items during the run, which lifts the average: not a slowdown.
    const drained = dCycle > 0 && dDone > 0 && dWip < 0
    facts.push(`average cycle time ${dCycle < 0 ? 'down' : 'up'} ${hoursText(dCycle)}${drained ? ' (the backlog’s older items finished)' : ''}`)
    if (!drained) count(dCycle < 0, 2)
  }
  if (Math.abs(dWip) >= Math.max(2, b.wip * 0.1)) {
    facts.push(`${Math.abs(dWip).toLocaleString()} ${dWip < 0 ? 'fewer' : 'more'} in flight at the end`)
    count(dWip < 0)
  }
  for (const [key, label] of [
    ['slaBreaches', 'SLA breaches'],
    ['overdue', 'overdue'],
    ['stuck', 'stuck'],
  ] as const) {
    const d = s[key] - b[key]
    if (Math.abs(d) >= 2 || (b[key] === 0 && d > 0)) {
      facts.push(`${Math.abs(d).toLocaleString()} ${d < 0 ? 'fewer' : 'more'} ${label}`)
      count(d < 0)
    }
  }

  // What happened at the step that was the bottleneck.
  const bn = b.bottleneckId
  const before = bn ? (b.view.nodes[bn]?.total ?? 0) : 0
  const after = bn ? (s.view.nodes[bn]?.total ?? 0) : 0
  const worse = !!bn && after >= before * 1.3 && after - before >= 3
  if (worse) count(false, 2)
  else if (bn && (after <= before * 0.7 || s.bottleneckId !== bn)) count(true)

  const tone: Tone = !pos && !neg ? 'neutral' : pos >= neg * 3 ? 'good' : neg >= pos * 3 ? 'bad' : 'mixed'
  const helped = pos > neg
  // "These 3 changes clear…", but "Adding 2 people clears…".
  const verb = (one: string) => (changes.length > 2 ? one.replace(/s$/, '') : one)
  let effect = ''
  if (bn && s.bottleneckId !== bn && after < before && helped) {
    effect = `${verb('clears')} the ${nodeLabel(idx, bn)} backlog${s.bottleneckId ? ` (the bottleneck moves to ${nodeLabel(idx, s.bottleneckId)})` : ''}`
  } else if (bn && after <= before * 0.7 && helped) {
    effect = `${verb('shrinks')} the ${nodeLabel(idx, bn)} backlog from ${before} to ${after}`
  } else if (worse) {
    effect = `${verb('makes')} the ${nodeLabel(idx, bn)} backlog worse (${before} → ${after})`
  } else if (s.bottleneckId && s.bottleneckId !== bn) {
    effect = `${bn ? `${verb('moves')} the bottleneck to` : `${verb('creates')} a bottleneck at`} ${nodeLabel(idx, s.bottleneckId)}`
  }

  const who = subject(idx, changes)
  if (!facts.length && !effect) return { tone: 'neutral', text: `${who} ${verb('makes')} no meaningful difference over ${hours} simulated hours.` }
  if (!effect) return { tone, text: `${who}: ${facts.join(', ')}.` }
  return { tone, text: `${who} ${effect}${facts.length ? `: ${facts.join(', ')}` : ''}.` }
}

/** KPI cards: how to read each number and which direction is better. */
export const KPIS: Array<{ key: keyof ScenarioKpis; label: string; better: 'up' | 'down'; format: (n: number) => string; hint: string }> = [
  { key: 'completed', label: 'Completed', better: 'up', format: (n) => n.toLocaleString(), hint: 'Items finished as completed during the run' },
  { key: 'throughputPerHour', label: 'Throughput', better: 'up', format: (n) => `${n.toFixed(1)}/h`, hint: 'Items finished (completed or rejected) per simulated hour' },
  { key: 'avgCycle', label: 'Avg cycle time', better: 'down', format: formatDuration, hint: 'Created to finished, for items finished during the run' },
  { key: 'wip', label: 'In flight at end', better: 'down', format: (n) => n.toLocaleString(), hint: 'Items still open when the run ends' },
  { key: 'overdue', label: 'Overdue', better: 'down', format: (n) => n.toLocaleString(), hint: 'Open items past their target time at the end' },
  { key: 'slaBreaches', label: 'SLA breaches', better: 'down', format: (n) => n.toLocaleString(), hint: 'Open items past their step’s SLA at the end' },
  { key: 'stuck', label: 'Stuck', better: 'down', format: (n) => n.toLocaleString(), hint: 'Items with no path forward at the end' },
]

// ---------- Applying a run to the live design ----------

export interface ApplyPlan {
  /** Design edits, in plain words ("Vision AI capacity 2 → 4"). */
  edits: string[]
  /** Changes people have to make (staffing). */
  manual: Array<{ groupId: Id; text: string }>
  apply: () => void
}

/**
 * Turn a run's changes into edits on the current design. The edits are read off
 * the same `applyChanges` the simulation used, so what gets applied is exactly
 * what was tested (computed from today's values).
 */
export function applyPlan(design: Design, appId: Id, changes: ScenarioChange[]): ApplyPlan {
  const app = design.apps.find((a) => a.id === appId)
  const manual = changes
    .filter((c): c is Extract<ScenarioChange, { kind: 'staff' }> => c.kind === 'staff' && c.delta !== 0)
    .map((c) => {
      const g = design.groups.find((x) => x.id === c.groupId)?.name ?? 'the group'
      return { groupId: c.groupId, text: c.delta > 0 ? `Hire or assign ${people(c.delta)} to ${g}` : `Take ${people(-c.delta)} out of ${g}’s rotation` }
    })
  if (!app) return { edits: [], manual, apply: () => {} }

  const before: Ctx = { app, users: design.users, groups: design.groups, services: design.services }
  const after = applyChanges(
    before,
    changes.filter((c) => c.kind !== 'staff'),
  )
  const edits: string[] = []
  const svcEdits: Array<{ id: Id; concurrency?: number; status?: ServiceDef['status']; ops: Record<Id, number> }> = []
  const nodeEdits: Array<{ wfId: Id; nodeId: Id; avgMinutes?: number; distribution?: Distribution }> = []
  const wfEdits: Array<{ wfId: Id; arrivalsPerHour: number }> = []

  for (const svc of after.services ?? []) {
    const old = design.services.find((x) => x.id === svc.id)
    if (!old) continue
    const e: (typeof svcEdits)[number] = { id: svc.id, ops: {} }
    if (svc.concurrency !== old.concurrency) {
      e.concurrency = svc.concurrency
      edits.push(`${svc.name}: capacity ${old.concurrency ?? 'unlimited'} → ${svc.concurrency}`)
    }
    if (svc.status !== old.status) {
      e.status = svc.status
      edits.push(`${svc.name}: status ${old.status} → ${svc.status}`)
    }
    for (const op of svc.operations) {
      const was = old.operations.find((o) => o.id === op.id)
      const next = Math.round(op.avgMinutes * 100) / 100
      if (was && next !== was.avgMinutes) {
        e.ops[op.id] = next
        edits.push(`${svc.name} · ${op.name}: average call ${formatMinutes(was.avgMinutes)} → ${formatMinutes(next)} (every step that calls it)`)
      }
    }
    if (e.concurrency !== undefined || e.status || Object.keys(e.ops).length) svcEdits.push(e)
  }

  for (const wf of after.app.workflows) {
    const old = app.workflows.find((w) => w.id === wf.id)
    if (!old) continue
    const arrivals = round1(wf.arrivalsPerHour)
    if (arrivals !== old.arrivalsPerHour) {
      wfEdits.push({ wfId: wf.id, arrivalsPerHour: arrivals })
      edits.push(`${wf.name}: arrivals ${old.arrivalsPerHour}/h → ${arrivals}/h`)
    }
    for (const n of wf.nodes) {
      const was = old.nodes.find((x) => x.id === n.id)
      if (!was) continue
      const e: (typeof nodeEdits)[number] = { wfId: wf.id, nodeId: n.id }
      // Service-bound steps take their time from the service operation (edited above).
      const timed = (n.type === 'user' && was.type === 'user') || (n.type === 'auto' && was.type === 'auto' && !n.data.serviceId)
      if (timed) {
        const next = round1(n.data.avgMinutes)
        if (next !== was.data.avgMinutes) {
          e.avgMinutes = next
          edits.push(`${n.data.label}: average handling ${formatMinutes(was.data.avgMinutes)} → ${formatMinutes(next)}`)
        }
      }
      if (n.type === 'user' && was.type === 'user' && n.data.distribution !== was.data.distribution) {
        e.distribution = n.data.distribution
        edits.push(`${n.data.label}: ${lower(DISTRIBUTION[was.data.distribution].label)} → ${lower(DISTRIBUTION[n.data.distribution].label)}`)
      }
      if (e.avgMinutes !== undefined || e.distribution) nodeEdits.push(e)
    }
  }

  const apply = () => {
    if (!edits.length) return
    // One design update, so the live simulation picks up every edit at once.
    useDesign.getState().update((d) => {
      for (const e of svcEdits) {
        const svc = d.services.find((x) => x.id === e.id)
        if (!svc) continue
        if (e.concurrency !== undefined) svc.concurrency = e.concurrency
        if (e.status) svc.status = e.status
        for (const op of svc.operations) if (e.ops[op.id] !== undefined) op.avgMinutes = e.ops[op.id]!
      }
      const a = d.apps.find((x) => x.id === appId)
      for (const e of wfEdits) {
        const wf = a?.workflows.find((w) => w.id === e.wfId)
        if (wf) wf.arrivalsPerHour = e.arrivalsPerHour
      }
      for (const e of nodeEdits) {
        const n = a?.workflows.find((w) => w.id === e.wfId)?.nodes.find((x) => x.id === e.nodeId)
        if (!n) continue
        if (e.avgMinutes !== undefined && (n.type === 'user' || n.type === 'auto')) n.data.avgMinutes = e.avgMinutes
        if (e.distribution && n.type === 'user') n.data.distribution = e.distribution
      }
    })
  }
  return { edits, manual, apply }
}

function formatMinutes(m: number): string {
  return m < 1 ? `${Math.round(m * 60)}s` : m < 60 ? `${round1(m)}m` : formatDuration(m)
}
