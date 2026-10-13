import { describe, expect, it } from 'vitest'
import { advance, computeView, ensureVersions, newSim, workingNow, type Ctx } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import type { Design } from '@modus-bpm/core/model/types'
import type { MonitorSnapshot, ServerDesign } from '../../server/client'
import { adminsOf, designDifference, isLive, liveBadge, liveSource, simSource } from './source'

const design = (): Design => ensureVersions(seedDesign())
const serverDesign = (d: Design): ServerDesign => ({ ...d, services: d.services.map(({ endpoint: _e, secretRef: _s, auth: _a, owner: _o, ...rest }) => rest) })

describe('isLive', () => {
  it('needs a server and the Live choice', () => {
    expect(isLive({ available: true, mode: 'live' })).toBe(true)
    expect(isLive({ available: true, mode: 'simulation' })).toBe(false)
    // Standalone or Pages: Live is the default choice but there's nothing to show.
    expect(isLive({ available: false, mode: 'live' })).toBe(false)
  })
})

describe('simSource', () => {
  it('reads the simulation, with "working on" from core', () => {
    const d = design()
    const app = d.apps[0]!
    const ctx: Ctx = { app, users: d.users, groups: d.groups, services: d.services }
    const sim = newSim(app.id)
    advance(sim, ctx, 6 * 60)
    const view = computeView(sim, ctx)
    const src = simSource(app.id, d, view, sim)
    expect(src.live).toBe(false)
    expect(src.app).toBe(app)
    expect(src.hasWork).toBe(sim.created > 0)
    expect(src.series).toBe(sim.series)
    expect(src.feed).toBe(sim.feed)
    expect(src.working).toEqual(workingNow(sim))
    expect(Object.keys(src.working).length).toBeGreaterThan(0)
  })

  it('is empty before the simulation exists', () => {
    const d = design()
    const src = simSource(d.apps[0]!.id, d, undefined, undefined)
    expect(src).toMatchObject({ hasWork: false, series: [], feed: [], working: {}, expedited: undefined })
  })
})

describe('liveSource', () => {
  const d = design()
  const app = d.apps[0]!
  const monitor = (created: number, expedited: number): MonitorSnapshot => {
    const view = computeView(newSim(app.id), { app, users: d.users, groups: d.groups, services: d.services })
    return {
      clock: 30,
      view: { ...view, created, expedited },
      expeditedByStep: { step: expedited },
      working: { u1: { itemId: 'i1', number: 'INV-1', stepId: 'step', also: 0 } },
    }
  }

  it('draws the server design and its ready answers', () => {
    const src = liveSource(app.id, { design: serverDesign(d), monitor: monitor(3, 1), series: [{ t: 0, wip: 0, done: 0 }], feed: [] })
    expect(src.live).toBe(true)
    expect(src.app?.id).toBe(app.id)
    expect(src.users).toHaveLength(d.users.length)
    expect(src.hasWork).toBe(true)
    expect(src.working.u1?.number).toBe('INV-1')
    expect(src.expedited).toEqual({ step: 1 })
    // Redacted services still type as services for the panels.
    expect(src.services.every((s) => s.endpoint === '')).toBe(true)
  })

  it('shows expedited counts only while some are in flight', () => {
    expect(liveSource(app.id, { design: serverDesign(d), monitor: monitor(3, 0), series: [], feed: [] }).expedited).toBeUndefined()
  })

  it('is empty until loaded, and has no app the server lacks', () => {
    const src = liveSource(app.id, { design: undefined, monitor: undefined, series: [], feed: [] })
    expect(src).toMatchObject({ app: undefined, users: [], services: [], view: undefined, hasWork: false, working: {} })
    expect(liveSource('nope', { design: serverDesign(d), monitor: undefined, series: [], feed: [] }).app).toBeUndefined()
  })
})

describe('adminsOf', () => {
  it('lists administrators by name', () => {
    const admins = adminsOf(serverDesign(design()))
    expect(admins.length).toBeGreaterThan(0)
    expect(admins.every((u) => u.roles?.includes('admin'))).toBe(true)
    expect(admins.map((u) => u.name)).toEqual([...admins.map((u) => u.name)].sort((a, b) => a.localeCompare(b)))
    expect(adminsOf(undefined)).toEqual([])
  })
})

describe('designDifference', () => {
  it('says nothing when the designs agree', () => {
    expect(designDifference(design(), design())).toBeUndefined()
  })

  it('takes a server without versions to run version 1, as the browser does', () => {
    // A server's design file usually has no versions yet; the browser gives every workflow a version 1.
    expect(designDifference(seedDesign(), design())).toBeUndefined()
  })

  it('names a workflow published at another version, the open app first', () => {
    const server = design()
    const local = design()
    const [a, b] = server.apps
    const bump = (w: Design['apps'][number]['workflows'][number]) => {
      w.versions = [...w.versions!, { ...w.versions![0]!, version: 2 }]
      w.published = 2
    }
    bump(a!.workflows[0]!)
    bump(b!.workflows[0]!)
    const note = designDifference(server, local, b!.id)!
    expect(note).toContain(`${b!.workflows[0]!.name} runs version 2 on the server, 1 here`)
    expect(note).toContain('and 1 more difference)')
  })

  it('notices apps and workflows on one side only', () => {
    const server = design()
    const local = design()
    const gone = local.apps.pop()!
    expect(designDifference(server, local)).toContain(`${gone.name} is only on the server`)
    server.apps[0]!.workflows.pop()
    expect(designDifference(server, design(), server.apps[0]!.id)).toMatch(/is only in this browser/)
  })
})

describe('liveBadge', () => {
  const on = { appOnServer: true }
  it('counts seconds since the last change, then says idle after 30 s', () => {
    expect(liveBadge({ status: 'live', lastChange: 10_000, ...on }, 14_900)).toEqual({ tone: 'green', text: 'Live · last change 4s ago', word: 'Live' })
    expect(liveBadge({ status: 'live', lastChange: 10_000, ...on }, 9_000).text).toBe('Live · last change 0s ago')
    expect(liveBadge({ status: 'live', lastChange: 10_000, ...on }, 40_000).text).toBe('Live · idle')
    expect(liveBadge({ status: 'live', ...on }, 0).text).toBe('Live · idle')
  })

  it('amber while reconnecting, red on an error, neutral for an app the server lacks', () => {
    expect(liveBadge({ status: 'reconnecting', ...on }, 0)).toMatchObject({ tone: 'amber', word: 'Reconnecting' })
    expect(liveBadge({ status: 'error', ...on }, 0)).toMatchObject({ tone: 'red', text: 'Not connected' })
    expect(liveBadge({ status: 'idle', appOnServer: false }, 0)).toEqual({ tone: 'slate', text: 'Not on this server', word: 'Not on this server' })
    expect(liveBadge({ status: 'idle', ...on }, 0).text).toBe('Not connected')
  })
})
