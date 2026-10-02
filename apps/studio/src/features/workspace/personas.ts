import { buildIndex, type Ctx, distributorsOf } from '@modus-bpm/core'
import type { App, Group, Id, User } from '@modus-bpm/core/model/types'

// Who you can work as in an application, and a one-line hint of what each
// person does there, worked out from the design (steps, dispatch, permissions).

/** Hand-picked people that show off each sample application well. */
const SUGGESTED: Record<Id, Array<{ userId: Id; role: string }>> = {
  app_invoice: [
    { userId: 'u_maya', role: 'Clerk' },
    { userId: 'u_rosa', role: 'Exceptions' },
    { userId: 'u_carla', role: 'Dispatcher' },
    { userId: 'u_victor', role: 'Controller' },
  ],
  app_fleet: [
    { userId: 'u_amir', role: 'Requester' },
    { userId: 'u_dana', role: 'Dispatcher' },
    { userId: 'u_ian', role: 'Procurement' },
  ],
  app_soc: [
    { userId: 'u_elena', role: 'Watch commander' },
    { userId: 'u_tess', role: 'Analyst' },
    { userId: 'u_carmen', role: 'Officer' },
  ],
}

/** Groups the application refers to: step groups, dispatchers, fallbacks and type permissions. */
function appGroupIds(app: App): Set<Id> {
  const ids = new Set<Id>()
  for (const wf of app.workflows) {
    for (const n of wf.nodes) {
      if (n.type === 'user') {
        if (n.data.groupId) ids.add(n.data.groupId)
        if (n.data.distributorGroupId) ids.add(n.data.distributorGroupId)
      } else if (n.type === 'auto' && n.data.fallbackGroupId) ids.add(n.data.fallbackGroupId)
    }
  }
  for (const t of app.objectTypes) for (const [gid, p] of Object.entries(t.permissions)) if (p.create || p.read || p.update) ids.add(gid)
  return ids
}

/** Everyone who takes part in the application, by name. */
export function appPeople(app: App, users: User[], groups: Group[]): User[] {
  const ids = new Set<Id>()
  const gids = appGroupIds(app)
  for (const g of groups) {
    if (!gids.has(g.id)) continue
    for (const m of g.memberIds) ids.add(m)
    if (g.supervisorId) ids.add(g.supervisorId)
  }
  for (const wf of app.workflows) {
    for (const n of wf.nodes) {
      if (n.type !== 'user') continue
      if (n.data.userId) ids.add(n.data.userId)
      if (n.data.supervisorId) ids.add(n.data.supervisorId)
    }
  }
  return users.filter((u) => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name))
}

/** What a person does in the app: "works AP clerk review", "dispatches Manager approval", "can create Invoices". */
export function roleHints(ctx: Ctx, userId: Id): string[] {
  const idx = buildIndex(ctx)
  const member = (gid?: Id) => !!gid && !!idx.group.get(gid)?.memberIds.includes(userId)
  const works: string[] = []
  const dispatches: string[] = []
  const backs: string[] = []
  for (const wf of ctx.app.workflows) {
    for (const n of wf.nodes) {
      if (n.type === 'user') {
        const d = n.data
        if (d.distribution === 'direct' ? d.userId === userId : member(d.groupId)) works.push(d.label)
        if (d.distribution === 'manager' && distributorsOf(idx, d).includes(userId)) dispatches.push(d.label)
      } else if (n.type === 'auto' && member(n.data.fallbackGroupId)) backs.push(n.data.label)
    }
  }
  const creates = ctx.app.objectTypes.filter((t) => Object.entries(t.permissions).some(([gid, p]) => p.create && member(gid))).map((t) => t.pluralName)
  return [
    ...works.map((l) => `works ${l}`),
    ...dispatches.map((l) => `dispatches ${l}`),
    ...creates.map((p) => `can create ${p}`),
    ...(backs.length ? [`backs up ${backs.length === 1 ? backs[0] : `${backs.length} automated steps`}`] : []),
  ]
}

/** Suggested personas for the app (3–4), falling back to the people with the most to do. */
export function suggestedPeople(ctx: Ctx, people: User[]): Array<{ user: User; role: string }> {
  const byId = new Map(people.map((u) => [u.id, u]))
  const picked = (SUGGESTED[ctx.app.id] ?? []).flatMap(({ userId, role }) => {
    const user = byId.get(userId)
    return user ? [{ user, role }] : []
  })
  if (picked.length) return picked
  return people
    .map((user) => ({ user, n: roleHints(ctx, user.id).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(({ user }) => ({ user, role: user.title }))
}
