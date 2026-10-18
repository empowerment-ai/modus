import { describe, expect, it } from 'vitest'
import { seedDesign } from '../model/seed'
import { publishWorkflow } from '../model/versions'
import type { Id } from '../model/types'
import { activeTokens, advance, burst, completeJob, type Ctx, failJob, newSim, pollJobs, type SimState, type Token, workStepOf, buildIndex } from './engine'
import { generateData } from './generate'
import {
  adminAssign,
  adminCancel,
  adminMove,
  adminRedistribute,
  adminRelease,
  adminRetry,
  adminReturnToPool,
  adminSetPriority,
  adminUpdateData,
  setExpedite,
  superviseAssign,
  superviseRedistribute,
  superviseRelease,
  superviseRetry,
  superviseReturn,
  workClaim,
  workDelegate,
  workDistribute,
  workDistributeEvenly,
  workNext,
  workRelease,
  workReturn,
  workSave,
  workSetPriority,
  workStart,
} from './ops'
import { changesBetween } from './project'
import { changedItems, copyState, withChanges, withoutItems } from './state'

// copyState shares what the engine never changes in place. These runs freeze every state before the
// next command works on its copy, so a write into anything shared throws (modules are strict), and
// compare the result with the same run on deep clones.

function freeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) freeze(x)
  }
  return v
}


/** The same commands twice: on copies of frozen states, and on deep clones. */
function twice(start: SimState, steps: number, command: (sim: SimState, step: number) => void) {
  let copied = start
  let cloned = structuredClone(start)
  // Each item as serialized after the last step: the slow, sure way to tell what a command changed.
  let serialized = new Map(Object.entries(start.objects).map(([id, o]) => [id, JSON.stringify(o)]))
  for (let i = 0; i < steps; i++) {
    freeze(copied)
    const before = copied
    copied = copyState(copied)
    command(copied, i)
    // The copy leaves its original as it was, so the diff still sees what the command did.
    const clonedBefore = cloned
    cloned = structuredClone(cloned)
    command(cloned, i)
    expect(changesBetween(before, copied)).toEqual(changesBetween(clonedBefore, cloned))
    // changedItems names exactly the items that serialize differently (an extra one would only cost a
    // write; a missing one, a change), and they rebuild the state, item order included.
    const now = new Map(Object.entries(copied.objects).map(([id, o]) => [id, JSON.stringify(o)]))
    const ids = changedItems(before, copied)
    expect(ids).toEqual([...now].filter(([id, text]) => serialized.get(id) !== text).map(([id]) => id))
    serialized = now
    const rebuilt = withChanges(before, { state: withoutItems(copied), objects: ids.map((id) => copied.objects[id]!) })
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(copied))
  }
  return { copied, cloned }
}

/** A seeded generator for the test's own choices, so both runs choose alike. */
function chooser(seed: number) {
  const s = { rng: seed }
  const next = () => {
    s.rng = (Math.imul(s.rng, 1103515245) + 12345) & 0x7fffffff
    return s.rng / 0x7fffffff
  }
  const pick = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(next() * xs.length)] : undefined)
  return { s, next, pick }
}

const design = seedDesign()

describe('copyState', () => {
  it.each(design.apps.map((a) => a.id))('lets a simulated run of %s go exactly as on deep clones, without touching what it copied', (appId) => {
    const app = design.apps.find((a) => a.id === appId)!
    const ctx: Ctx = { app, users: design.users, groups: design.groups, services: design.services }
    // About 300 items each: the busiest application gets the shortest run.
    const perHour = app.workflows.reduce((n, w) => n + (w.arrivalsPerHour || 0), 0)
    const { copied, cloned } = twice(newSim(appId, 11), Math.ceil((300 / perHour) * 6), (sim) => advance(sim, ctx, 10))
    expect(Object.keys(copied.objects).length).toBeGreaterThan(150)
    expect(JSON.stringify(copied)).toBe(JSON.stringify(cloned))
  }, 60_000)

  it.each([
    [1, false],
    [2, false],
    [3, true],
  ])('takes every live command without touching what it copied (seed %i, published versions: %s)', (seed, versioned) => {
    const invoice = design.apps.find((a) => a.id === 'app_invoice')!
    // Published, items pin the versions they run, and pin a subflow's when they first enter it.
    const app = versioned ? { ...invoice, workflows: invoice.workflows.map((w) => publishWorkflow(w, { at: 0 })) } : invoice
    const ctx: Ctx = { app, users: design.users, groups: design.groups, services: design.services, live: true }
    const idx = buildIndex(ctx)
    const users = design.users.map((u) => u.id)
    const admin = 'u_avery'
    const userSteps = app.workflows.flatMap((w) => w.nodes.filter((n) => n.type === 'user').map((n) => n.id))
    const anySteps = app.workflows.flatMap((w) => w.nodes.map((n) => n.id))
    const sim = newSim(app.id, seed)
    sim.arrivals = false
    const c = chooser(seed)
    const token = (s: SimState, ok: (t: Token) => boolean = () => true) => c.pick(activeTokens(s).filter(ok))
    const item = (s: SimState) => c.pick(s.activeIds)
    const outcome = (t: Token) => c.pick(workStepOf(idx, t)?.outcomes ?? [])?.id ?? 'none'
    const patch = (s: SimState, id: Id) => {
      const o = s.objects[id]!
      return generateData(c.s, idx.type.get(o.typeId)!, app.lists, design.users, s.clock, o.number)
    }
    const held = (t: Token) => !!t.userId
    const commands: Array<(s: SimState) => unknown> = [
      (s) => burst(s, ctx, 'w_invoice', 1 + Math.floor(c.next() * 3)),
      (s) => burst(s, ctx, 'w_invoice', 1),
      (s) => advance(s, ctx, c.next() * 90),
      (s) => (design.services ?? []).forEach((svc) => pollJobs(s, ctx, svc.id, 'worker', 3, 5 + c.next() * 30)),
      (s) => {
        const t = token(s, (t) => !!t.workerId)
        if (t) (c.next() < 0.85 ? completeJob(s, ctx, t.id, {}) : failJob(s, ctx, t.id, 'boom'))
      },
      (s) => workNext(s, ctx, c.pick(users)!),
      (s) => token(s) && workClaim(s, ctx, token(s)!.id, c.pick(users)!),
      (s) => {
        const t = token(s, held)
        if (t) workStart(s, ctx, t.id, t.userId!)
      },
      (s) => {
        const t = token(s, held)
        if (t) workSave(s, ctx, t.id, t.userId!, patch(s, t.objectId))
      },
      (s) => {
        const t = token(s, held)
        if (t) workRelease(s, ctx, t.id, t.userId!, outcome(t), c.next() < 0.5 ? 'done' : '', c.next() < 0.3 ? patch(s, t.objectId) : {})
      },
      (s) => {
        const t = token(s, held)
        if (t) workRelease(s, ctx, t.id, t.userId!, outcome(t), 'again')
      },
      (s) => {
        const t = token(s, held)
        if (t) workReturn(s, ctx, t.id, t.userId!, 'not mine')
      },
      (s) => {
        const t = token(s, held)
        if (t) workDelegate(s, ctx, t.id, t.userId!, c.pick(users)!, c.next() < 0.5 ? 'over to you' : '')
      },
      (s) => token(s) && workDistribute(s, ctx, token(s)!.id, c.pick(users)!, c.pick(users)!),
      (s) => workDistributeEvenly(s, ctx, c.pick(userSteps)!, c.pick(users)!),
      (s) => item(s) && workSetPriority(s, ctx, item(s)!, c.pick(users)!, c.pick(['low', 'normal', 'high', 'urgent'] as const)!),
      (s) => token(s) && adminAssign(s, ctx, token(s)!.id, c.pick(users)!),
      (s) => token(s) && adminReturnToPool(s, ctx, token(s)!.id),
      (s) => adminRedistribute(s, ctx, c.pick(userSteps)!),
      (s) => token(s) && adminMove(s, ctx, token(s)!.id, c.pick(anySteps)!),
      (s) => {
        // A parallel branch moved to an end step finishes while the others carry on.
        const t = token(s, (t) => t.forks.length > 0)
        const ends = app.workflows.find((w) => w.id === t?.workflowId)?.nodes.filter((n) => n.type === 'end' && n.data.result === 'completed')
        if (t && ends?.length) adminMove(s, ctx, t.id, c.pick(ends)!.id)
      },
      (s) => {
        const t = token(s)
        if (t) adminRelease(s, ctx, t.id, outcome(t), 'by an administrator')
      },
      (s) => token(s) && adminRetry(s, ctx, token(s)!.id),
      (s) => {
        const id = item(s)
        if (id) adminUpdateData(s, ctx, id, patch(s, id))
      },
      (s) => item(s) && adminSetPriority(s, ctx, item(s)!, c.pick(['low', 'urgent'] as const)!),
      (s) => (c.next() < 0.2 && item(s) ? adminCancel(s, ctx, item(s)!, 'withdrawn') : undefined),
      (s) => token(s) && superviseAssign(s, ctx, token(s)!.id, c.pick(users)!, admin),
      (s) => token(s) && superviseReturn(s, ctx, token(s)!.id, admin),
      (s) => {
        const t = token(s)
        if (t) superviseRelease(s, ctx, t.id, outcome(t), 'on their behalf', admin)
      },
      (s) => token(s) && superviseRetry(s, ctx, token(s)!.id, admin),
      (s) => superviseRedistribute(s, ctx, c.pick(userSteps)!, admin),
      (s) => item(s) && setExpedite(s, ctx, item(s)!, admin, c.next() < 0.7, 'deadline'),
    ]
    const { copied, cloned } = twice(sim, 1500, (s, step) => {
      // Both runs make the same choices: rewind the chooser to this step's seed.
      c.s.rng = (Math.imul(seed, 7919) + Math.imul(step, 104729)) & 0x7fffffff
      c.pick(commands)!(s)
    })
    expect(Object.keys(copied.objects).length).toBeGreaterThan(100)
    expect(Object.values(copied.objects).some((o) => o.status === 'completed')).toBe(true)
    // A branch ended early (its scope's end is kept until the scope finishes).
    expect(Object.values(copied.objects).some((o) => o.history.some((e) => e.kind === 'joined' && e.text.startsWith('Branch finished')))).toBe(true)
    if (versioned) expect(Object.values(copied.objects).some((o) => Object.keys(o.versions ?? {}).length > 1)).toBe(true)
    expect(JSON.stringify(copied)).toBe(JSON.stringify(cloned))
  }, 60_000)
})

describe('changedItems', () => {
  const app = design.apps.find((a) => a.id === 'app_invoice')!
  const ctx: Ctx = { app, users: design.users, groups: design.groups, services: design.services, live: true }
  /** Two items, the first with scope ends, version pins and a fork frame to change, frozen like a committed state. */
  function committed() {
    const sim = newSim(app.id, 5)
    sim.arrivals = false
    burst(sim, ctx, 'w_invoice', 2)
    const first = Object.values(sim.objects)[0]!
    first.scopeEnds = { root: { result: 'completed', label: 'Done' } }
    first.versions = { w_invoice: 1 }
    first.tokens[0]!.forks = [{ forkId: 'f0', splitId: 'n_split' }]
    return freeze(sim)
  }
  type Obj = SimState['objects'][string]
  // Each changes one level only, so each of changedItems' comparisons has to catch it on its own.
  it.each<[string, (o: Obj) => void]>([
    ['a field', (o) => void (o.status = 'completed')],
    ['a field added', (o) => void (o.completedAt = 5)],
    ['a field removed', (o) => void delete (o as Partial<Obj>).dueBy],
    ['a data value', (o) => void (o.data.f_invno = 'CHANGED')],
    ['a data key removed', (o) => void delete o.data.f_invno],
    ['a passed step', (o) => void o.passed.push('n_clerk')],
    ['an audit entry', (o) => void o.history.push({ at: 1, kind: 'notify', text: 'hi' })],
    ['an audit entry replaced', (o) => void (o.history[0] = { ...o.history[0]!, text: 'other' })],
    ['a scope end', (o) => void (o.scopeEnds!.call_1 = { result: 'rejected', label: 'No' })],
    ['a version pin', (o) => void (o.versions!.w_exception = 2)],
    ['a token added', (o) => void o.tokens.push({ ...o.tokens[0]!, id: `${o.id}~99` })],
    ['a token removed', (o) => void o.tokens.pop()],
    ['a token field', (o) => void (o.tokens[0]!.state = 'stuck')],
    ['a token field added', (o) => void (o.tokens[0]!.workerId = 'w1')],
    ['a fork frame', (o) => void o.tokens[0]!.forks.push({ forkId: 'f1', splitId: 'n_split' })],
    ['a fork frame left', (o) => void o.tokens[0]!.forks.pop()],
    ['a call frame', (o) => void o.tokens[0]!.calls.push({ callId: 'c1', nodeId: 'n_exc', workflowId: 'w_invoice', forkDepth: 0, at: 0 })],
  ])('counts %s', (_, change) => {
    const before = committed()
    const after = copyState(before)
    const [first, second] = Object.keys(after.objects)
    change(after.objects[first!]!)
    expect(changedItems(before, after)).toEqual([first])
    expect(changedItems(before, copyState(before))).toEqual([])
    expect(second).toBeDefined()
  })

  it('names new items, in the order they were created', () => {
    const before = committed()
    const after = copyState(before)
    burst(after, ctx, 'w_invoice', 3)
    expect(changedItems(before, after)).toEqual(Object.keys(after.objects).slice(2))
  })

  it('refuses a command that removed an item', () => {
    const before = committed()
    const after = copyState(before)
    delete after.objects[Object.keys(after.objects)[0]!]
    expect(() => changedItems(before, after)).toThrow(/removed an item/)
  })
})
