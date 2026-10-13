import { describe, expect, it } from 'vitest'
import { seedDesign } from '../model/seed'
import { activeTokens, advance, type Ctx, newSim } from './engine'
import { exploreItems, explorerMatcher, explorerOrder, explorerRow, explorerState, explorerText } from './explorer'
import type { SimObject } from './state'

function seedCtx(): Ctx {
  const d = seedDesign()
  return { app: d.apps[0]!, users: d.users, groups: d.groups, services: d.services }
}

/** A day of the invoice simulation: active, finished and parallel work. */
function day() {
  const ctx = seedCtx()
  const sim = newSim('app_invoice', 7)
  advance(sim, ctx, 24 * 60)
  return { ctx, sim, all: Object.values(sim.objects) }
}

describe('item explorer', () => {
  it('filters by status (rejected includes cancelled), type, step and assignee', () => {
    const { ctx, sim, all } = day()
    const count = (f: Parameters<typeof explorerMatcher>[0]) => all.filter(explorerMatcher(f, ctx)).length
    expect(count({})).toBe(all.length)
    expect(count({ status: 'active' })).toBe(all.filter((o) => o.status === 'active').length)
    expect(count({ status: 'active' })).toBeGreaterThan(0)
    expect(count({ status: 'completed' })).toBe(all.filter((o) => o.status === 'completed').length)
    expect(count({ status: 'rejected' })).toBe(all.filter((o) => o.status === 'rejected' || o.status === 'cancelled').length)
    expect(count({ typeId: ctx.app.objectTypes[0]!.id })).toBe(all.length)
    expect(count({ typeId: 'nope' })).toBe(0)
    const tok = activeTokens(sim).find((t) => t.userId)!
    expect(count({ stepId: tok.nodeId })).toBe(all.filter((o) => o.tokens.some((t) => t.nodeId === tok.nodeId || t.calls.some((c) => c.nodeId === tok.nodeId))).length)
    expect(count({ stepId: tok.nodeId })).toBeGreaterThan(0)
    expect(count({ assignee: tok.userId })).toBe(all.filter((o) => o.tokens.some((t) => t.userId === tok.userId)).length)
    expect(count({ assignee: tok.userId })).toBeGreaterThan(0)
  })

  it('matches text case-insensitively against the number and formatted field values', () => {
    const { ctx, all } = day()
    const o = all[3]!
    expect(explorerText(o, ctx)).toContain(o.number.toLowerCase())
    expect(all.filter(explorerMatcher({ q: `  ${o.number.toUpperCase()} ` }, ctx)).map((x) => x.id)).toContain(o.id)
    expect(all.filter(explorerMatcher({ q: 'zzz-no-such-thing' }, ctx))).toEqual([])
    // Line items count, not just "3 rows".
    const desc = all.flatMap((x) => ((x.data.f_lines as Array<{ c_desc?: string }>) ?? []).map((r) => r.c_desc)).find(Boolean)!
    expect(all.filter(explorerMatcher({ q: desc }, ctx)).length).toBeGreaterThan(0)
  })

  it('pages newest first without duplicates or gaps', () => {
    const { ctx, sim, all } = day()
    const seen: string[] = []
    let after: SimObject | undefined
    for (;;) {
      const page = exploreItems(sim, ctx, {}, { limit: 7, after })
      expect(page.total).toBe(all.length)
      seen.push(...page.items.map((o) => o.id))
      if (!page.more) break
      after = page.items[page.items.length - 1]
    }
    expect(seen).toEqual([...all].sort(explorerOrder).map((o) => o.id))
    for (let i = 1; i < seen.length; i++) expect(sim.objects[seen[i - 1]!]!.createdAt).toBeGreaterThanOrEqual(sim.objects[seen[i]!]!.createdAt)
  })

  it('orders ties by number, then id', () => {
    expect(explorerOrder({ createdAt: 5, number: 'A', id: 'x' }, { createdAt: 4, number: 'Z', id: 'y' })).toBeLessThan(0)
    expect(explorerOrder({ createdAt: 5, number: 'B', id: 'x' }, { createdAt: 5, number: 'A', id: 'y' })).toBeLessThan(0)
    expect(explorerOrder({ createdAt: 5, number: 'A', id: 'y' }, { createdAt: 5, number: 'A', id: 'x' })).toBeLessThan(0)
  })

  it('rows are small: title, summary values, step, assignee, state and age', () => {
    const { ctx, sim, all } = day()
    const type = ctx.app.objectTypes[0]!
    const active = all.find((o) => o.status === 'active' && o.tokens.some((t) => t.userId))!
    const row = explorerRow(active, ctx, sim.clock)
    expect(row).toMatchObject({
      id: active.id,
      number: active.number,
      typeId: type.id,
      status: 'active',
      state: explorerState(active),
      stepId: active.tokens[0]!.nodeId,
      assignee: active.tokens.find((t) => t.userId)!.userId,
      createdAt: active.createdAt,
      age: sim.clock - active.createdAt,
    })
    expect(row.title).toBeTruthy()
    expect(row.step).toBeTruthy()
    expect(Object.keys(row.summary).length).toBeGreaterThan(0)
    for (const k of Object.keys(row.summary)) expect(type.fields.find((f) => f.id === k)!.summary).toBe(true)
    expect(row).not.toHaveProperty('history')
    expect(row).not.toHaveProperty('data')
    const done = all.find((o) => o.status === 'completed')!
    expect(explorerRow(done, ctx, sim.clock)).toMatchObject({ state: 'completed', stepId: done.endNodeId, completedAt: done.completedAt, age: done.completedAt! - done.createdAt })
  })
})
