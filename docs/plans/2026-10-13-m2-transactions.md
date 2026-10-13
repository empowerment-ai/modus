# M2 Transactions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every command runs in one storage transaction (state, audit entries, projections, outbox, clock), so several servers can share one PostgreSQL database safely.

**Architecture:** `Storage.transact(appId, known, work)` locks the application's row, hands the runtime the stored state when another replica moved it, runs the command on a working copy, and commits everything at once. The runtime's cache changes only after a commit. A pure core module (`engine/project.ts`) turns "state before" and "state after" into audit entries, projection rows and outbox messages. Replicas hear each other through `LISTEN/NOTIFY`; one replica per application ticks the clock, chosen by an advisory lock.

**Tech Stack:** TypeScript, Vitest, Kysely + node-postgres, Fastify, Helm.

**Design:** `docs/plans/2026-10-13-m2-transactions-design.md` (approved). Read it first.

---

## Decisions made while planning (refinements of the design)

1. **Storage numbers audit entries, not the runtime.** The runtime sends new entries without `seq`; the adapter numbers each item's entries after the highest `seq` it already holds (under the row lock, so it's safe). This removes every offset/position concept from the runtime, and logs written by the old crash recovery (log ahead of state) keep working after the upgrade instead of hitting the unique constraint forever.
2. **The runtime works on a copy.** Inside the transaction it runs the command on `stored.state` (when another replica moved it) or a `structuredClone` of the cache, and adopts it only after the commit. A failed command or commit leaves the cache untouched, with no restore step.
3. **Outbox and touched items come from diffing before/after**, not only from audit entries: `job.ready` is a token that is now `auto` with a `serviceId` and not `manual`, at a step and attempt it wasn't at before (dispatch writes no audit entry; keying on the step too catches a call that leads straight into another service step, where the attempt resets to 1). `notify` comes from new `notify` and `escalated` entries.
4. **`work_item.state` stores the engine's `TokenState` as is** (`auto`, `queued`, `unassigned`, `assigned`, `working`, `waiting`, `joining`, `stuck`), not the four states sketched in the design. Times (`due_at`, `entered_at`, `created_at`, `ended_at`) are simulated minutes (`double precision`), like `event.at`.
5. **Clock leadership is per owner.** `tryClock(appId, owner)` / `releaseClocks(owner)`. Postgres ignores `owner` (the dedicated connection is the owner, so use one storage per runtime); the memory adapter uses it so two runtimes can share one in-memory store in tests.
6. **Idle ticks don't move the cached clock.** A tick that wrote no audit entries and is under 30 s since `ticked_at` rolls back, so reads show a clock up to 30 s old on a quiet application. Accepted.
7. **Worker polls check before they lock.** `/api/jobs/poll` skips an application when a read of the cache shows no open job for that service, so idle workers don't write every application's state every second.

## Commands

- Core tests: `pnpm --filter @modus-bpm/core test`
- Server tests (memory only): `pnpm --filter @modus-bpm/server test`
- Server tests against Postgres: start it with `docker compose up -d postgres`, then
  `TEST_DATABASE_URL=postgres://modus:modus-dev-only@127.0.0.1:5432/modus pnpm --filter @modus-bpm/server test:pg`
- Typecheck everything: `pnpm typecheck`

Commit after every task. Messages follow the repo's style (`server: ...`, `core: ...`, `docs: ...`) and end with the attribution line. Check `git log --format='%ae' -1` is `rmichak@gmail.com` after the first commit.

---

### Task 1: `projectItem` in core

**Files:**
- Create: `packages/core/src/engine/project.ts`
- Create: `packages/core/src/engine/project.test.ts`
- Modify: `packages/core/src/engine/view.ts:288` (export `toItem` as `workItemOf`)
- Modify: `packages/core/src/index.ts` (add `export * from './engine/project'`)

**Step 1: Write the failing tests**

```ts
// packages/core/src/engine/project.test.ts
import { describe, expect, it } from 'vitest'
import { seedDesign } from '../model/seed'
import { advance, createObject, type Ctx, newSim } from './engine'
import { projectItem } from './project'

function live(): Ctx {
  const d = seedDesign()
  return { app: d.apps[0]!, users: d.users, groups: d.groups, services: d.services, live: true }
}

describe('projectItem', () => {
  it('maps an item and its service-bound token', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-1' }, 'u_maya')!
    const p = projectItem(sim, ctx, o.id)!
    expect(p.item).toMatchObject({ itemId: o.id, number: o.number, status: 'active', priority: o.priority, expedited: false, createdAt: o.createdAt, data: o.data })
    expect(p.item.endedAt).toBeUndefined()
    expect(p.workItems).toHaveLength(1)
    expect(p.workItems[0]).toMatchObject({ tokenId: o.tokens[0]!.id, itemId: o.id, stepId: 'n_capture', state: 'auto', serviceId: 'svc_erp', priority: o.priority })
  })

  it('gives people steps their group, assignee and due time', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-2' }, 'u_maya')!
    // Take the automated step to a person, as a failed job eventually does.
    const t = o.tokens[0]!
    t.manual = true
    advance(sim, ctx, 1)
    const people = projectItem(sim, ctx, o.id)!.workItems.filter((w) => w.groupId)
    for (const w of people) expect(['unassigned', 'assigned', 'working']).toContain(w.state)
  })

  it('has no work items once the item has ended, and an end time', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'P-3' }, 'u_maya')!
    o.status = 'cancelled'
    o.completedAt = 12
    o.tokens = []
    const p = projectItem(sim, ctx, o.id)!
    expect(p.item).toMatchObject({ status: 'cancelled', endedAt: 12 })
    expect(p.workItems).toEqual([])
  })

  it('is undefined for an unknown item', () => {
    expect(projectItem(newSim('app_invoice'), live(), 'nope')).toBeUndefined()
  })
})
```

The second test is loose on purpose (which state a manual token lands in depends on the seed's distribution); if `n_capture` doesn't become a people step this way, replace the setup with any seed path that reaches a `user` node (see `engine.test.ts` "live mode") and assert `groupId` equals that node's `data.groupId`.

**Step 2: Run to verify they fail**

Run: `pnpm --filter @modus-bpm/core test -- project`
Expected: FAIL, cannot resolve `./project`.

**Step 3: Implement**

In `view.ts` rename `function toItem` to `export function workItemOf` and update its callers in that file (`grep -n "toItem(" packages/core/src/engine/view.ts`).

```ts
// packages/core/src/engine/project.ts
// Projections: the rows SQL storage keeps beside each application's state, so
// worklists and search (M3) can query items and open work without loading the
// whole state. Pure: the same function feeds the memory and Postgres adapters.

import { objectTitle } from '../model/format'
import type { Id, Priority } from '../model/types'
import { buildIndex } from './engine'
import type { Ctx, SimState, TokenState } from './state'
import { workItemOf } from './view'

export interface ItemRow {
  itemId: Id
  number: string
  title: string
  status: 'active' | 'completed' | 'rejected' | 'cancelled'
  priority: Priority
  expedited: boolean
  /** Simulated minutes, like the audit trail. */
  dueAt?: number
  createdAt: number
  endedAt?: number
  data: Record<string, unknown>
}

/** One open thread of an item: where it is and who or what has it. */
export interface WorkItemRow {
  tokenId: Id
  itemId: Id
  stepId: Id
  state: TokenState
  assignee?: Id
  groupId?: Id
  serviceId?: Id
  enteredAt: number
  dueAt?: number
  priority: Priority
}

export interface ProjectedItem {
  item: ItemRow
  /** Every row the item has now; storage replaces the item's old rows with these. */
  workItems: WorkItemRow[]
}

export function projectItem(sim: SimState, ctx: Ctx, itemId: Id): ProjectedItem | undefined {
  const obj = sim.objects[itemId]
  if (!obj) return undefined
  const idx = buildIndex(ctx)
  const type = ctx.app.objectTypes.find((t) => t.id === obj.typeId)
  const item: ItemRow = {
    itemId: obj.id,
    number: obj.number,
    title: objectTitle(type, obj.data, ctx.app.lists, ctx.users),
    status: obj.status,
    priority: obj.priority,
    expedited: !!obj.expedite,
    dueAt: obj.dueBy,
    createdAt: obj.createdAt,
    endedAt: obj.status === 'active' ? undefined : obj.completedAt,
    data: obj.data,
  }
  const workItems = obj.tokens.map((t): WorkItemRow => {
    const wi = workItemOf(sim, idx, t)
    return {
      tokenId: t.id,
      itemId: obj.id,
      stepId: t.nodeId,
      state: t.state,
      assignee: t.userId,
      groupId: wi?.step.groupId,
      serviceId: t.serviceId,
      enteredAt: t.enteredAt,
      dueAt: wi?.due ?? obj.dueBy,
      priority: obj.priority,
    }
  })
  return { item, workItems }
}
```

Check `obj.completedAt` is set for rejected/cancelled too (`grep -n "completedAt =" packages/core/src/engine/engine.ts`); if it's only set on completion, use the item's last history entry's `at` for `endedAt`.

**Step 4: Run tests**

Run: `pnpm --filter @modus-bpm/core test -- project` → PASS. Then `pnpm --filter @modus-bpm/core test` and `pnpm --filter @modus-bpm/core typecheck` → all PASS.

**Step 5: Commit**

```bash
git add packages/core/src/engine/project.ts packages/core/src/engine/project.test.ts packages/core/src/engine/view.ts packages/core/src/index.ts
git commit -m "core: projectItem — item and work-item rows for SQL projections"
```

---

### Task 2: `changesBetween` in core (new entries, touched items, outbox)

**Files:**
- Modify: `packages/core/src/engine/project.ts`
- Modify: `packages/core/src/engine/project.test.ts`

**Step 1: Write the failing tests**

```ts
import { changesBetween } from './project'
import { failJob, pollJobs } from './engine'

describe('changesBetween', () => {
  it('reports a new item’s entries, the item as touched, and its job as ready', () => {
    const ctx = live()
    const before = newSim('app_invoice')
    const after = structuredClone(before)
    const o = createObject(after, ctx, 'w_invoice', { f_invno: 'C-1' }, 'u_maya')!
    const c = changesBetween(before, after)
    expect(c.itemIds).toEqual([o.id])
    expect(c.entries).toEqual([{ itemId: o.id, itemNumber: o.number, entries: o.history }])
    expect(c.outbox).toEqual([{ itemId: o.id, kind: 'job.ready', payload: { tokenId: o.tokens[0]!.id, serviceId: 'svc_erp', nodeId: 'n_capture', attempt: 1 } }])
  })

  it('reports only what changed, and a retry as a new job', () => {
    const ctx = live()
    const sim = newSim('app_invoice')
    const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'C-2' }, 'u_maya')!
    createObject(sim, ctx, 'w_invoice', { f_invno: 'C-3' }, 'u_maya')
    const [job] = pollJobs(sim, ctx, 'svc_erp', 'w1')
    const before = structuredClone(sim)
    failJob(sim, ctx, job!.id, 'timed out')
    const c = changesBetween(before, sim)
    expect(c.itemIds).toEqual([o.id])
    expect(c.entries[0]!.entries).toEqual(o.history.slice(before.objects[o.id]!.history.length))
    expect(c.outbox).toEqual([expect.objectContaining({ kind: 'job.ready', payload: expect.objectContaining({ attempt: 2 }) })])
  })

  it('turns notify and escalated entries into notify messages', () => {
    const before = newSim('app_invoice')
    const ctx = live()
    createObject(before, ctx, 'w_invoice', { f_invno: 'C-4' }, 'u_maya')
    const after = structuredClone(before)
    const o = Object.values(after.objects)[0]!
    o.history.push({ at: 5, kind: 'notify', nodeId: 'n_x', text: 'Email to someone' }, { at: 6, kind: 'escalated', nodeId: 'n_x', tokenId: 't1', text: 'Escalated' })
    const c = changesBetween(before, after)
    expect(c.outbox).toEqual([
      { itemId: o.id, kind: 'notify', payload: { at: 5, kind: 'notify', nodeId: 'n_x', text: 'Email to someone' } },
      { itemId: o.id, kind: 'notify', payload: { at: 6, kind: 'escalated', nodeId: 'n_x', tokenId: 't1', text: 'Escalated' } },
    ])
  })

  it('counts a token that moved without an audit entry as a touch', () => {
    const ctx = live()
    const before = newSim('app_invoice')
    const o = createObject(before, ctx, 'w_invoice', { f_invno: 'C-5' }, 'u_maya')!
    const after = structuredClone(before)
    after.objects[o.id]!.tokens[0]!.state = 'queued'
    expect(changesBetween(before, after).itemIds).toEqual([o.id])
    expect(changesBetween(before, structuredClone(before)).itemIds).toEqual([])
  })
})
```

**Step 2: Run to verify they fail**

Run: `pnpm --filter @modus-bpm/core test -- project` → FAIL, `changesBetween` not exported.

**Step 3: Implement** (append to `project.ts`)

```ts
import type { AuditEntry, SimObject, Token } from './state'

export interface OutboxMessage {
  itemId: Id
  /** `job.ready`: a worker can take this call. `notify`: someone should hear about this entry. */
  kind: 'job.ready' | 'notify'
  payload: Record<string, unknown>
}

export interface Changes {
  /** Items whose projection rows must be rewritten, in id order. */
  itemIds: Id[]
  /** Audit entries added per item, oldest first. */
  entries: Array<{ itemId: Id; itemNumber: string; entries: AuditEntry[] }>
  outbox: OutboxMessage[]
}

const jobKey = (t: Token) => `${t.id}#${t.nodeId}#${t.attempt ?? 1}`
const isJob = (t: Token) => t.state === 'auto' && !!t.serviceId && !t.manual
/** What projections show of a token; any difference means the item's rows change. */
const tokenSig = (o: SimObject) => o.tokens.map((t) => `${t.id}|${t.nodeId}|${t.state}|${t.userId ?? ''}|${t.serviceId ?? ''}|${t.enteredAt}`).join(',')

/** What a command changed: the audit entries to log, the items to re-project, and messages for the outbox. */
export function changesBetween(before: SimState, after: SimState): Changes {
  const out: Changes = { itemIds: [], entries: [], outbox: [] }
  const ids = new Set<Id>([...after.activeIds, ...before.activeIds])
  for (const [id, o] of Object.entries(after.objects)) if (o.history.length !== (before.objects[id]?.history.length ?? 0)) ids.add(id)
  for (const id of [...ids].sort()) {
    const now = after.objects[id]
    if (!now) continue
    const was = before.objects[id]
    const added = now.history.slice(was?.history.length ?? 0)
    const ready = new Set((was?.tokens ?? []).filter(isJob).map(jobKey))
    const jobs = now.tokens.filter((t) => isJob(t) && !ready.has(jobKey(t)))
    const moved = !was || added.length > 0 || tokenSig(was) !== tokenSig(now) || was.status !== now.status || was.priority !== now.priority
    if (!moved) continue
    out.itemIds.push(id)
    if (added.length) out.entries.push({ itemId: id, itemNumber: now.number, entries: added })
    for (const t of jobs) out.outbox.push({ itemId: id, kind: 'job.ready', payload: { tokenId: t.id, serviceId: t.serviceId, nodeId: t.nodeId, attempt: t.attempt ?? 1 } })
    for (const e of added) if (e.kind === 'notify' || e.kind === 'escalated') out.outbox.push({ itemId: id, kind: 'notify', payload: { ...e } })
  }
  return out
}
```

Notes for the implementer: field edits write a `field` audit entry, so `data` changes are caught by `added`; `activeIds` from both sides catches items that just finished. If a test shows a projected field changing with no entry and no token change, add it to the `moved` check, not a deep compare of the whole object.

**Step 4: Run tests** → `pnpm --filter @modus-bpm/core test` and `typecheck` PASS.

**Step 5: Commit** — `core: changesBetween — new audit entries, touched items and outbox messages per command`

---

### Task 3: New storage ports (added beside the old ones)

**Files:**
- Modify: `apps/server/src/ports.ts`

No test of its own (types only); Tasks 4–6 test it.

Add, keeping `StateStore.save`, `EventLog.append` and `positions` until Task 9 so everything still compiles:

```ts
import type { AuditEntry, Design, Id, OutboxMessage, ProjectedItem, SimState } from '@modus-bpm/core'

/** What storage holds for an application when a transaction starts. */
export interface Stored {
  /** 0: nothing stored yet. Bumped by every commit. */
  version: number
  /** Present only when `version` differs from the caller's `known` version (or on `load`). */
  state?: SimState
  /** Wall time (epoch ms) the stored clock corresponds to. Absent: never ticked. */
  tickedAt?: number
}

/** Everything one command changed, written together or not at all. */
export interface Write {
  state: SimState
  /** New audit entries per item; storage numbers them after the item's last logged position. */
  entries: Array<{ itemId: Id; itemNumber: string; entries: AuditEntry[] }>
  /** Replace these items' projection rows (and all their work-item rows). */
  items: ProjectedItem[]
  outbox: OutboxMessage[]
  tickedAt: number
}

/** The work done inside a transaction: its result, and what to write (absent: roll back). */
export interface Work<T> {
  value: T
  write?: Write
}

/** Another writer (or this one) committed a change. */
export interface ChangeNotice {
  appId: Id
  version: number
  /** Touched items; absent when there were too many to send. */
  itemIds?: Id[]
}

/** The row lock wasn't granted in time: another replica is busy with this application. */
export class StorageBusy extends Error {}

/** Read side of the projections (M3 worklists and search build on this). */
export interface Projections {
  item(appId: Id, itemId: Id): Promise<ProjectedItem['item'] | undefined>
  workItems(appId: Id, itemId?: Id): Promise<ProjectedItem['workItems']>
  /** Unsent outbox messages, oldest first. */
  outbox(appId: Id): Promise<Array<OutboxMessage & { id: number }>>
  /** True when the application has any projected item (startup backfill checks this). */
  any(appId: Id): Promise<boolean>
}
```

Change `StateStore.load` to return `Promise<Stored | undefined>`? **No, not yet** — add a new method so old callers still compile:

```ts
export interface StateStore {
  load(appId: Id): Promise<SimState | undefined>
  save(appId: Id, state: SimState): Promise<void>
  /** Version, clock time and state as stored (undefined: never written). */
  get(appId: Id): Promise<Stored | undefined>
}
```

And on `Storage`:

```ts
  projections: Projections
  /**
   * Run `work` holding the application's lock, and commit what it returns in one transaction:
   * state (version + 1), audit entries, projections, outbox, and a change notice to every
   * listener. Throws StorageBusy when the lock isn't granted within 5 s; any other failure
   * rolls everything back and rethrows.
   */
  transact<T>(appId: Id, known: number, work: (stored: Stored) => Work<T> | Promise<Work<T>>): Promise<{ value: T; version: number; committed: boolean }>
  /** Hear every committed change, this process's included. Returns a stop function. */
  listen(onChange: (n: ChangeNotice) => void, onReconnect?: () => void): Promise<() => Promise<void>>
  /** Become (or stay) the one ticker for this application's clock. */
  tryClock(appId: Id, owner: string): Promise<boolean>
  /** Give up every clock this owner holds. */
  releaseClocks(owner: string): Promise<void>
```

Export `OutboxMessage`, `ProjectedItem` from core (Task 1–2 already did via `index.ts`).

Run `pnpm --filter @modus-bpm/server typecheck` → FAILS (adapters lack the new members). That's expected; Task 4 and 6 fix it. Don't commit this task alone; commit it with Task 4.

---

### Task 4: Memory adapter `transact`, projections, listen, clock

**Files:**
- Modify: `apps/server/src/adapters/memory.ts`
- Modify: `apps/server/src/adapters/storage.contract.ts`
- Stub in: `apps/server/src/adapters/postgres.ts` (throwing stubs, replaced in Task 6)

**Step 1: Write the failing contract tests** (add inside `storageContract`; keep the existing ones for now)

```ts
import { changesBetween, projectItem } from '@modus-bpm/core'
import type { Ctx, SimState } from '@modus-bpm/core'
import type { Storage, Write } from '../ports'

function ctxOf(design = seedDesign(), appId = 'app_invoice'): Ctx {
  return { app: design.apps.find((a) => a.id === appId)!, users: design.users, groups: design.groups, services: design.services, live: true }
}

/** A command as the runtime will run it: on a copy, committing whatever changed. */
function writeFor(before: SimState, after: SimState, ctx: Ctx, tickedAt = 0): Write {
  const c = changesBetween(before, after)
  return { state: after, entries: c.entries, items: c.itemIds.map((id) => projectItem(after, ctx, id)!), outbox: c.outbox.map((m) => m), tickedAt }
}

it('commits state, audit entries, projections and outbox together, bumping the version', async () => {
  const s = await create()
  const ctx = ctxOf()
  const before = newSim('app_invoice', 1)
  const r = await s.transact('app_invoice', 0, (stored) => {
    expect(stored).toEqual({ version: 0 })
    const after = structuredClone(before)
    const o = createObject(after, ctx, 'w_invoice', { f_invno: 'T-1' }, 'u_maya')!
    return { value: o, write: writeFor(before, after, ctx, 1000) }
  })
  expect(r).toMatchObject({ version: 1, committed: true })
  const o = r.value
  const again = await reopen()
  expect(await again.state.get('app_invoice')).toMatchObject({ version: 1, tickedAt: 1000 })
  const logged = await again.events.read({ itemId: o.id })
  expect(logged.map((e) => e.seq)).toEqual(o.history.map((_, i) => i + 1))
  expect(await again.projections.item('app_invoice', o.id)).toMatchObject({ number: o.number, status: 'active', title: expect.any(String) })
  expect((await again.projections.workItems('app_invoice', o.id)).map((w) => w.state)).toEqual(['auto'])
  expect((await again.projections.outbox('app_invoice')).map((m) => m.kind)).toEqual(['job.ready'])
})

it('writes nothing when the work throws, or returns no write', async () => {
  const s = await create()
  await expect(s.transact('app_x', 0, () => { throw new Error('boom') })).rejects.toThrow('boom')
  expect(await s.transact('app_x', 0, () => ({ value: 7 }))).toEqual({ value: 7, version: 0, committed: false })
  expect(await s.state.get('app_x')).toBeUndefined()
  expect(await s.events.read({})).toEqual([])
  expect(await s.projections.outbox('app_x')).toEqual([])
})

it('hands back the stored state only when the caller’s version is stale', async () => {
  const s = await create()
  const sim = newSim('app_a', 1)
  await s.transact('app_a', 0, () => ({ value: 0, write: { state: sim, entries: [], items: [], outbox: [], tickedAt: 5 } }))
  await s.transact('app_a', 1, (stored) => {
    expect(stored).toEqual({ version: 1, tickedAt: 5 })
    return { value: 0 }
  })
  await s.transact('app_a', 0, (stored) => {
    expect(stored.state).toEqual(JSON.parse(JSON.stringify(sim)))
    return { value: 0 }
  })
})

it('numbers new entries after what the log already holds for the item', async () => {
  const s = await create()
  const entry = (text: string) => ({ at: 1, kind: 'note', text }) as never
  const commit = (version: number, texts: string[]) =>
    s.transact('app_a', version, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [{ itemId: 'i1', itemNumber: 'A-1', entries: texts.map(entry) }], items: [], outbox: [], tickedAt: 0 } }))
  await commit(0, ['a', 'b'])
  await commit(1, ['c'])
  expect((await s.events.read({ itemId: 'i1' })).map((e) => `${e.seq}:${e.text}`)).toEqual(['1:a', '2:b', '3:c'])
})

it('replaces an item’s work-item rows, dropping tokens that left', async () => {
  const s = await create()
  const ctx = ctxOf()
  const sim = newSim('app_invoice', 1)
  const o = createObject(sim, ctx, 'w_invoice', { f_invno: 'T-2' }, 'u_maya')!
  const write = (version: number) => s.transact('app_invoice', version, () => ({ value: 0, write: { state: sim, entries: [], items: [projectItem(sim, ctx, o.id)!], outbox: [], tickedAt: 0 } }))
  await write(0)
  o.tokens = []
  o.status = 'cancelled'
  await write(1)
  expect(await s.projections.workItems('app_invoice', o.id)).toEqual([])
  expect((await s.projections.item('app_invoice', o.id))?.status).toBe('cancelled')
  expect(await s.projections.any('app_invoice')).toBe(true)
  expect(await s.projections.any('app_none')).toBe(false)
})

it('tells listeners about each commit', async () => {
  const s = await create()
  const heard: unknown[] = []
  const stop = await s.listen((n) => heard.push(n))
  await s.transact('app_a', 0, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
  await vi.waitFor(() => expect(heard).toEqual([{ appId: 'app_a', version: 1, itemIds: [] }]))
  await stop()
})

it('gives one owner the clock until it lets go', async () => {
  const s = await create()
  expect(await s.tryClock('app_a', 'one')).toBe(true)
  expect(await s.tryClock('app_a', 'one')).toBe(true)
  await s.releaseClocks('one')
  expect(await s.tryClock('app_a', 'two')).toBe(true)
})
```

(`vi` comes from `vitest`. The clock test is one-owner only here; the two-owner case runs in Task 11 where Postgres needs a second connection.)

**Step 2: Run** `pnpm --filter @modus-bpm/server test -- storage` → the new memory tests FAIL (`transact` is not a function). Postgres is skipped without `TEST_DATABASE_URL`.

**Step 3: Implement in `memory.ts`**

- Hold per app: `{ version, tickedAt?, state? }` (state stored as `structuredClone` on commit; `get`/`transact` hand out clones so the runtime can't mutate storage).
- Per-app mutex: `const locks = new Map<Id, Promise<unknown>>()`; `transact` chains onto `locks.get(appId)`.
- `transact`: `await history`; build `stored = { version, tickedAt }` plus `state: clone` when `version !== known && version > 0`; `const out = await work(stored)`; if no `out.write` return `{ value, version, committed: false }`. Otherwise:
  - number entries per item from `lastSeq` (already in the file) and push to `events`;
  - set `items` map (`${appId}:${itemId}` → item row with `version`), replace `workItems` for each written item;
  - push outbox with an incrementing id;
  - set version + 1, tickedAt, state clone;
  - persist when `dataDir`: write `state-<app>.json` as today **and** `meta-<app>.json` with `{ version, tickedAt }` (atomic), then append to `events.jsonl`. Projections and outbox stay in memory (rebuilt by backfill at startup, Task 8).
  - emit `{ appId, version, itemIds }` to listeners with `queueMicrotask` (after the lock is released, like NOTIFY after COMMIT).
- `state.get(appId)`: from memory, else from `state-<app>.json` + `meta-<app>.json` (missing meta: `{ version: 1 }` when a state file exists, so a legacy data directory loads).
- `listen`: add to a `Set`; return a function that removes it. `onReconnect` is never called.
- `tryClock(appId, owner)`: a `Map<Id, string>`; true when free or already `owner`'s. `releaseClocks(owner)` deletes that owner's entries.

In `postgres.ts` add stubs so the server typechecks: each new member `throw new Error('not yet')` / `projections` with throwing methods. Task 6 replaces them.

**Step 4: Run** `pnpm --filter @modus-bpm/server test` → PASS (memory), `pnpm --filter @modus-bpm/server typecheck` → PASS.

**Step 5: Commit** `ports.ts`, `memory.ts`, `postgres.ts`, `storage.contract.ts`: `server: Storage.transact — state, audit, projections and outbox committed together (memory adapter)`

---

### Task 5: Migration `0002_projections`

**Files:**
- Modify: `apps/server/src/adapters/postgres.ts` (`Tables`, `migrations`)
- Modify: `apps/server/src/adapters/storage.test.ts` (migration list expectation)

**Step 1: Failing test** — in `storage.test.ts` "migrates once…" change the expectation to `['0001_storage', '0002_projections']`, and add:

```ts
it('adds version and clock columns, and the projection and outbox tables', async () => {
  const schema = await fresh()
  const s = postgresStorage(url!, { schema })
  await s.migrate()
  const { rows } = await admin.query(`select table_name, column_name from information_schema.columns where table_schema = $1 order by 1, 2`, [schema])
  const cols = rows.map((r) => `${r.table_name}.${r.column_name}`)
  expect(cols).toEqual(expect.arrayContaining(['app_state.version', 'app_state.ticked_at', 'item.data', 'work_item.token_id', 'outbox.sent_at']))
  await s.close()
  await drop(schema)
})
```

**Step 2: Run** with Postgres up: `TEST_DATABASE_URL=... pnpm --filter @modus-bpm/server test:pg` → FAIL.

**Step 3: Implement** — add to `migrations` (never touch `0001`):

```ts
'0002_projections': {
  async up(db) {
    await db.schema
      .alterTable('app_state')
      .addColumn('version', 'bigint', (c) => c.notNull().defaultTo(0))
      .addColumn('ticked_at', 'timestamptz')
      .execute()
    // A row is created (version 0, no state) to have something to lock before an application's first commit.
    await db.schema.alterTable('app_state').alterColumn('state', (c) => c.dropNotNull()).execute()
    // Existing rows already hold state: count them as committed once.
    await sql`update app_state set version = 1 where state is not null`.execute(db)
    await db.schema
      .createTable('item')
      .addColumn('app_id', 'text', (c) => c.notNull())
      .addColumn('item_id', 'text', (c) => c.notNull())
      .addColumn('number', 'text', (c) => c.notNull())
      .addColumn('title', 'text', (c) => c.notNull())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('priority', 'text', (c) => c.notNull())
      .addColumn('expedited', 'boolean', (c) => c.notNull())
      .addColumn('due_at', 'double precision')
      .addColumn('created_at', 'double precision', (c) => c.notNull())
      .addColumn('ended_at', 'double precision')
      .addColumn('version', 'bigint', (c) => c.notNull())
      .addColumn('data', 'jsonb', (c) => c.notNull())
      .addPrimaryKeyConstraint('item_pk', ['app_id', 'item_id'])
      .execute()
    await db.schema.createIndex('item_number').on('item').columns(['app_id', 'number']).execute()
    await db.schema.createIndex('item_status').on('item').columns(['app_id', 'status']).execute()
    await db.schema
      .createTable('work_item')
      .addColumn('app_id', 'text', (c) => c.notNull())
      .addColumn('token_id', 'text', (c) => c.notNull())
      .addColumn('item_id', 'text', (c) => c.notNull())
      .addColumn('step_id', 'text', (c) => c.notNull())
      .addColumn('state', 'text', (c) => c.notNull())
      .addColumn('assignee', 'text')
      .addColumn('group_id', 'text')
      .addColumn('service_id', 'text')
      .addColumn('entered_at', 'double precision', (c) => c.notNull())
      .addColumn('due_at', 'double precision')
      .addColumn('priority', 'text', (c) => c.notNull())
      .addPrimaryKeyConstraint('work_item_pk', ['app_id', 'token_id'])
      .execute()
    await db.schema.createIndex('work_item_item').on('work_item').columns(['app_id', 'item_id']).execute()
    await db.schema.createIndex('work_item_assignee').on('work_item').columns(['app_id', 'assignee']).execute()
    await db.schema.createIndex('work_item_step').on('work_item').columns(['app_id', 'step_id', 'state']).execute()
    await db.schema
      .createTable('outbox')
      .addColumn('id', 'bigserial', (c) => c.primaryKey())
      .addColumn('app_id', 'text', (c) => c.notNull())
      .addColumn('item_id', 'text', (c) => c.notNull())
      .addColumn('kind', 'text', (c) => c.notNull())
      .addColumn('payload', 'jsonb', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
      .addColumn('sent_at', 'timestamptz')
      .execute()
    // The M4 dispatcher's queue: unsent rows in order.
    await sql`create index outbox_unsent on outbox (id) where sent_at is null`.execute(db)
  },
  async down(db) {
    for (const t of ['outbox', 'work_item', 'item']) await db.schema.dropTable(t).execute()
    await db.schema.alterTable('app_state').dropColumn('ticked_at').dropColumn('version').execute()
  },
},
```

Update `Tables` with `item`, `work_item`, `outbox` and `app_state: { app_id; state: SimState | null; version: Generated<string>; ticked_at: Date | null; updated_at }` (`bigint` comes back as a string from node-postgres).

**Step 4: Run** `test:pg` → PASS (the transact contract tests still fail on Postgres — that's Task 6; run only this file's "postgres specifics" with `-t "postgres specifics"` if you want a clean run).

**Step 5: Commit** — `server: migration 0002 — app_state version and clock, item, work_item and outbox tables`

---

### Task 6: Postgres `transact`, `get`, `projections`

**Files:**
- Modify: `apps/server/src/adapters/postgres.ts`

The contract tests from Task 4 are the failing tests. Run `test:pg` → the Postgres copies FAIL with "not yet".

**Implement:**

```ts
/** Thrown inside a Kysely transaction to roll it back while still returning a value. */
class Rollback<T> { constructor(readonly value: T, readonly version: number) {} }

async transact(appId, known, work) {
  try {
    return await db.transaction().execute(async (tx) => {
      await sql`set local lock_timeout = '5s'`.execute(tx)
      await tx.insertInto('app_state').values({ app_id: appId, state: null }).onConflict((oc) => oc.column('app_id').doNothing()).execute()
      const { rows } = await sql<{ version: string; ticked_at: Date | null; state: SimState | null }>`
        select version, ticked_at, case when version <> ${known} then state end as state
        from app_state where app_id = ${appId} for update`.execute(tx)
      const row = rows[0]!
      const version = Number(row.version)
      const stored: Stored = { version }
      if (row.ticked_at) stored.tickedAt = row.ticked_at.getTime()
      if (row.state && version > 0) stored.state = row.state
      const out = await work(stored)
      if (!out.write) throw new Rollback(out.value, version)
      const next = version + 1
      const w = out.write
      await tx.updateTable('app_state').set({ state: json(w.state), version: String(next), ticked_at: new Date(w.tickedAt), updated_at: sql`now()` }).where('app_id', '=', appId).execute()
      await appendEntries(tx, appId, w.entries)
      await writeItems(tx, appId, next, w.items)
      if (w.outbox.length) await tx.insertInto('outbox').values(w.outbox.map((m) => ({ app_id: appId, item_id: m.itemId, kind: m.kind, payload: json(m.payload) }))).execute()
      const itemIds = w.items.map((p) => p.item.itemId)
      const notice: ChangeNotice = { appId, version: next, ...(itemIds.length <= 200 ? { itemIds } : {}) }
      // Delivered on commit; payloads must stay under 8000 bytes (hence the 200-item cap).
      await sql`select pg_notify('modus_change', ${JSON.stringify(notice)})`.execute(tx)
      return { value: out.value, version: next, committed: true }
    })
  } catch (err) {
    if (err instanceof Rollback) return { value: err.value, version: err.version, committed: false }
    if ((err as { code?: string }).code === '55P03') throw new StorageBusy('Another server is busy with this application. Try again shortly.')
    throw err
  }
}
```

- `appendEntries`: `select item_id, max(seq) from event where app_id = $1 and item_id = any($2) group by item_id`, number each item's entries from there, insert in `CHUNK`s. A unique-constraint violation (`23505`) rethrows as `new Error('Event log conflict: ...')` — it can only mean the lock was bypassed.
- `writeItems`: one `insert into item ... on conflict (app_id, item_id) do update set ...` (chunked), then `delete from work_item where app_id = $1 and item_id = any($2)`, then insert all the items' work rows (chunked). Map camelCase → snake_case; `undefined` → `null`.
- `state.get`: `select version, ticked_at, state from app_state where app_id = $1`; undefined when no row or `version = 0`.
- `projections`: straightforward selects mapping back to `ItemRow` / `WorkItemRow` (`null` → omitted key, `Number()` on doubles is not needed; `bigint` id → `Number(id)`); `outbox` orders by `id` with `sent_at is null`; `any` is `select 1 from item where app_id = $1 limit 1`.

Leave `listen`/`tryClock`/`releaseClocks` stubs for Task 7.

**Run** `test:pg` → all contract tests PASS except the listen and clock ones. **Commit** — `server: Postgres transact — one transaction per command under the application's row lock`

---

### Task 7: Postgres `listen` and clock lock

**Files:**
- Modify: `apps/server/src/adapters/postgres.ts`

One dedicated `pg.Client` (not from the pool) per storage, opened lazily by `listen` or `tryClock`:

```ts
let session: pg.Client | undefined
let opening: Promise<pg.Client> | undefined
const held = new Set<Id>()
const changeHandlers = new Set<(n: ChangeNotice) => void>()
const reconnectHandlers = new Set<() => void>()

async function dedicated(): Promise<pg.Client> {
  if (session) return session
  return (opening ??= (async () => {
    const c = new pg.Client({ connectionString, options: schema ? `-c search_path=${schema}` : undefined })
    c.on('notification', (m) => {
      if (m.channel !== 'modus_change' || !m.payload) return
      const n = JSON.parse(m.payload) as ChangeNotice
      for (const h of changeHandlers) h(n)
    })
    c.on('error', () => drop(c))
    c.on('end', () => drop(c))
    await c.connect()
    await c.query('listen modus_change')
    session = c
    opening = undefined
    return c
  })().catch((err) => { opening = undefined; throw err }))
}

function drop(c: pg.Client) {
  if (session !== c) return
  session = undefined
  // Advisory locks die with the connection.
  held.clear()
  // Reconnect in the background; listeners reload what they may have missed.
  setTimeout(() => dedicated().then(() => { for (const h of reconnectHandlers) h() }, () => drop(c)), 1000).unref()
}
```

Careful with the retry loop in `drop`: after a failed reconnect `session` is already undefined, so make the retry its own function (`reconnect()` that reschedules itself with backoff up to 30 s) rather than calling `drop` again. Stop retrying once `close()` has been called (a `closed` flag).

- `listen(onChange, onReconnect)`: add handlers, `await dedicated()`, return a stop function that removes them.
- `tryClock(appId)`: if `held.has(appId)` return true (advisory locks are reentrant and counted — don't take it twice). Otherwise `select pg_try_advisory_lock(hashtext('modus-clock:' || $1)) as ok` on the session; on true add to `held`. Any error → return false.
- `releaseClocks()`: `select pg_advisory_unlock_all()` on the session if open; clear `held`.
- `close()`: set `closed`, end the session, destroy the pool.

**Test** (`storage.test.ts`, "postgres specifics"):

```ts
it('lets one connection hold an application’s clock, and frees it when that connection closes', async () => {
  const a = postgresStorage(url!, { schema: own })
  const b = postgresStorage(url!, { schema: own })
  expect(await a.tryClock('app_a', 'a')).toBe(true)
  expect(await a.tryClock('app_a', 'a')).toBe(true)
  expect(await b.tryClock('app_a', 'b')).toBe(false)
  await a.close()
  expect(await b.tryClock('app_a', 'b')).toBe(true)
  await b.close()
})

it('delivers a commit on one connection to listeners on another', async () => {
  const a = postgresStorage(url!, { schema: own })
  const b = postgresStorage(url!, { schema: own })
  const heard: ChangeNotice[] = []
  await b.listen((n) => heard.push(n))
  await a.transact('app_n', 0, () => ({ value: 0, write: { state: newSim('app_n', 1), entries: [], items: [], outbox: [], tickedAt: 0 } }))
  await vi.waitFor(() => expect(heard).toEqual([{ appId: 'app_n', version: 1, itemIds: [] }]))
  await a.close()
  await b.close()
})
```

Note: `NOTIFY` is database-wide, not per schema. Test schemas can hear each other's notices; filter by `appId` in tests (use app ids unique to the test, as above) — and in production one database is one install.

**Run** `test:pg` → all PASS. **Commit** — `server: Postgres LISTEN for other replicas' changes, and an advisory lock for each application's clock`

---

### Task 8: Runtime on `transact`

**Files:**
- Modify (rewrite most of): `apps/server/src/runtime.ts`
- Modify (rewrite): `apps/server/src/runtime.test.ts`
- Modify: `apps/server/src/main.ts` (`onError` kinds)

**Step 1: Failing tests** — replace `runtime.test.ts` (the two old tests cover the snapshot timer and log reconciliation, which go away):

```ts
import { createObject } from '@modus-bpm/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './adapters/memory'
import { StorageBusy } from './ports'
import { Runtime, StorageUnavailable } from './runtime'

const make = (rt: Runtime, n: string, by = 'u_maya') => rt.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: n }, by))
const numbers = (rt: Runtime) => rt.read('app_invoice', (sim) => Object.values(sim.objects).map((o) => o.data.f_invno))

describe('runtime', () => {
  afterEach(() => vi.useRealTimers())

  it('commits each command, and changes nothing in memory when storage refuses it', async () => {
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage })
    await make(rt, 'OK-1')
    expect((await storage.state.get('app_invoice'))?.version).toBe(1)

    const transact = storage.transact
    storage.transact = () => Promise.reject(new Error('database unreachable'))
    await expect(make(rt, 'LOST')).rejects.toBeInstanceOf(StorageUnavailable)
    storage.transact = () => Promise.reject(new StorageBusy('busy'))
    await expect(make(rt, 'BUSY')).rejects.toThrow(/busy/i)
    expect(await numbers(rt)).toEqual(['OK-1'])

    storage.transact = transact
    await make(rt, 'OK-2')
    expect(await numbers(rt)).toEqual(['OK-1', 'OK-2'])
    await rt.stop()
  })

  it('lets an error thrown by the command itself through, unchanged, with nothing written', async () => {
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage })
    await expect(rt.run('app_invoice', (sim, ctx) => { createObject(sim, ctx, 'w_invoice', { f_invno: 'HALF' }, 'u_maya'); throw new TypeError('bad') })).rejects.toBeInstanceOf(TypeError)
    expect(await numbers(rt)).toEqual([])
    expect(await storage.state.get('app_invoice')).toBeUndefined()
    await rt.stop()
  })

  it('moves the clock by wall time on every command, from the stored clock time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const storage = memoryStorage()
    const rt = await Runtime.create({ storage, timeScale: 60 })
    await make(rt, 'C-1')
    const at = await rt.read('app_invoice', (sim) => sim.clock)
    vi.setSystemTime(Date.now() + 60_000)
    await make(rt, 'C-2')
    expect(await rt.read('app_invoice', (sim) => sim.clock)).toBeCloseTo(at + 60)
    await rt.stop()
  })

  it('backfills projections for state stored before they existed', async () => {
    const storage = memoryStorage()
    const first = await Runtime.create({ storage })
    const o = await make(first, 'OLD')
    await first.stop()
    // Simulate a store from before projections: same state, no rows.
    const bare = memoryStorage()
    const state = (await storage.state.get('app_invoice'))!.state!
    await bare.transact('app_invoice', 0, () => ({ value: 0, write: { state, entries: [], items: [], outbox: [], tickedAt: Date.now() } }))
    await bare.designs.save(first.design)
    const second = await Runtime.create({ storage: bare })
    expect(await bare.projections.item('app_invoice', o!.id)).toMatchObject({ number: o!.number })
    await second.stop()
  })
})
```

**Step 2: Run** `pnpm --filter @modus-bpm/server test -- runtime` → FAIL.

**Step 3: Implement.** Shape of the new `Runtime` (keep `ctx`, `design`, `ready`, `checkStorage`, `subscribe`, `NotFound`, `StorageUnavailable`, the `Change` type):

```ts
interface Cached { version: number; sim: SimState }

export interface RuntimeOptions {
  storage: Storage
  timeScale?: number
  tickMs?: number
  seedIfEmpty?: boolean
  onError?: (err: unknown, during: 'tick' | 'listen') => void
}

private readonly cache = new Map<Id, Cached>()
private readonly queues = new Map<Id, Promise<unknown>>()
private readonly owner = randomUUID()           // node:crypto
private unlisten?: () => Promise<void>

static async create(options) {
  // design load / seed as today
  for (const app of rt.design.apps) {
    const stored = await storage.state.get(app.id)
    if (stored?.state) rt.cache.set(app.id, { version: stored.version, sim: stored.state })
    // Projections arrived after this state was first written: fill them in once.
    if (stored?.state && Object.keys(stored.state.objects).length && !(await storage.projections.any(app.id))) await rt.backfill(app.id)
  }
  rt.unlisten = await storage.listen((n) => rt.heard(n), () => rt.reloadAll())
  return rt
}
```

- `start()`: only the tick interval (no saver). `stop()`: `stopping = true`, clear interval, await all queues, `unlisten`, `storage.releaseClocks(owner)`.
- `state(appId)`: returns `cache.get(appId)?.sim`, else a fresh `newSim(appId, seed)` with `arrivals = false` stored in the cache with version 0 (as today, but versioned).
- `serial(appId, fn)`: per-app queue (`queues`), same pattern as today's `this.queue`, but keyed by app.
- `run(appId, fn)` → `this.command(appId, fn)`.
- `command(appId, fn, tick = false)`:

```ts
return this.serial(appId, async () => {
  const ctx = this.ctx(appId)
  const cached = this.cache.get(appId) ?? { version: 0, sim: this.state(appId) }
  let failed: { err: unknown } | undefined
  let sim!: SimState
  let itemIds: Id[] = []
  const now = Date.now()
  let r
  try {
    r = await this.opts.storage.transact(appId, cached.version, (stored) => {
      const before = stored.state ?? cached.sim
      sim = structuredClone(before)
      // Catch the clock up from when it was last moved, by whichever server.
      if (stored.tickedAt !== undefined) advance(sim, ctx, ((now - stored.tickedAt) / 60_000) * this.opts.timeScale)
      let value
      try {
        value = fn(sim, ctx)
      } catch (err) {
        failed = { err }
        throw err
      }
      const c = changesBetween(before, sim)
      itemIds = c.itemIds
      if (tick && !c.entries.length && stored.tickedAt !== undefined && now - stored.tickedAt < 30_000) return { value }
      return { value, write: { state: sim, entries: c.entries, items: c.itemIds.map((id) => projectItem(sim, ctx, id)!), outbox: c.outbox, tickedAt: now } }
    })
  } catch (err) {
    if (failed) throw failed.err
    if (err instanceof StorageBusy) throw new StorageUnavailable('Another server is busy with this application. Try again shortly.')
    throw new StorageUnavailable('Storage is unavailable, so the change wasn’t made. Try again shortly.')
  }
  if (r.committed) {
    this.cache.set(appId, { version: r.version, sim })
    this.emit({ appId, clock: sim.clock, itemIds })
  }
  return r.value
})
```

  When `stored.state` replaced a stale cache but the transaction didn't commit (an idle tick), still adopt `stored.state` with `stored.version` — capture it in the closure and set it after a non-committed result. A stored state with no `tickedAt` (migrated legacy row): don't advance; the commit sets `tickedAt`.

- `read(appId, fn)`: `serial(appId, () => fn(this.state(appId), this.ctx(appId)))`.
- `tick()`: for each app, `if (await storage.tryClock(app.id, owner)) await this.command(app.id, () => undefined, true)`; catch per app and report `onError(err, 'tick')`, continue with the next app.
- `heard(n)`: ignore unknown apps and `n.version <= cached version`; otherwise `serial(appId, ...)` → `storage.state.get(appId)`, re-check the version, set the cache, `emit({ appId, clock, itemIds: n.itemIds ?? Object.keys(state.objects) })`. Errors → `onError(err, 'listen')`.
- `reloadAll()`: `heard({ appId, version: Infinity })`-style for every app, but compare against `storage.state.get` (reload when stored version > cached).
- `backfill(appId)`: `transact(appId, cached.version, (stored) => { const sim = stored.state ?? cached.sim; return { value: undefined, write: { state: sim, entries: [], items: Object.keys(sim.objects).map((id) => projectItem(sim, ctx, id)!), outbox: [], tickedAt: stored.tickedAt ?? Date.now() } } })` and update the cache version.

Delete: `logged`, `offset`, `positions`, `dirty`, `saver`, `persist`, `flush`, `logBackoff`, `logRetryAt`, `lastTick`. Rewrite the header comment: commands run one at a time per application within a process and under the application's row lock across processes.

In `main.ts` the `onError` message stays as is (`${during} failed; retrying`).

**Step 4: Run** `pnpm --filter @modus-bpm/server test` → PASS (all files, including `server.test.ts`, `platform.test.ts`, `assistant.test.ts`, and `memory.test.ts`). If `memory.test.ts` "snapshots design and state" fails on file names, add `meta-app_invoice.json` to the expected list. Then `test:pg` and `typecheck`.

**Step 5: Commit** — `server: run every command in one storage transaction; drop the snapshot timer and log reconciliation`

---

### Task 9: Remove the old ports

**Files:**
- Modify: `apps/server/src/ports.ts`, `adapters/memory.ts`, `adapters/postgres.ts`, `adapters/storage.contract.ts`, `adapters/storage.test.ts`

- `StateStore`: keep only `get` (rename to `load`, returning `Stored | undefined`; update callers: `grep -rn "state.get\|state.load" apps/server/src`).
- `EventLog`: keep only `read`. Remove `append`, `positions`.
- Contract tests: delete "takes a batch sent again…", "says the highest position…", "refuses a batch that puts a different entry…"; rewrite "keeps each application's state separately…" and "appends events and reads them back…" and "filters by application and item…" to write through `transact` (a small helper `commitEntries(s, appId, version, entries)` in the contract file). Delete the Postgres-specific "keeps the first event at a position…" test.
- Update the `ports.ts` header and the `StateStore` doc comment (projections are real now).

Run `pnpm --filter @modus-bpm/server test`, `test:pg`, `pnpm typecheck` → PASS. **Commit** — `server: remove snapshot saves and direct log appends from the storage ports`

---

### Task 10: Worker polls don't lock idle applications

**Files:**
- Modify: `apps/server/src/http.ts:473-483`
- Test: `apps/server/src/server.test.ts` or `platform.test.ts` (wherever `/api/jobs/poll` is tested: `grep -n "jobs/poll" apps/server/src/*.test.ts`)

**Test:** spy on `storage.transact`, poll for a service with no open jobs, expect zero calls; create an invoice (job ready), poll, expect one job and transact called for that one application only.

**Implement:**

```ts
const open = await rt.read(a.id, (sim) => activeTokens(sim).some((t) => t.state === 'auto' && !t.manual && t.serviceId === b.serviceId && (t.leaseUntil === undefined || t.leaseUntil <= sim.clock)))
if (!open) continue
```

(`activeTokens` is exported from core.) Run tests → PASS. **Commit** — `server: skip applications with no open job before taking their lock on a worker poll`

---

### Task 11: Two replicas on one store

**Files:**
- Modify: `apps/server/src/adapters/storage.contract.ts` (add `peer()` to `ContractTarget`)
- Modify: `apps/server/src/adapters/storage.test.ts` (implement `peer`)

`peer()`: "another adapter over the same data, used at the same time (another replica)". Memory: return the instance `create()` made (a shared in-memory store). Postgres: `postgresStorage(url, { schema, max: 4 })` on the current schema, no migrate.

**Tests** (in the contract):

```ts
describe('two replicas', () => {
  it('lose no update across 50 interleaved commands, with unique numbers and gapless logs', async () => {
    const a = await Runtime.create({ storage: await create() })
    const b = await Runtime.create({ storage: await peer() })
    const runs = Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: `R-${i}` }, 'u_maya')!.id))
    const ids = await Promise.all(runs)
    expect(new Set(ids).size).toBe(50)
    const storage = await reopen()
    const stored = (await storage.state.load('app_invoice'))!.state!
    const objs = Object.values(stored.objects)
    expect(objs).toHaveLength(50)
    expect(new Set(objs.map((o) => o.number)).size).toBe(50)
    for (const o of objs) {
      const log = await storage.events.read({ itemId: o.id, limit: 1000 })
      expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1))
    }
    await a.stop(); await b.stop()
  })

  it('shows one replica’s change to the other’s subscribers', async () => {
    const a = await Runtime.create({ storage: await create() })
    const b = await Runtime.create({ storage: await peer() })
    const seen: string[][] = []
    b.subscribe((c) => seen.push(c.itemIds))
    const id = await a.run('app_invoice', (sim, ctx) => createObject(sim, ctx, 'w_invoice', { f_invno: 'SEEN' }, 'u_maya')!.id)
    await vi.waitFor(() => expect(seen.flat()).toContain(id))
    expect(await b.read('app_invoice', (sim) => !!sim.objects[id])).toBe(true)
    await a.stop(); await b.stop()
  })

  it('count ten minutes of wall time once, whoever moves the clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const a = await Runtime.create({ storage: await create(), timeScale: 2 })
      const b = await Runtime.create({ storage: await peer(), timeScale: 2 })
      await a.tick()
      const start = await a.read('app_invoice', (s) => s.clock)
      vi.setSystemTime(Date.now() + 5 * 60_000)
      await b.run('app_invoice', () => undefined)
      vi.setSystemTime(Date.now() + 5 * 60_000)
      await a.tick()
      expect(await a.read('app_invoice', (s) => s.clock)).toBeCloseTo(start + 20)
      await a.stop(); await b.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves ticking to the other replica when the ticker stops', async () => {
    const sa = await create()
    const sb = await peer()
    const a = await Runtime.create({ storage: sa })
    const b = await Runtime.create({ storage: sb })
    expect(await sa.tryClock('app_invoice', 'x-a')).toBe(true)
    expect(await sb.tryClock('app_invoice', 'x-b')).toBe(false)
    await sa.releaseClocks('x-a')
    await a.stop()
    expect(await sb.tryClock('app_invoice', 'x-b')).toBe(true)
    await b.stop()
  })
})
```

For the "ticker stops" test on Postgres, closing `sa` (done by `afterEach`, or call `sa.close()` explicitly before the last `expect`) is what really frees the lock; for memory `releaseClocks` does. Use `sa.close?.()` after `a.stop()` so both paths are exercised, and don't double-close in `afterEach` (make `close` idempotent in both adapters).

Note the `peer()` storage must also be closed in `afterEach` (push it to `opened`), except memory where it's the same instance.

Run memory + `test:pg` → PASS. If the 50-command test is flaky on Postgres with `StorageBusy`, that means a command waited over 5 s — investigate, don't raise the timeout. **Commit** — `server: contract tests for two replicas on one store — no lost updates, shared changes, one clock`

---

### Task 12: Deployment — replicas for Postgres

**Files:**
- Modify: `deploy/helm/modus/templates/_helpers.tpl:58-85` (`modus.validate`)
- Modify: `deploy/helm/modus/templates/deployment.yaml:17-20` (strategy)
- Modify: `deploy/helm/modus/values.yaml:115-117` (autoscaling comment)
- Modify: `docker-compose.yml` (commented second replica)

- `modus.validate`: keep the "exactly one deployment", "replicas must be 1" and "autoscaling off" failures only when `database.dialect` is `memory`, with the message `database.dialect=memory keeps all state in one process`.
- Strategy: `type: {{ ternary "Recreate" "RollingUpdate" $memory }}` with the comment: memory's state lives in one process and a ReadWriteOnce volume, so the old pod stops first; SQL dialects share the database and roll.
- values.yaml autoscaling comment: "SQL dialects only: replicas share the database (one command at a time per application)."
- Compose: after the `modus` service, a commented `modus-2` block (same image and environment, another host port) with a one-line comment on how to try two replicas.

**Verify:**

```bash
helm template t deploy/helm/modus --set database.dialect=postgres --set database.existingSecret=x --set deployments.all.replicas=3 | grep -E "replicas: 3|RollingUpdate"
helm template t deploy/helm/modus --set deployments.all.replicas=2 2>&1 | grep "must be 1"
helm template t deploy/helm/modus | grep Recreate
docker compose config -q
```

(Check the deployments key name in `values.yaml` — `all` is what `autoscaling.deployment` defaults to; adjust if the key differs.) If `helm` isn't installed, say so in the commit message and leave verification to CI. **Commit** — `deploy: allow several replicas and rolling updates on PostgreSQL`

---

### Task 13: Docs

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` (M2 section), `docs/DEPLOYMENT.md` (replicas), `apps/server/src/adapters/postgres.ts` header comment, `apps/server/src/adapters/memory.ts` header comment
- Modify: `docs/plans/2026-10-13-m2-transactions-design.md` (Status line: "implemented", and the refinements listed at the top of this plan)

Content:
- ROADMAP: projections, outbox (written, not yet sent — M4), durable clock: done. Locking: per application; per item after M1.
- ARCHITECTURE M2: one transaction per command; what the transaction writes; NOTIFY for other replicas; advisory-lock ticker; storage numbers audit entries.
- DEPLOYMENT: running several replicas (Postgres only), what `503 busy` means, `lock_timeout` 5 s, that memory stays at one replica.

Use the `humanizer` skill on the prose (Randy's docs voice: short, direct). Keep the legacy product name out (see memory: keep legacy name out of public repo).

Run the full suite one last time: `pnpm test`, `pnpm typecheck`, `test:pg`. **Commit** — `docs: M2 transactions done — projections, outbox, durable clock, several replicas on Postgres`

---

## Finish

Use superpowers:finishing-a-development-branch.
