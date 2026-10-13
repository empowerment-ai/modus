# Outbox Webhooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver every outbox message to configured HTTP endpoints, signed, at least once, with retries, from every server sharing the work through the database.

**Architecture:** A pure `webhooks.ts` module (endpoint config, signing, retry schedule, classifying responses). A new `Deliveries` storage port (fan out, claim with a lease, record a result, list, retry, prune) implemented by both adapters and checked by the storage contract. A `Sender` loop per server that fans out, claims, POSTs outside any transaction and records results; it wakes on runtime changes and every 2 s. Admin routes list and retry deliveries.

**Tech Stack:** TypeScript, Node `fetch` + `node:crypto`, Kysely/Postgres (`FOR UPDATE SKIP LOCKED`), Vitest, Fastify, Helm.

**Design:** `docs/plans/2026-10-13-outbox-webhooks-design.md` (approved). Read it first.

---

## Conventions

- Branch `feat/outbox-webhooks` (already checked out). Commit after each task; messages `server: …` / `docs: …`, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Author must be rmichak@gmail.com.
- Commands: `pnpm --filter @modus-bpm/server test`, `pnpm typecheck`, and Postgres:
  `TEST_DATABASE_URL=postgres://modus:modus-test@127.0.0.1:5544/modus pnpm --filter @modus-bpm/server test:pg`
  (throwaway container `modus-test-pg`; start it with
  `docker run -d --name modus-test-pg -e POSTGRES_USER=modus -e POSTGRES_PASSWORD=modus-test -e POSTGRES_DB=modus -p 127.0.0.1:5544:5432 --tmpfs /var/lib/postgresql postgres:18-alpine`
  if it isn't running). Never use the dev database on 5434.
- Wall time, not simulated time: every function takes `now: number` (epoch ms) as a parameter so tests control it; only the sender loop reads `Date.now()`.
- Style: terse, no semicolons, single quotes, comments explain why.

---

### Task 1: `webhooks.ts` — endpoints, signing, schedule, classification

**Files:** Create `apps/server/src/webhooks.ts`, `apps/server/src/webhooks.test.ts`.

**API:**

```ts
export interface Endpoint {
  name: string
  url: string
  secret: string
  /** Only these applications / kinds; absent: all. */
  apps?: string[]
  kinds?: Array<'job.ready' | 'notify'>
}

/** Read endpoints from settings: WEBHOOK_URL + WEBHOOK_SECRET (name "default"), and/or WEBHOOKS_FILE (JSON array). Throws Error with every problem listed. */
export function loadEndpoints(env: Record<string, string | undefined>, readFile: (path: string) => string): Endpoint[]

export function matches(e: Endpoint, m: { appId: string; kind: string }): boolean

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` */
export function sign(secret: string, body: string, now: number): string
/** For receivers and tests: true when the header is valid and at most `toleranceMs` old. */
export function verify(secret: string, body: string, header: string, now: number, toleranceMs = 5 * 60_000): boolean

/** Delay after a failure, given the attempts made before it (the delivery's `attempts`): 0 → 10 s, 1 → 30 s, 2 → 2 min, 3 → 10 min, 4+ → 1 h. */
export function retryDelay(attempts: number): number
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000

export type Outcome = { ok: true } | { ok: false; retry: boolean; retryAfterMs?: number; status?: number; error: string }
/** Classify a response (or a thrown network/timeout error): 2xx ok; 408/429/5xx and errors retry; other 4xx (and 3xx: redirects aren't followed) fail. */
export function classify(res: { status: number; headers: Headers; text?: string } | { error: unknown }): Outcome
```

Rules for `loadEndpoints`:
- File entries: `name` (required, unique, `^[a-z0-9_-]{1,40}$`), `url`, `secret` or `secretEnv` (name of an env var holding it), optional `apps`, `kinds`.
- `url` must parse and be `https:`; `http:` only when `WEBHOOKS_ALLOW_HTTP === 'true'`.
- Secret at least 16 characters.
- `WEBHOOK_URL` without `WEBHOOK_SECRET` (or the reverse) is an error.
- Errors list every problem; messages never include a secret.
- `error` strings in `classify` are trimmed to 500 characters. `Retry-After` accepts seconds or an HTTP date.

**Tests (write first, see them fail):** each rule above; `sign`/`verify` round trip, tampered body fails, stale timestamp fails; `retryDelay(0..7)`; `classify` for 200, 204, 301, 400, 404, 408, 429 with `Retry-After: 120`, 500, 503 with a date, a thrown `TypeError('fetch failed')`, an `AbortError`.

**Commit:** `server: webhook endpoints, signing, retry schedule`

---

### Task 2: `Deliveries` port and the memory adapter

**Files:** Modify `apps/server/src/ports.ts`, `apps/server/src/adapters/memory.ts`, `apps/server/src/adapters/storage.contract.ts`; stub in `adapters/postgres.ts` (throw "not yet", replaced in Task 3).

**Port** (add `deliveries: Deliveries` to `Storage`):

```ts
export interface Delivery {
  outboxId: number
  endpoint: string
  appId: Id
  itemId: Id
  kind: OutboxMessage['kind']
  payload: Record<string, unknown>
  /** When the message was written (epoch ms). */
  createdAt: number
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  nextAt: number
  lastStatus?: number
  lastError?: string
  deliveredAt?: number
}

export interface Deliveries {
  /** For messages with no deliveries yet (oldest first, up to `limit`), create one per endpoint `route` returns; none: mark the message skipped and sent. Returns how many messages it handled. */
  fanOut(route: (m: { appId: Id; kind: string }) => string[], now: number, limit: number): Promise<number>
  /** Take up to `limit` pending deliveries due at `now`, pushing their nextAt to now + leaseMs so no one else takes them. */
  claim(now: number, leaseMs: number, limit: number): Promise<Delivery[]>
  /** Record an attempt: delivered, retry at `nextAt`, or failed. Sets the message's sent_at once none of its deliveries is pending. */
  record(outboxId: number, endpoint: string, result: { status: 'delivered' | 'pending' | 'failed'; nextAt?: number; lastStatus?: number; lastError?: string }, now: number): Promise<void>
  list(filter: { status?: Delivery['status']; limit?: number }): Promise<Delivery[]>
  /** Put a message's failed deliveries back to pending, due now, and clear its sent_at. False when it has none failed. */
  retry(outboxId: number, now: number): Promise<boolean>
  /** Delete messages (and deliveries) sent before now - keepMs, or failed before now - keepFailedMs. */
  prune(now: number, keepMs: number, keepFailedMs: number): Promise<number>
}
```

Memory adapter: keep the outbox array, add `createdAt` (wall ms at commit), `sentAt?`, `skipped?` to each message, and a `Map<string, Delivery>` keyed `${outboxId}:${endpoint}`. All methods synchronous inside, returning clones. The memory adapter needs a `createdAt` on outbox messages: set it from `Date.now()` in `transact`'s commit (memory) — fine, it's wall time.

`projections.outbox(appId)` keeps meaning "unsent messages".

**Contract tests (add to `storage.contract.ts`; write first):**
1. Fan-out creates one delivery per routed endpoint, `pending`, attempts 0, due now; a message routed to no endpoint is marked sent and never fanned out again; a second `fanOut` does nothing.
2. `claim` returns due pending deliveries oldest first, and a second `claim` at the same time returns none of them (lease); after `now + leaseMs` they come back.
3. Two concurrent claimers (Postgres: two storages from `peer()`; memory: same instance, `Promise.all`) never get the same delivery, over 20 messages.
4. `record` delivered → status delivered, deliveredAt; once both endpoints of a message are settled, `projections.outbox(appId)` no longer lists it.
5. `record` pending with `nextAt` → not claimable before it; `record` failed → `list({ status: 'failed' })` shows it with lastStatus/lastError.
6. `retry` on a failed message → claimable again, sent_at cleared; on a message with none failed → false.
7. `prune` deletes old sent and old failed messages, keeps recent and pending ones.

Create messages in tests through `transact` (a helper that commits a state with an `outbox` list).

**Commit:** `server: Deliveries port — fan out, claim with a lease, record, retry, prune (memory adapter)`

---

### Task 3: Postgres — migration `0003_outbox_delivery` and the port

**Files:** Modify `apps/server/src/adapters/postgres.ts`, `apps/server/src/adapters/storage.test.ts` (migration list).

Migration (never edit 0001/0002):

```ts
'0003_outbox_delivery': {
  async up(db) {
    await db.schema.alterTable('outbox').addColumn('skipped', 'boolean', (c) => c.notNull().defaultTo(false)).execute()
    await db.schema
      .createTable('outbox_delivery')
      .addColumn('outbox_id', 'bigint', (c) => c.notNull().references('outbox.id').onDelete('cascade'))
      .addColumn('endpoint', 'text', (c) => c.notNull())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
      .addColumn('next_at', 'timestamptz', (c) => c.notNull())
      .addColumn('last_status', 'integer')
      .addColumn('last_error', 'text')
      .addColumn('delivered_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (c) => c.notNull())
      .addPrimaryKeyConstraint('outbox_delivery_pk', ['outbox_id', 'endpoint'])
      .execute()
    await sql`create index outbox_delivery_due on outbox_delivery (next_at) where status = 'pending'`.execute(db)
    // Messages not yet fanned out: unsent and without deliveries.
    await sql`create index outbox_unrouted on outbox (id) where sent_at is null and not skipped`.execute(db)
  },
  async down(db) {
    await db.schema.dropTable('outbox_delivery').execute()
    await db.schema.alterTable('outbox').dropColumn('skipped').execute()
  },
},
```

Implementation notes:
- Times are passed from JS (`new Date(now)`), never `now()` in SQL, so tests control the clock.
- `fanOut`: in one transaction, `select id, app_id, kind from outbox o where sent_at is null and not skipped and not exists (select 1 from outbox_delivery d where d.outbox_id = o.id) order by id limit $n for update skip locked`; insert deliveries (`on conflict do nothing`); for messages with no route, `update outbox set skipped = true, sent_at = $now`.
- `claim`: `update outbox_delivery d set next_at = $lease from (select outbox_id, endpoint from outbox_delivery where status = 'pending' and next_at <= $now order by next_at, outbox_id, endpoint collate "C" limit $n for update skip locked) c where (d.outbox_id, d.endpoint) = (c.outbox_id, c.endpoint) returning …` joined with `outbox` for app/item/kind/payload/created_at.
- `record` (fenced): `update outbox_delivery set … attempts = attempts + 1 where outbox_id = $1 and endpoint = $2 and status = 'pending' and next_at = $claimedUntil`; return false when no row changed (a server whose lease ran out lost the delivery to another) and skip the rest; otherwise `update outbox set sent_at = $now where id = $id and not exists (select 1 from outbox_delivery where outbox_id = $id and status = 'pending')` — same transaction.
- `retry`: failed deliveries → pending, `next_at = $now`, `attempts = 0`, `since = $now` (store it in `outbox_delivery.created_at`, or add a `since` column), keep last status/error; clear the message's `sent_at`.
- `list` and `claim` order endpoints with `collate "C"` so both adapters agree.
- `prune`: delete from `outbox` where sent and (no failed delivery and sent_at < now - keep, or has a failed delivery and sent_at < now - keepFailed); cascade removes deliveries. Skipped messages count as sent.
- Bump the migrations test to expect `0003_outbox_delivery`.

Run the contract on both adapters; run `test:pg` twice. **Commit:** `server: Postgres outbox deliveries — migration 0003, SKIP LOCKED claims`

---

### Task 4: The sender loop

**Files:** Create `apps/server/src/sender.ts`, `apps/server/src/sender.test.ts`.

```ts
export interface SenderOptions {
  storage: Storage
  endpoints: Endpoint[]
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch
  now?: () => number
  log?: (level: 'warn' | 'error', msg: string, extra?: object) => void
  intervalMs?: number   // 2000
  leaseMs?: number      // 60_000
  timeoutMs?: number    // 10_000
  batch?: number        // 20
  keepMs?: number       // 7 days
  keepFailedMs?: number // 30 days
}

export class Sender {
  constructor(opts: SenderOptions)
  start(): void            // interval (unref) + prune once an hour
  /** Run one round now (fan out, claim, send, record); concurrent calls coalesce into one extra round. */
  wake(): Promise<void>
  stop(): Promise<void>    // clears timers, waits for the round in flight
}
```

One round: `fanOut(route, now, 100)` until it returns < 100 or 5 loops; `claim(now, leaseMs, batch)`; send all claimed in parallel (`Promise.all`, each with `AbortSignal.timeout(timeoutMs)`, `redirect: 'manual'`, body `JSON.stringify({ id, kind, appId, itemId, createdAt: new Date(createdAt).toISOString(), payload })`, headers `content-type: application/json`, `user-agent: Modus-Webhooks/1`, `Modus-Signature`, `Modus-Delivery: <outboxId>`); `classify`; `record(…, delivery.nextAt /* the claim's lease */, …)` and ignore a `false` result (another server took the delivery over):
- ok → delivered;
- retry and `now + delay < delivery.since + GIVE_UP_AFTER_MS` → pending, `nextAt = now + max(retryDelay(delivery.attempts), retryAfterMs ?? 0)` (attempts as claimed, before `record` adds this one);
- otherwise failed, and `log('warn', …)` with endpoint name, outbox id, status, error.

With no endpoints: `route` returns `[]`, so fan-out marks everything skipped; no claims.

Errors in a round (storage down) are logged and the next round retries; a round never throws to the caller of `wake` except in tests via `log`.

**Tests** (memory storage; a real local HTTP server via `node:http` on port 0 so the HTTP path is real; fake `now` starting at or after the real `Date.now()`, because messages get a real wall-clock `createdAt` at commit; `since` comes from the `now` passed to `fanOut`):
1. A message created through `transact` reaches the server once, with a body matching the format and a signature `verify` accepts.
2. Two endpoints, one filtered by `kinds: ['notify']`: a `job.ready` reaches only the other.
3. Server answers 500: delivery pending with nextAt = now + 10 s; advance `now` 10 s, wake, server answers 200 → delivered; the server saw 2 requests.
4. Server answers 400 → failed at once, logged.
5. Always 503 → after the attempt that crosses 24 h from createdAt, failed.
6. `Retry-After: 300` on 429 → nextAt = now + 300 s.
7. A 301 is not followed (the redirect target never receives a request) → failed.
8. A hanging server → aborted after timeoutMs (use a small value) → pending.
9. `stop()` leaves no timers (`vi.getTimerCount` with fake timers, or check handles).

**Commit:** `server: sender loop — fan out, claim, POST signed, record`

---

### Task 5: Wiring — settings, startup, admin routes

**Files:** Modify `apps/server/src/config.ts` (+ `config.test.ts`), `apps/server/src/main.ts`, `apps/server/src/http.ts` (+ `server.test.ts` or `platform.test.ts`).

- `config.ts`: add `webhooks: Endpoint[]` to `Config`, built with `loadEndpoints(source, path => readFileSync(path, 'utf8'))`; its errors become `ConfigError` lines. `WEBHOOKS_KEEP_DAYS` (default 7, 1-365) and `WEBHOOKS_KEEP_FAILED_DAYS` (default 30, 1-365). `describeConfig` adds `webhooks: none` or `webhooks: ops → hooks.example.com (notify), default → …`. Tests: none set; URL + secret; file with two entries and `secretEnv`; bad file listed in ConfigError without the secret.
- `main.ts`: create `new Sender({ storage, endpoints: config.webhooks, log: … })` after the runtime; `runtime.subscribe(() => void sender.wake())` (commits and notices both wake it); `sender.start()`; on shutdown `await sender.stop()` before `runtime.stop()`.
- `buildServer(rt, { …, sender? })`: admin routes, administrators only (`hasRole(buildIndex(rt.ctx(rt.design.apps[0]!.id)), who(req), 'admin')`, else 403):
  - `GET /api/admin/outbox?status=failed|pending|delivered&limit=…` → `{ deliveries: [...] }` (no secrets; endpoint name only).
  - `POST /api/admin/outbox/:id/retry` → `{ ok: true }` and `sender.wake()`, or 404 when nothing failed.
- Tests: non-admin gets 403; admin sees a failed delivery and retrying makes it claimable (use the memory storage directly to create a failed delivery).

**Commit:** `server: webhooks settings, sender at startup, outbox admin routes`

---

### Task 6: Two servers, Helm, docs

**Files:** Modify `apps/server/src/adapters/storage.contract.ts` (or a new Postgres-only test), `deploy/helm/modus/values.yaml`, `templates/configmap.yaml`, `templates/deployment.yaml`, `docs/DEPLOYMENT.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/plans/2026-10-13-outbox-webhooks-design.md` (status: implemented).

- Two-server test (contract, `peer()`): two `Sender`s on two storages against one local HTTP server; create 30 messages; wake both repeatedly until all are delivered; the server saw each `id` exactly once.
- Helm: `webhooks.endpoints` (list without secrets: name, url, apps, kinds, secretEnv) rendered into a `webhooks.json` key in the ConfigMap and mounted at `/etc/modus/webhooks.json` with `WEBHOOKS_FILE` set; `webhooks.existingSecret` whose keys are exposed as env vars (`envFrom`) so `secretEnv` names resolve. Nothing rendered when the list is empty. Verify with `docker run --rm -v "$PWD/deploy/helm/modus:/chart" alpine/helm:3.16.2 template …` and `lint`.
- DEPLOYMENT.md "Webhooks" section: settings; payload example; headers; verifying the signature in Node (10 lines with `crypto.timingSafeEqual`); retries and give-up; admin routes; Helm values.
- ROADMAP/ARCHITECTURE: outbox sender (webhooks) done; email from Modus and REST/MCP connectors remain M4.

**Commit:** `deploy, docs: webhooks — two-server delivery test, Helm values, docs`
