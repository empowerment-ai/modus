// Process-mining export. The audit history the engine already keeps is an
// object-centric event log; this writes it as OCEL 2.0 JSON
// (https://www.ocel-standard.org) so any process-mining tool can read it:
// one object per item and per person, one event per audit entry, related by role.

import { formatFieldValue } from '../model/format'
import type { FieldType, Id } from '../model/types'
import { simDate } from '../model/util'
import { buildIndex, type Ctx, type SimState, stepOf } from './engine'

type OcelType = 'string' | 'float' | 'integer' | 'boolean' | 'time'

export interface OcelLog {
  objectTypes: Array<{ name: string; attributes: Array<{ name: string; type: OcelType }> }>
  eventTypes: Array<{ name: string; attributes: Array<{ name: string; type: OcelType }> }>
  objects: Array<{ id: string; type: string; attributes: Array<{ name: string; time: string; value: unknown }>; relationships: Array<{ objectId: string; qualifier: string }> }>
  events: Array<{ id: string; type: string; time: string; attributes: Array<{ name: string; value: unknown }>; relationships: Array<{ objectId: string; qualifier: string }> }>
}

const OCEL_TYPE: Partial<Record<FieldType, OcelType>> = { number: 'float', currency: 'float', boolean: 'boolean', date: 'time' }

/** The application's event log in OCEL 2.0 JSON. Activities are "<step> · <what happened>". */
export function exportOcel(sim: SimState, ctx: Ctx): OcelLog {
  const idx = buildIndex(ctx)
  const iso = (minute: number) => simDate(minute).toISOString()
  const objects: OcelLog['objects'] = []
  const events: OcelLog['events'] = []
  const eventTypes = new Map<string, OcelLog['eventTypes'][number]>()
  const people = new Set<Id>()

  for (const obj of Object.values(sim.objects)) {
    const type = idx.type.get(obj.typeId)
    if (!type) continue
    const attributes: OcelLog['objects'][number]['attributes'] = [
      { name: 'status', time: iso(obj.completedAt ?? sim.clock), value: obj.status },
      { name: 'priority', time: iso(sim.clock), value: obj.priority },
    ]
    for (const f of type.fields) {
      const v = obj.data[f.id]
      if (v === undefined || v === null || v === '' || f.type === 'attachment') continue
      const value = OCEL_TYPE[f.type] === 'float' ? Number(v) : f.type === 'boolean' ? !!v : formatFieldValue(f, v, ctx.app.lists, ctx.users)
      attributes.push({ name: f.label, time: iso(obj.createdAt), value })
    }
    objects.push({ id: obj.id, type: type.name, attributes, relationships: [] })

    obj.history.forEach((h, i) => {
      const step = h.nodeId ? stepOf(idx, h.nodeId)?.node.data.label : undefined
      const activity = step ? `${step} · ${h.kind}` : h.kind
      if (!eventTypes.has(activity)) eventTypes.set(activity, { name: activity, attributes: [{ name: 'text', type: 'string' }, { name: 'comment', type: 'string' }] })
      const relationships = [{ objectId: obj.id, qualifier: 'item' }]
      if (h.userId) {
        people.add(h.userId)
        relationships.push({ objectId: h.userId, qualifier: h.kind === 'released' || h.kind === 'started' ? 'performer' : 'assignee' })
      }
      const attributes2: Array<{ name: string; value: unknown }> = [{ name: 'text', value: h.text }]
      if (h.comment) attributes2.push({ name: 'comment', value: h.comment })
      if (h.actor) attributes2.push({ name: 'actor', value: h.actor })
      events.push({ id: `${obj.id}-${i + 1}`, type: activity, time: iso(h.at), attributes: attributes2, relationships })
    })
  }

  for (const id of people) {
    const u = idx.user.get(id)
    objects.push({ id, type: 'Person', attributes: [{ name: 'name', time: iso(0), value: u?.name ?? id }, { name: 'title', time: iso(0), value: u?.title ?? '' }], relationships: [] })
  }

  const objectTypes: OcelLog['objectTypes'] = ctx.app.objectTypes.map((t) => ({
    name: t.name,
    attributes: [
      { name: 'status', type: 'string' as OcelType },
      { name: 'priority', type: 'string' as OcelType },
      ...t.fields.filter((f) => f.type !== 'attachment').map((f) => ({ name: f.label, type: (OCEL_TYPE[f.type] === 'time' ? 'string' : (OCEL_TYPE[f.type] ?? 'string')) as OcelType })),
    ],
  }))
  objectTypes.push({ name: 'Person', attributes: [{ name: 'name', type: 'string' }, { name: 'title', type: 'string' }] })

  events.sort((a, b) => a.time.localeCompare(b.time))
  return { objectTypes, eventTypes: [...eventTypes.values()], objects, events }
}
