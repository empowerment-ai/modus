// What-if scenarios: copy the live simulation, change the design (more people,
// faster handling, a different distribution method, more service capacity…),
// run both copies forward with the same random numbers, and compare. Because
// the engine is deterministic, any difference comes from the change.

import type { App, Distribution, Group, Id, ServiceDef, User } from '../model/types'
import { advance, type Ctx, type SimState } from './engine'
import { computeView, type SimView } from './view'

export type ScenarioChange =
  | { kind: 'staff'; groupId: Id; delta: number }
  | { kind: 'handling'; nodeId: Id; factor: number }
  | { kind: 'arrivals'; workflowId: Id; factor: number }
  | { kind: 'distribution'; nodeId: Id; distribution: Distribution }
  | { kind: 'capacity'; serviceId: Id; concurrency: number }
  | { kind: 'service-status'; serviceId: Id; status: ServiceDef['status'] }

export interface ScenarioKpis {
  completed: number
  rejected: number
  /** Finished during the run, per simulated hour. */
  throughputPerHour: number
  /** Average cycle time of items finished during the run, minutes. */
  avgCycle: number
  /** Items still in flight at the end. */
  wip: number
  stuck: number
  overdue: number
  slaBreaches: number
  bottleneckId?: Id
  view: SimView
  series: Array<{ t: number; wip: number }>
}

export interface ScenarioResult {
  hours: number
  baseline: ScenarioKpis
  scenario: ScenarioKpis
}

function clone<T>(v: T): T {
  return structuredClone(v)
}

/** Apply changes to a copy of the design context. */
export function applyChanges(ctx: Ctx, changes: ScenarioChange[]): Ctx {
  const app: App = clone(ctx.app)
  const users: User[] = clone(ctx.users)
  const groups: Group[] = clone(ctx.groups)
  const services: ServiceDef[] = clone(ctx.services ?? [])
  for (const c of changes) {
    switch (c.kind) {
      case 'staff': {
        const g = groups.find((x) => x.id === c.groupId)
        if (!g) break
        if (c.delta > 0) {
          for (let i = 0; i < c.delta; i++) {
            const id = `whatif_${g.id}_${i}`
            users.push({ id, name: `Extra ${g.name} #${i + 1}`, title: 'What-if hire', color: '#94a3b8', speed: 1, available: true })
            g.memberIds.push(id)
          }
        } else if (c.delta < 0) {
          // Take the last N members out of rotation (they finish what they hold).
          for (const id of g.memberIds.slice(c.delta)) {
            const u = users.find((x) => x.id === id)
            if (u) u.available = false
          }
        }
        break
      }
      case 'handling':
        for (const wf of app.workflows)
          for (const n of wf.nodes) {
            if (n.id !== c.nodeId) continue
            if (n.type === 'user' || n.type === 'auto') n.data.avgMinutes = Math.max(1, n.data.avgMinutes * c.factor)
            if (n.type === 'auto' && n.data.serviceId) {
              const svc = services.find((s) => s.id === (n.data as { serviceId?: Id }).serviceId)
              const op = svc?.operations.find((o) => o.id === (n.data as { operationId?: Id }).operationId) ?? svc?.operations[0]
              if (op) op.avgMinutes = Math.max(0.05, op.avgMinutes * c.factor)
            }
          }
        break
      case 'arrivals':
        for (const wf of app.workflows) if (wf.id === c.workflowId) wf.arrivalsPerHour = Math.max(0, wf.arrivalsPerHour * c.factor)
        break
      case 'distribution':
        for (const wf of app.workflows) for (const n of wf.nodes) if (n.id === c.nodeId && n.type === 'user') n.data.distribution = c.distribution
        break
      case 'capacity': {
        const svc = services.find((s) => s.id === c.serviceId)
        if (svc) svc.concurrency = Math.max(1, c.concurrency)
        break
      }
      case 'service-status': {
        const svc = services.find((s) => s.id === c.serviceId)
        if (svc) svc.status = c.status
        break
      }
    }
  }
  return { ...ctx, app, users, groups, services }
}

function kpis(start: SimState, end: SimState, ctx: Ctx, hours: number): ScenarioKpis {
  const view = computeView(end, ctx)
  const completed = end.completed - start.completed
  const rejected = end.rejected - start.rejected
  const finished = completed + rejected
  const cycle = end.cycleTotal - start.cycleTotal
  return {
    completed,
    rejected,
    throughputPerHour: hours > 0 ? finished / hours : 0,
    avgCycle: finished ? cycle / finished : 0,
    wip: end.activeIds.length,
    stuck: view.stuck,
    overdue: view.overdue,
    slaBreaches: Object.values(view.nodes).reduce((s, m) => s + m.slaBreaches, 0),
    bottleneckId: view.bottleneckId,
    view,
    series: end.series.filter((p) => p.t >= start.clock).map((p) => ({ t: p.t, wip: p.wip })),
  }
}

/**
 * Run the current simulation forward `hours` twice — as designed, and with the
 * changes — starting from exactly the same state and random seed.
 */
export function runScenario(sim: SimState, ctx: Ctx, changes: ScenarioChange[], hours: number): ScenarioResult {
  const start = clone(sim)
  start.flights = []
  const base = clone(start)
  const what = clone(start)
  const changed = applyChanges(ctx, changes)
  // Real people in the Workspace would never act inside a projection; let the simulation run them.
  const plain = { ...ctx, manualUserIds: [] }
  advance(base, plain, hours * 60)
  advance(what, { ...changed, manualUserIds: [] }, hours * 60)
  return { hours, baseline: kpis(start, base, plain, hours), scenario: kpis(start, what, changed, hours) }
}
