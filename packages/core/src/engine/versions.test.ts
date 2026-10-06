import { describe, expect, it } from 'vitest'
import { seedDesign } from '../model/seed'
import type { App, Design, Group, User, WfEdge, WfNode, Workflow } from '../model/types'
import { diffWorkflow, ensureVersions, hasDraftChanges, publishWorkflow, restoreDraft, runnable, snapshotOf } from '../model/versions'
import { advance, burst, createObject, type Ctx, newSim, type SimObject } from './engine'
import { adminMove, adminRelease, workNext } from './ops'
import { migrateItems, missingSteps, pinInFlight, versionUsage } from './versions'
import { computeView, queuesFor } from './view'

// ---------- Builders ----------

const at = { x: 0, y: 0 }

function userStep(id: string, extra: Partial<Extract<WfNode, { type: 'user' }>['data']> = {}): WfNode {
  return {
    id,
    type: 'user',
    position: at,
    data: { label: id, distribution: 'queue', groupId: 'g', autoDistribute: false, distributeEveryMinutes: 30, avgMinutes: 10_000, outcomes: [{ id: 'ok', label: 'Done', weight: 1, actions: [] }], fieldAccess: {}, ...extra },
  }
}

const start = (id = 's'): WfNode => ({ id, type: 'start', position: at, data: { label: 'Start' } })
const end = (id = 'e'): WfNode => ({ id, type: 'end', position: at, data: { label: id, result: 'completed' } })
const wait = (id: string, minutes: number): WfNode => ({ id, type: 'wait', position: at, data: { label: id, minutes } })
const edge = (source: string, target: string, data: WfEdge['data'] = {}): WfEdge => ({ id: `${source}-${target}-${data.outcomeId ?? ''}`, source, target, data })

function wf(nodes: WfNode[], edges: WfEdge[], extra: Partial<Workflow> = {}): Workflow {
  return { id: 'w', name: 'W', kind: 'process', objectTypeId: 't', arrivalsPerHour: 0, nodes, edges, ...extra }
}

/** Publish the working copy in place (the studio replaces the workflow; tests keep one object). */
function publish(w: Workflow, note?: string) {
  Object.assign(w, publishWorkflow(w, { note }))
}

function ctxOf(workflows: Workflow[]): Ctx {
  const users: User[] = ['u0', 'u1', 'u2', 'out'].map((id) => ({ id, name: id, title: 'Clerk', color: '#000', speed: 1, available: true }))
  const groups: Group[] = [
    { id: 'g', name: 'Team', memberIds: ['u0', 'u1', 'u2'] },
    { id: 'other', name: 'Other team', memberIds: ['out'] },
  ]
  const app: App = {
    id: 'a',
    name: 'Test',
    description: '',
    color: '#000',
    lists: [],
    objectTypes: [{ id: 't', name: 'Thing', pluralName: 'Things', icon: 'file', color: '#000', numberPrefix: 'T-', permissions: {}, fields: [{ id: 'amt', label: 'Amount', type: 'currency', width: 'half' }] }],
    workflows,
  }
  return { app, users, groups, services: [] }
}

function quiet() {
  const sim = newSim('a')
  sim.arrivals = false
  return sim
}

const where = (o: SimObject) => o.tokens.map((t) => t.nodeId)

// v1: Start → b → End. Each test drafts and publishes its own v2.
function simple(): Workflow {
  const w = wf([start(), userStep('b'), end()], [edge('s', 'b'), edge('b', 'e', { outcomeId: 'ok' })])
  publish(w)
  return w
}

/** Draft: Start → c → End, without b. */
function replaceBWithC(w: Workflow) {
  w.nodes = [start(), userStep('c'), end()]
  w.edges = [edge('s', 'c'), edge('c', 'e', { outcomeId: 'ok' })]
}

// ---------- Tests ----------

describe('workflow versions', () => {
  it('pins new items to the published version', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const o = createObject(quiet(), ctx, 'w', {}, 'u0')!
    expect(w.published).toBe(1)
    expect(o.versions).toEqual({ w: 1 })
  })

  it('editing the working copy changes nothing until it is published', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const sim = quiet()
    const old = createObject(sim, ctx, 'w', {}, 'u0')!
    replaceBWithC(w)
    expect(hasDraftChanges(w)).toBe(true)
    // A draft isn't live: new items still start on version 1.
    const fresh = createObject(sim, ctx, 'w', {}, 'u0')!
    advance(sim, ctx, 30)
    expect(where(old)).toEqual(['b'])
    expect(where(fresh)).toEqual(['b'])
    expect(adminRelease(sim, ctx, old.tokens[0]!.id, 'ok', '').ok).toBe(true)
    expect(old.status).toBe('completed')
  })

  it('publishing for new items only: items in flight finish on the version they started', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const sim = quiet()
    const old = createObject(sim, ctx, 'w', {}, 'u0')!
    replaceBWithC(w)
    publish(w, 'Route to c')
    const fresh = createObject(sim, ctx, 'w', {}, 'u0')!
    advance(sim, ctx, 5)
    expect(where(old)).toEqual(['b'])
    expect(where(fresh)).toEqual(['c'])
    expect(old.versions).toEqual({ w: 1 })
    expect(fresh.versions).toEqual({ w: 2 })
    // The map shows both: counts are by step, whichever version.
    const v = computeView(sim, ctx)
    expect(v.nodes.b!.total).toBe(1)
    expect(v.nodes.c!.total).toBe(1)
    expect(versionUsage(sim, ctx, 'w')).toMatchObject({ counts: { 1: 1, 2: 1 }, total: 2, missingItems: 1, missing: [{ nodeId: 'b', count: 1, versions: [1] }] })
    adminRelease(sim, ctx, old.tokens[0]!.id, 'ok', '')
    expect(old.status).toBe('completed')
    expect(old.passed).toEqual(['s', 'b'])
  })

  it('moving items: steps both versions have keep their work, and the new version routes from there', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const sim = quiet()
    const o = createObject(sim, ctx, 'w', {}, 'u0')!
    // v2 adds a review after b.
    w.nodes = [...w.nodes, userStep('review')]
    w.edges = [edge('s', 'b'), edge('b', 'review', { outcomeId: 'ok' }), edge('review', 'e', { outcomeId: 'ok' })]
    publish(w)
    const tokenBefore = o.tokens[0]!.id
    const r = migrateItems(sim, ctx, 'w', 2)
    expect(r).toEqual({ ok: true, value: { moved: 1, skipped: [] } })
    expect(o.versions).toEqual({ w: 2 })
    expect(where(o)).toEqual(['b'])
    expect(o.tokens[0]!.id).toBe(tokenBefore)
    expect(o.history.some((h) => h.kind === 'moved' && h.text.startsWith('Moved to version 2 by Administrator'))).toBe(true)
    adminRelease(sim, ctx, o.tokens[0]!.id, 'ok', '')
    expect(where(o)).toEqual(['review'])
    // Already there: nothing to move.
    expect(migrateItems(sim, ctx, 'w', 2)).toEqual({ ok: true, value: { moved: 0, skipped: [] } })
  })

  it('moving items off a removed step: mapped steps move, unmapped ones stay on their version with a reason', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const sim = quiet()
    const a = createObject(sim, ctx, 'w', {}, 'u0')!
    const b = createObject(sim, ctx, 'w', {}, 'u0')!
    replaceBWithC(w)
    expect(missingSteps(sim, ctx, 'w', w.nodes)).toMatchObject([{ nodeId: 'b', count: 2, objectIds: [a.id, b.id] }])
    publish(w)

    const skipped = migrateItems(sim, ctx, 'w', 2, { objectIds: [a.id] })
    expect(skipped.ok && skipped.value.moved).toBe(0)
    expect(skipped.ok && skipped.value.skipped).toEqual([{ objectId: a.id, number: a.number, reason: '“b” isn’t in version 2; choose a step for it.' }])
    expect(a.versions).toEqual({ w: 1 })
    expect(where(a)).toEqual(['b'])

    const moved = migrateItems(sim, ctx, 'w', 2, { stepMap: { b: 'c' } })
    expect(moved.ok && moved.value.moved).toBe(2)
    for (const o of [a, b]) {
      expect(o.versions).toEqual({ w: 2 })
      expect(where(o)).toEqual(['c'])
      expect(o.tokens[0]!.state).toBe('unassigned')
      expect(o.history.some((h) => h.text === 'Moved from b to c by Administrator')).toBe(true)
    }
    expect(versionUsage(sim, ctx, 'w')).toMatchObject({ counts: { 2: 2 }, missingItems: 0 })
  })

  it('items keep the subflow version they entered; later items enter the newly published one', () => {
    const child: Workflow = { id: 'child', name: 'Child', kind: 'subflow', objectTypeId: 't', arrivalsPerHour: 0, nodes: [start('cs'), userStep('k1'), end('ce')], edges: [edge('cs', 'k1'), edge('k1', 'ce', { outcomeId: 'ok' })] }
    const parent = wf([start(), wait('pause', 10), { id: 'sub', type: 'subflow', position: at, data: { label: 'Sub', workflowId: 'child' } }, end()], [edge('s', 'pause'), edge('pause', 'sub'), edge('sub', 'e')])
    publish(child)
    publish(parent)
    const ctx = ctxOf([parent, child])
    const sim = quiet()
    const first = createObject(sim, ctx, 'w', {}, 'u0')!
    advance(sim, ctx, 5)
    const second = createObject(sim, ctx, 'w', {}, 'u0')!
    expect(first.versions).toEqual({ w: 1 })
    advance(sim, ctx, 7)
    expect(where(first)).toEqual(['k1'])
    expect(first.versions).toEqual({ w: 1, child: 1 })

    child.nodes = [start('cs'), userStep('k2'), end('ce')]
    child.edges = [edge('cs', 'k2'), edge('k2', 'ce', { outcomeId: 'ok' })]
    publish(child)
    advance(sim, ctx, 10)
    expect(where(first)).toEqual(['k1'])
    expect(where(second)).toEqual(['k2'])
    expect(second.versions).toEqual({ w: 1, child: 2 })
    // Each finishes its own subflow version and comes back to the parent.
    adminRelease(sim, ctx, first.tokens[0]!.id, 'ok', '')
    adminRelease(sim, ctx, second.tokens[0]!.id, 'ok', '')
    expect(first.status).toBe('completed')
    expect(second.status).toBe('completed')
  })

  it('each version’s queue belongs to its own group', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const sim = quiet()
    const old = createObject(sim, ctx, 'w', {}, 'u0')!
    w.nodes = w.nodes.map((n) => (n.type === 'user' ? { ...n, data: { ...n.data, groupId: 'other' } } : n))
    publish(w)
    const fresh = createObject(sim, ctx, 'w', {}, 'u0')!
    const queued = (userId: string) => queuesFor(sim, ctx, userId).flatMap((q) => q.items.map((i) => i.obj.id))
    expect(queued('u0')).toEqual([old.id])
    expect(queued('out')).toEqual([fresh.id])
    const next = workNext(sim, ctx, 'out')
    expect(next.ok && next.value).toBe(fresh.tokens[0]!.id)
    expect(workNext(sim, ctx, 'out').ok).toBe(false)
    // The simulated team fetches the version-1 item only.
    advance(sim, ctx, 1)
    expect(['u0', 'u1', 'u2']).toContain(old.tokens[0]!.userId)
  })

  it('an administrator move stays within the item’s own version', () => {
    const w = simple()
    const ctx = ctxOf([w])
    const sim = quiet()
    const o = createObject(sim, ctx, 'w', {}, 'u0')!
    replaceBWithC(w)
    publish(w)
    expect(adminMove(sim, ctx, o.tokens[0]!.id, 'c').ok).toBe(false)
    expect(adminMove(sim, ctx, o.tokens[0]!.id, 'e').ok).toBe(true)
    expect(o.status).toBe('completed')
  })

  it('items created before versions existed are pinned before a publish, so they stay put', () => {
    const w = wf([start(), userStep('b'), end()], [edge('s', 'b'), edge('b', 'e', { outcomeId: 'ok' })])
    const ctx = ctxOf([w])
    const sim = quiet()
    const legacy = createObject(sim, ctx, 'w', {}, 'u0')!
    expect(legacy.versions).toBeUndefined()
    publish(w)
    expect(pinInFlight(sim, ctx)).toBe(1)
    replaceBWithC(w)
    publish(w)
    adminRelease(sim, ctx, legacy.tokens[0]!.id, 'ok', '')
    expect(legacy.status).toBe('completed')
    expect(legacy.versions).toEqual({ w: 1 })
  })

  it('a design at version 1 runs exactly like the same design without versions', () => {
    const run = (design: Design) => {
      const ctx = { app: design.apps[0]!, users: design.users, groups: design.groups, services: design.services }
      const sim = newSim('app_invoice', 7)
      advance(sim, ctx, 8 * 60)
      return { created: sim.created, completed: sim.completed, rejected: sim.rejected, stats: sim.nodeStats, feed: sim.feed.slice(0, 50) }
    }
    expect(run(ensureVersions(seedDesign()))).toEqual(run(seedDesign()))
  })

  it('runs a working day with items on two versions, then moves them all to the latest', () => {
    const design = ensureVersions(seedDesign())
    const app = design.apps[0]!
    const ctx: Ctx = { app, users: design.users, groups: design.groups, services: design.services }
    const sim = newSim('app_invoice', 11)
    advance(sim, ctx, 4 * 60)
    burst(sim, ctx, 'w_invoice', 30)
    const i = app.workflows.findIndex((w) => w.id === 'w_invoice')
    // Version 2 gives manager approval a tighter service level.
    const draft = structuredClone(app.workflows[i]!)
    for (const n of draft.nodes) if (n.id === 'n_manager' && n.type === 'user') n.data.slaHours = 2
    app.workflows[i] = publishWorkflow(draft, { at: sim.clock, note: 'Tighter manager SLA' })
    advance(sim, ctx, 60)
    const usage = versionUsage(sim, ctx, 'w_invoice')
    expect(usage.counts[1]).toBeGreaterThan(0)
    expect(usage.counts[2]).toBeGreaterThan(0)
    expect(computeView(sim, ctx).stuck).toBe(0)
    const r = migrateItems(sim, ctx, 'w_invoice', 2)
    expect(r.ok && r.value).toEqual({ moved: usage.counts[1], skipped: [] })
    advance(sim, ctx, 4 * 60)
    const v = computeView(sim, ctx)
    expect(v.stuck).toBe(0)
    expect(sim.created).toBe(v.active + sim.completed + sim.rejected)
    expect(versionUsage(sim, ctx, 'w_invoice').counts[1]).toBeUndefined()
  })
})

describe('drafts and publishing', () => {
  it('gives every workflow a published version 1 once, from its map', () => {
    const d = ensureVersions(seedDesign())
    for (const w of d.apps.flatMap((a) => a.workflows)) {
      expect(w.versions).toHaveLength(1)
      expect(w.published).toBe(1)
      expect(hasDraftChanges(w)).toBe(false)
      expect(runnable(w).nodes).toEqual(w.nodes)
    }
    expect(ensureVersions(d)).toBe(d)
  })

  it('describes what a draft changes, ignoring layout', () => {
    const w = simple()
    w.nodes = w.nodes.map((n) => ({ ...n, position: { x: 300, y: 40 } }))
    w.edges = w.edges.map((e) => ({ ...e, sourceHandle: 'r', targetHandle: 'l' }))
    expect(hasDraftChanges(w)).toBe(false)
    w.nodes = [
      ...w.nodes.map((n) => (n.id === 'b' && n.type === 'user' ? { ...n, data: { ...n.data, label: 'Approve', groupId: 'other' } } : n)),
      userStep('extra'),
    ]
    w.edges = [...w.edges.filter((e) => e.target !== 'e'), edge('b', 'extra', { outcomeId: 'ok' }), edge('extra', 'e', { outcomeId: 'ok' })]
    w.targetHours = 24
    const d = diffWorkflow(w.versions![0]!.snapshot, snapshotOf(w))
    expect(d.steps.added.map((s) => s.id)).toEqual(['extra'])
    expect(d.steps.removed).toEqual([])
    expect(d.steps.changed).toEqual([{ id: 'b', label: 'Approve', type: 'user', detail: 'renamed from “b”, group' }])
    expect(d.paths.added.map((p) => p.label)).toEqual(['Approve → extra', 'extra → e'])
    expect(d.paths.removed.map((p) => p.label)).toEqual(['b → e'])
    expect(d.settings).toEqual(['Target time none → 24 h'])
    expect(d.count).toBe(6)
  })

  it('restores a version as the draft', () => {
    const w = simple()
    replaceBWithC(w)
    publish(w)
    const back = restoreDraft(w, 1)
    expect(back.nodes.map((n) => n.id)).toEqual(['s', 'b', 'e'])
    expect(back.published).toBe(2)
    expect(hasDraftChanges(back)).toBe(true)
    expect(diffWorkflow(back, w.versions![0]!.snapshot).count).toBe(0)
  })
})
