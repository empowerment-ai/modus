import { seedDesign } from '@modus-bpm/core/model/seed'
import { describe, expect, it } from 'vitest'
import { APP, ORG, REQUESTER, SERVICES, VENDORS, WORKFLOW } from '../k6/data.js'

// The k6 data hard-codes seed ids (k6 can't import the seed); this keeps them honest.
describe('k6 data', () => {
  const d = seedDesign()
  const app = d.apps.find((a) => a.id === APP)!
  const wf = app?.workflows.find((w) => w.id === WORKFLOW)

  it('names the invoice app and workflow', () => {
    expect(app).toBeDefined()
    expect(wf).toBeDefined()
  })

  it('creates as a user who may', () => {
    const groups = d.groups.filter((g) => g.memberIds.includes(REQUESTER)).map((g) => g.id)
    const type = app.objectTypes.find((t) => t.id === wf!.objectTypeId)!
    expect(groups.some((g) => type.permissions?.[g]?.create)).toBe(true)
  })

  it('uses every vendor in the list', () => {
    const vendors = app.lists.find((l) => l.id === 'l_vendors')!
    expect([...VENDORS].sort()).toEqual(vendors.items.map((i) => i.id).sort())
  })

  it('pairs each department with one of its own cost centers', () => {
    const org = app.lists.find((l) => l.id === 'l_org')!
    const byId = new Map(org.items.map((i) => [i.id, i]))
    for (const [dept, cc] of ORG) {
      expect(byId.get(dept)?.parentId, dept).toBeNull()
      expect(byId.get(cc)?.parentId, cc).toBe(dept)
    }
  })

  it('polls exactly the services the workflow calls', () => {
    const called = new Set(wf!.nodes.flatMap((n) => ('serviceId' in n.data && n.data.serviceId ? [n.data.serviceId as string] : [])))
    expect([...SERVICES].sort()).toEqual([...called].sort())
  })
})
