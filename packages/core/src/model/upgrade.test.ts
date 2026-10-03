import { describe, expect, it } from 'vitest'
import { seedDesign } from './seed'
import { upgradeDesign } from './upgrade'
import type { Design } from './types'

/** The sample design as a browser saved it before line items, supervisors and expedite existed. */
function savedBeforeLineItems(): Design {
  const d = seedDesign()
  const inv = d.apps.find((a) => a.id === 'app_invoice')!
  const type = inv.objectTypes[0]!
  type.fields = type.fields.filter((f) => f.id !== 'f_lines')
  delete type.fields.find((f) => f.id === 'f_amount')!.total
  inv.lists = inv.lists.filter((l) => l.id !== 'l_category')
  const wf = inv.workflows.find((w) => w.id === 'w_invoice')!
  delete wf.supervisors
  delete wf.expedite
  wf.edges = wf.edges.filter((e) => e.id !== 'e_fast')
  for (const n of wf.nodes) if (n.type === 'user') delete n.data.supervisors
  d.users = d.users.filter((u) => u.id !== 'u_avery').map(({ roles: _, ...u }) => u)
  return d
}

describe('upgrading a saved design', () => {
  it('adds what newer sample data has, keeping the person’s edits', () => {
    const saved = savedBeforeLineItems()
    const inv = saved.apps.find((a) => a.id === 'app_invoice')!
    inv.workflows.find((w) => w.id === 'w_invoice')!.name = 'Our Invoice Approval'
    inv.objectTypes[0]!.fields.find((f) => f.id === 'f_vendor')!.label = 'Supplier'

    const up = upgradeDesign(saved, seedDesign())
    const app = up.apps.find((a) => a.id === 'app_invoice')!
    const type = app.objectTypes[0]!
    const wf = app.workflows.find((w) => w.id === 'w_invoice')!
    expect(type.fields.map((f) => f.id)).toContain('f_lines')
    // Inserted where the sample has it, not at the end.
    expect(type.fields.findIndex((f) => f.id === 'f_lines')).toBe(seedDesign().apps[0]!.objectTypes[0]!.fields.findIndex((f) => f.id === 'f_lines'))
    expect(type.fields.find((f) => f.id === 'f_amount')!.total).toEqual({ tableFieldId: 'f_lines', columnId: 'c_total' })
    expect(app.lists.some((l) => l.id === 'l_category')).toBe(true)
    expect(wf.supervisors).toEqual({ groupIds: ['g_finlead'] })
    expect(wf.expedite?.who).toBe('requester')
    expect(wf.edges.some((e) => e.id === 'e_fast')).toBe(true)
    expect(up.users.find((u) => u.id === 'u_avery')?.roles).toContain('admin')
    // Edits survive.
    expect(wf.name).toBe('Our Invoice Approval')
    expect(type.fields.find((f) => f.id === 'f_vendor')!.label).toBe('Supplier')
    // The saved design itself is untouched.
    expect(saved.apps[0]!.objectTypes[0]!.fields.some((f) => f.id === 'f_lines')).toBe(false)
  })

  it('does not bring back a sample application the person deleted, and leaves their own apps alone', () => {
    const saved = savedBeforeLineItems()
    saved.apps = saved.apps.filter((a) => a.id !== 'app_fleet')
    saved.apps.push({ ...structuredClone(saved.apps[0]!), id: 'app_mine', name: 'Mine' })
    const up = upgradeDesign(saved, seedDesign())
    expect(up.apps.map((a) => a.id)).toEqual(['app_invoice', 'app_soc', 'app_mine'])
    expect(up.apps.find((a) => a.id === 'app_mine')!.objectTypes[0]!.fields.some((f) => f.id === 'f_lines')).toBe(false)
  })

  it('leaves an up-to-date design as it is', () => {
    expect(upgradeDesign(seedDesign(), seedDesign())).toEqual(seedDesign())
  })
})
