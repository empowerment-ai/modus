// The sample design plus generated AP clerks, so hundreds of simulated people
// can share the invoice clerk step without colliding on the ten seed clerks.
import type { Design, User } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'

const pad = (i: number) => String(i).padStart(4, '0')

export const loadClerkId = (i: number) => `u_load_${pad(i)}`

/** `seedDesign()` with `clerks` users (`u_load_0001`…) added to the AP clerks group. */
export function loadDesign(clerks: number, base: Design = seedDesign()): Design {
  if (!Number.isInteger(clerks) || clerks < 0 || clerks > 9999) throw new Error(`Not a usable clerk count: ${clerks}`)
  const model = base.users.find((u) => u.id === 'u_jordan')
  if (!model) throw new Error('The design has no AP clerk to copy (u_jordan).')
  const users: User[] = Array.from({ length: clerks }, (_, n) => ({ ...model, id: loadClerkId(n + 1), name: `Load Clerk ${pad(n + 1)}` }))
  const ids = users.map((u) => u.id)
  return {
    ...base,
    users: [...base.users, ...users],
    groups: base.groups.map((g) => (g.id === 'g_clerks' ? { ...g, memberIds: [...g.memberIds, ...ids] } : g)),
  }
}
