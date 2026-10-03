import { describe, expect, it } from 'vitest'
import { describeCondition, evaluateCondition, withMeta } from '../model/conditions'
import { seedDesign } from '../model/seed'
import { fieldVerdicts } from '../model/security'
import { normalizeData, rowsOf } from '../model/tables'
import type { ObjectType } from '../model/types'
import { ask, translateQuestion } from './assistant'
import { activeTokens, advance, createObject, type Ctx, newSim, workStepOf, buildIndex, supervisesStep } from './engine'
import { adminUpdateData, canExpedite, setExpedite, superviseAssign, superviseRedistribute, superviseRelease, workDelegate, workNext, workSave } from './ops'
import { canReadItem, parseQuery, searchItems, visibleHistory } from './search'
import { computeView, supervisionFor } from './view'

function seedCtx(appIndex = 0, manual: string[] = []): Ctx {
  const d = seedDesign()
  return { app: d.apps[appIndex]!, users: d.users, groups: d.groups, services: d.services, manualUserIds: manual }
}

const invoiceType = (ctx: Ctx) => ctx.app.objectTypes[0]!
const lines = (...amounts: Array<[number, number, string?]>) => amounts.map(([qty, price, cat], i) => ({ id: `r${i}`, c_desc: `Line ${i + 1}`, c_qty: qty, c_price: price, c_cat: cat }))

// ---------- Line items (table fields) ----------

describe('line items', () => {
  it('computes each line total and keeps the invoice amount equal to their sum', () => {
    const type = invoiceType(seedCtx())
    const data = normalizeData(type, { f_lines: lines([2, 10.5], [3, 100]) })
    expect(rowsOf(data.f_lines).map((r) => r.c_total)).toEqual([21, 300])
    expect(data.f_amount).toBe(321)
    // Unchanged data comes back as the same object.
    expect(normalizeData(type, data)).toBe(data)
  })

  it('rules test the number of rows, a column total, or any / every row', () => {
    const ctx = seedCtx()
    const type = invoiceType(ctx)
    const software = ctx.app.lists.find((l) => l.id === 'l_category')!.items.find((i) => i.label === 'Software')!.id
    const data = normalizeData(type, { f_lines: lines([1, 4000, software], [2, 50]) })
    const rule = (r: Record<string, unknown>) => evaluateCondition({ match: 'all', rules: [{ id: 'x', fieldId: 'f_lines', op: 'gt', ...r } as never] }, type, data)
    expect(rule({ aggregate: 'count', value: 1 })).toBe(true)
    expect(rule({ aggregate: 'sum', columnId: 'c_total', value: 4099 })).toBe(true)
    expect(rule({ aggregate: 'sum', columnId: 'c_total', value: 4100 })).toBe(false)
    expect(evaluateCondition({ match: 'all', rules: [{ id: 'y', fieldId: 'f_lines', op: 'eq', aggregate: 'any', columnId: 'c_cat', value: software }] }, type, data)).toBe(true)
    expect(evaluateCondition({ match: 'all', rules: [{ id: 'z', fieldId: 'f_lines', op: 'eq', aggregate: 'all', columnId: 'c_cat', value: software }] }, type, data)).toBe(false)
    const text = describeCondition({ match: 'all', rules: [{ id: 'y', fieldId: 'f_lines', op: 'eq', aggregate: 'any', columnId: 'c_cat', value: software }] }, { type, lists: ctx.app.lists, users: ctx.users })
    expect(text).toBe('Line Items: any row where Category is Software')
  })

  it('simulated invoices get lines that add up to their amount', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 21)
    advance(sim, ctx, 6 * 60)
    const objs = Object.values(sim.objects)
    expect(objs.length).toBeGreaterThan(40)
    for (const o of objs) {
      const rows = rowsOf(o.data.f_lines)
      expect(rows.length).toBeGreaterThan(0)
      const sum = Math.round(rows.reduce((s, r) => s + Number(r.c_total), 0) * 100) / 100
      expect(o.data.f_amount).toBe(sum)
    }
  })

  it('a table feeding a locked total is locked too; the total itself is never typed', () => {
    const ctx = seedCtx()
    const type = invoiceType(ctx)
    const wf = ctx.app.workflows[0]!
    const verdicts = fieldVerdicts({ type, wf, node: wf.nodes.find((n) => n.id === 'n_clerk'), passed: ['n_amount'], userId: 'u_maya', groups: ctx.groups })
    expect(verdicts.f_amount!.access).toBe('read')
    expect(verdicts.f_lines!.access).toBe('read')
  })
})

// ---------- Rules on work attributes ----------

describe('expedite', () => {
  it('rules can route on $expedited and $priority', () => {
    const type: ObjectType = invoiceType(seedCtx())
    const cond = { match: 'all' as const, rules: [{ id: 'a', fieldId: '$expedited', op: 'isTrue' as const }, { id: 'b', fieldId: '$priority', op: 'eq' as const, value: 'high' }] }
    expect(evaluateCondition(cond, type, withMeta({}, { priority: 'high', expedited: true }))).toBe(true)
    expect(evaluateCondition(cond, type, withMeta({}, { priority: 'high', expedited: false }))).toBe(false)
  })

  it('expedited work jumps every queue (even urgent), has a tighter due date, and small invoices take the fast lane', () => {
    const ctx = seedCtx(0, ['u_rosa', 'u_kevin', 'u_ellen'])
    ctx.services!.find((s) => s.id === 'svc_erp')!.operations[0]!.outputs[0]!.trueRate = 0 // send everything to exceptions
    const sim = newSim('app_invoice', 3)
    sim.arrivals = false
    const urgent = createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 900]), f_priority: 'l_priority_2' }, 'u_maya')!
    const rush = createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 900]) }, 'u_maya', undefined, { expedite: { reason: 'Payment deadline today' } })!
    expect(rush.dueBy! - rush.createdAt).toBe((urgent.dueBy! - urgent.createdAt) / 2)
    advance(sim, ctx, 10)
    const next = workNext(sim, ctx, 'u_rosa')
    expect(next.ok && next.value.startsWith(rush.id)).toBe(true)
  })

  it('who may expedite follows the process policy, and a reason is required where asked', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice')
    sim.arrivals = false
    const o = createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 300]) }, 'u_maya')!
    expect(canExpedite(sim, ctx, o.id, 'u_jordan')).toBe(false) // a colleague who didn't create it
    expect(setExpedite(sim, ctx, o.id, 'u_maya', true, '').ok).toBe(false) // reason required
    expect(setExpedite(sim, ctx, o.id, 'u_maya', true, 'Vendor will stop service').ok).toBe(true)
    expect(o.history.some((h) => h.text.startsWith('Expedited by Maya Patel'))).toBe(true)
    expect(setExpedite(sim, ctx, o.id, 'u_victor', false).ok).toBe(true) // a process supervisor (Finance Leadership)
  })

  it('the simulation tracks expedited cycle time separately — and it is shorter', () => {
    const ctx = seedCtx()
    ctx.app.workflows[0]!.expedite!.simulateRate = 0.25
    const sim = newSim('app_invoice', 8)
    advance(sim, ctx, 16 * 60)
    const v = computeView(sim, ctx)
    expect(sim.expFinished).toBeGreaterThan(10)
    expect(v.expeditedCycle).toBeLessThan(v.normalCycle)
  })
})

// ---------- Supervisors ----------

describe('supervisors', () => {
  it('supervise only their own work, and reassign only within the group (administrators may go wider)', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 4)
    advance(sim, ctx, 3 * 60)
    const tok = activeTokens(sim).find((t) => ctx.app.workflows[0]!.nodes.find((n) => n.id === t.nodeId)?.data.label === 'AP clerk review' && t.state === 'assigned')
      ?? activeTokens(sim).find((t) => t.nodeId === 'n_clerk')!
    expect(superviseAssign(sim, ctx, tok.id, 'u_jordan', 'u_dana').ok).toBe(false) // fleet manager: not hers
    const other = ['u_maya', 'u_jordan', 'u_aisha'].find((u) => u !== tok.userId)!
    expect(superviseAssign(sim, ctx, tok.id, other, 'u_carla').ok).toBe(true) // step supervisor, same group
    expect(superviseAssign(sim, ctx, tok.id, 'u_rosa', 'u_carla').ok).toBe(false) // outside the group
    expect(superviseAssign(sim, ctx, tok.id, 'u_rosa', 'u_avery').ok).toBe(true) // administrator
    expect(superviseRedistribute(sim, ctx, 'n_clerk', 'u_noah').ok).toBe(false)
  })

  it('process supervisors can release on someone’s behalf, with an audited comment', () => {
    const ctx = seedCtx(0, ['u_victor'])
    const sim = newSim('app_invoice', 6)
    advance(sim, ctx, 4 * 60)
    const tok = activeTokens(sim).find((t) => t.nodeId === 'n_controller')!
    const obj = sim.objects[tok.objectId]!
    const ok = workStepOf(buildIndex(ctx), tok)!.outcomes[0]!.id
    expect(superviseRelease(sim, ctx, tok.id, ok, 'Approved while Victor is in audit meetings', 'u_carla').ok).toBe(true)
    expect(obj.history.some((h) => h.kind === 'released' && h.actor === 'Carla Mendes' && h.comment?.includes('audit meetings'))).toBe(true)
  })

  it('process supervisors also oversee the subflows their process calls', () => {
    const ctx = seedCtx(2)
    const idx = buildIndex(ctx)
    // Liz is a watch commander (process supervisors of Event Triage); Incident Report's writing step belongs to the officers' group.
    expect(supervisesStep(idx, 'r_write', 'u_liz')).toBe(true)
    expect(supervisionFor(newSim('app_soc', 1), ctx, 'u_liz').steps.map((s) => s.nodeId)).toContain('r_write')
    expect(supervisesStep(idx, 'r_write', 'u_carmen')).toBe(false)
  })

  it('a supervisor sees every step they oversee and what is there now', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 4)
    advance(sim, ctx, 8 * 60)
    const s = supervisionFor(sim, ctx, 'u_carla')
    expect(s.processes.map((p) => p.name)).toContain('Invoice Approval')
    expect(s.steps.map((x) => x.label)).toEqual(expect.arrayContaining(['AP clerk review', 'Manager approval', 'Triage exception']))
    expect(supervisionFor(sim, ctx, 'u_elena').steps.length).toBe(0) // she supervises the camera app, not invoices
    expect(supervisionFor(sim, ctx, 'u_avery').processes.length).toBe(1) // administrators see every process
  })

  it('workers still delegate only within their own group', () => {
    const ctx = seedCtx(0, ['u_maya'])
    const sim = newSim('app_invoice', 9)
    advance(sim, ctx, 6 * 60)
    const mine = activeTokens(sim).find((t) => t.userId === 'u_maya')
    if (mine) expect(workDelegate(sim, ctx, mine.id, 'u_maya', 'u_victor').ok).toBe(false)
  })
})

// ---------- Search ----------

describe('search', () => {
  it('parses words, phrases, exclusions and filters', () => {
    const q = parseQuery('acme "net 30" -freight priority:urgent amount>10k "line total">=500 is:overdue')
    expect(q.terms).toEqual(['acme'])
    expect(q.phrases).toEqual(['net 30'])
    expect(q.excluded).toEqual(['freight'])
    expect(q.filters.map((f) => `${f.key}${f.op}${f.value}`)).toEqual(['priority:urgent', 'amount>10k', 'line total>=500', 'is:overdue'])
  })

  it('finds items by field, line-item column, amount and state', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 12)
    advance(sim, ctx, 8 * 60)
    const big = searchItems(sim, ctx, 'amount>10k')
    expect(big.total).toBeGreaterThan(0)
    expect(big.hits.every((h) => Number(h.obj.data.f_amount) > 10000)).toBe(true)
    const open = searchItems(sim, ctx, 'is:open -rejected')
    expect(open.hits.every((h) => h.obj.status === 'active')).toBe(true)
    const toner = searchItems(sim, ctx, 'description:"toner"')
    expect(toner.hits.every((h) => rowsOf(h.obj.data.f_lines).some((r) => String(r.c_desc).toLowerCase().includes('toner')))).toBe(true)
    const one = Object.values(sim.objects)[5]!
    expect(searchItems(sim, ctx, one.number).hits[0]!.obj).toBe(one)
    expect(Object.keys(big.facets.step).length).toBeGreaterThan(0)
  })

  it('never matches or shows a field the searcher may not see', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 12)
    sim.arrivals = false
    createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 80]), f_bank: 'IBAN-SECRET-9911' }, 'u_maya')
    expect(searchItems(sim, ctx, 'IBAN-SECRET', { userId: 'u_rosa' }).total).toBe(1) // AP Exceptions may see bank details
    expect(searchItems(sim, ctx, 'IBAN-SECRET', { userId: 'u_maya' }).total).toBe(0) // the clerk who created it may not
    expect(searchItems(sim, ctx, 'is:open', { userId: 'u_carmen' }).total).toBe(0) // a patrol officer can't read invoices
  })

  it('blanks a title made from a field the searcher may not see', () => {
    const ctx = seedCtx()
    ctx.app.objectTypes[0]!.titleFieldId = 'f_bank'
    const sim = newSim('app_invoice', 12)
    sim.arrivals = false
    createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 80]), f_bank: 'IBAN-TITLE-1' }, 'u_rosa')
    expect(searchItems(sim, ctx, 'is:open', { userId: 'u_rosa' }).hits[0]!.title).toBe('IBAN-TITLE-1')
    expect(searchItems(sim, ctx, 'is:open', { userId: 'u_maya' }).hits[0]!.title).toBe('')
    expect(searchItems(sim, ctx, 'IBAN-TITLE', { userId: 'u_maya' }).total).toBe(0)
  })

  it('number= matches one item exactly; number: matches part of it', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 12)
    advance(sim, ctx, 8 * 60)
    const first = Object.values(sim.objects)[0]!
    const exact = searchItems(sim, ctx, `number=${first.number}`, { userId: 'u_avery' })
    expect(exact.hits.map((h) => h.obj.id)).toEqual([first.id])
    expect(searchItems(sim, ctx, `number:${first.number.slice(0, -1)}`, { userId: 'u_avery' }).total).toBeGreaterThan(1)
  })

  it('history and the assistant never reveal a hidden field’s value', () => {
    const ctx = seedCtx()
    const sim = newSim('app_invoice', 12)
    sim.arrivals = false
    const obj = createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 80]) }, 'u_maya')!
    adminUpdateData(sim, ctx, obj.id, { f_bank: 'IBAN-SECRET-9911' })
    const forClerk = visibleHistory(ctx, obj, 'u_maya').map((h) => h.text).join(' | ')
    expect(forClerk).not.toContain('IBAN-SECRET')
    expect(forClerk).toContain('Vendor Bank Account changed by')
    expect(visibleHistory(ctx, obj, 'u_rosa').map((h) => h.text).join(' | ')).toContain('IBAN-SECRET') // AP Exceptions may see it
    expect(ask(sim, ctx, `where is ${obj.number}?`, { userId: 'u_maya' }).text).not.toContain('IBAN-SECRET')
    expect(canReadItem(ctx, obj, 'u_carmen')).toBe(false)
    expect(ask(sim, ctx, `where is ${obj.number}?`, { userId: 'u_carmen' }).text).toMatch(/access/)
  })
})

// ---------- Assistant ----------

describe('assistant', () => {
  it('reads “my …” as my basket and ignores filler such as “only”', () => {
    const ctx = seedCtx()
    const mine = translateQuestion('Show my overdue items', ctx, 'u_maya').query
    expect(mine).toContain('is:mine')
    expect(mine).toContain('is:overdue')
    expect(translateQuestion('Only the expedited ones', ctx, 'u_maya').query).toBe('is:expedited')
    expect(translateQuestion('my team’s overdue invoices', ctx, 'u_maya').query).not.toContain('is:mine')
  })

  it('turns a question into a search it can show', () => {
    const ctx = seedCtx()
    const { query } = translateQuestion('Show me urgent invoices from Acme over $10k that are overdue', ctx)
    expect(query).toContain('priority:urgent')
    expect(query).toContain('is:overdue')
    expect(query).toContain('Amount>10k')
    expect(query.toLowerCase()).toContain('vendor:acme')
    expect(translateQuestion('what is waiting at manager approval', ctx).query).toContain('step:"Manager approval"')
  })

  it('answers about an item, my work, the bottleneck, counts and how-tos', () => {
    const ctx = seedCtx(0, ['u_maya'])
    const sim = newSim('app_invoice', 5)
    advance(sim, ctx, 10 * 60)
    const any = Object.values(sim.objects).find((o) => o.status === 'active')!
    const item = ask(sim, ctx, `where is ${any.number.toLowerCase()}?`, { userId: 'u_avery' })
    expect(item.kind).toBe('item')
    expect(item.text).toContain(any.number)
    expect(ask(sim, ctx, 'What should I work on next?', { userId: 'u_maya' }).kind).toBe('results')
    expect(ask(sim, ctx, "what's the bottleneck?", { userId: 'u_avery' }).text).toMatch(/bottleneck|backed up/i)
    const count = ask(sim, ctx, 'how many invoices are overdue?', { userId: 'u_avery' })
    expect(count.query).toContain('is:overdue')
    expect(ask(sim, ctx, 'How do I expedite something?').kind).toBe('help')
    expect(ask(sim, ctx, 'hello').suggestions.length).toBeGreaterThan(0)
  })
})

// keep workSave in the import list honest: line items edited at a step that allows it
describe('editing line items at a step', () => {
  it('recalculates the amount and records it', () => {
    const ctx = seedCtx(0, ['u_rosa', 'u_kevin', 'u_ellen'])
    ctx.services!.find((s) => s.id === 'svc_erp')!.operations[0]!.outputs[0]!.trueRate = 0
    const sim = newSim('app_invoice', 2)
    sim.arrivals = false
    const o = createObject(sim, ctx, 'w_invoice', { f_lines: lines([1, 100]) }, 'u_maya')!
    advance(sim, ctx, 10)
    const claim = workNext(sim, ctx, 'u_rosa')
    expect(claim.ok).toBe(true)
    // Triage only edits the description; correcting the data is the "Correct invoice data" step.
    expect(workSave(sim, ctx, o.tokens[0]!.id, 'u_rosa', { f_lines: lines([2, 100]) }).ok).toBe(false)
  })
})
