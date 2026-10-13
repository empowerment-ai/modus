# M2, second slice: one transaction per command

Status: approved 2026-10-13. Builds on the first M2 slice (PostgreSQL storage, `aca8f4c`).

## Goal

Let more than one server share a PostgreSQL database safely, and write projection
tables, an outbox and a durable clock in the same transaction as the change that
caused them.

## Why per-application locking, not per-item (yet)

The engine works on a whole application's `SimState`: per-item data (`objects`)
sits beside shared state (people's workloads, round-robin cursors, fork and call
counters, KPIs, series). A command changes all of it in memory. Real per-item
locking needs the engine split into per-item commands (M1, `decide/evolve`).
Until then a command locks its application's row. Throughput is one command at a
time per application, which is fine at today's scale. Per-item locking follows M1.

Rejected: per-item locking now (an engine refactor several times the size of this
slice); one owner per application with request forwarding (leases, proxying and
failover for little gain).

## 1. One transaction per command

A new `Storage.transact(appId, fn)` replaces the separate state snapshot and log append:

1. `BEGIN`; `SELECT version, state, ticked_at FROM app_state WHERE app_id = $1 FOR UPDATE`.
2. If the stored `version` differs from the runtime's cached one, replace the cached
   state with the stored state (another replica wrote in between).
3. Move the clock to now (section 2), then run the engine command in memory.
4. In the same transaction write: the state with `version + 1`; the new audit entries
   into `event`; projection upserts for the touched items; outbox rows;
   `pg_notify('modus_change', {appId, version, itemIds})`.
5. `COMMIT`. On any failure, roll back and restore the cached state from a structured
   clone taken before step 3, so memory never holds state that did not commit.

The memory adapter implements the same contract with a per-application mutex and a
cloned snapshot.

Removed from the runtime: the 5-second snapshot timer, `dirty`, `logged` / `offset` /
`positions`, log backoff and the log-ahead-of-state reconciliation. A command either
commits or answers 503 with nothing changed.

Reads (`rt.read`) use the cached state. It is refreshed on `NOTIFY` from other replicas
and before every command.

**Live stream across replicas.** Each server `LISTEN`s on `modus_change`. A notice from
another replica reloads that application's state (when its `version` is newer) and
passes the change to SSE listeners, so a Workspace on server B sees work done on server A.

## 2. Projections, outbox, clock

**Projections** (written for the touched items only; read by M3 worklists and search):

- `item`: `app_id, item_id` (PK), `number, title, status, priority, expedited, due_at,
  created_at, ended_at, version, data jsonb`.
- `work_item`: `app_id, token_id` (PK), `item_id, step_id, state`
  (queued / assigned / started / auto), `assignee, group_id, service_id, entered_at,
  due_at, priority`. Rows are deleted when the token leaves the step.

A pure core function `projectItem(sim, ctx, itemId) → { item, workItems }` does the
mapping; the memory adapter keeps the same rows in maps.

**Outbox**: `outbox(id bigserial, app_id, item_id, kind, payload jsonb, created_at,
sent_at null)`. Derived from the transaction's new audit entries: `job.ready` when a
token enters a service-bound automated step; `notify` for notification and escalation
entries. Nothing sends them in this slice; the M4 dispatcher claims rows with
`FOR UPDATE SKIP LOCKED` and sets `sent_at`.

**Clock and timers.** `app_state.ticked_at` is the wall time the stored `clock`
corresponds to. Every `transact` first advances the clock by
`(now − ticked_at) × timeScale` through the engine's minute-by-minute `advance`, runs
the command, and sets `ticked_at = now`. So:

- two replicas never double-count time;
- after an outage the first replica up catches the clock up, and timers, escalations,
  SLA breaches and lease expiries fire (durable timers);
- ticks are "advance to now" commands run only by the replica holding
  `pg_try_advisory_lock(hashtext('modus-clock:' || appId))` on a dedicated connection
  (the lock moves if that replica dies). A tick commits only when the advance wrote
  audit entries or 30 s have passed; otherwise it rolls back.

No separate `timer` table: catching up from `ticked_at` already makes timers durable;
a next-due index matters only once state is per item.

## 3. Errors, migration, tests

**Errors**

- Lock wait: `SET LOCAL lock_timeout = '5s'`; on timeout roll back, restore the clone,
  answer 503 "busy, try again".
- Database down: nothing commits, memory rolls back, 503. Ticks log and retry next tick.
- Event conflict (`UNIQUE (app_id, item_id, seq)`): cannot happen under the row lock;
  kept as a backstop that rolls the whole transaction back.
- Lost `NOTIFY` (listener connection dropped): reconnect, then reload every application
  whose `version` moved. Commands reload stale state anyway; a missed notice only
  delays SSE.

**Migration `0002_projections`**: add `version bigint not null default 0` and
`ticked_at timestamptz` to `app_state`; create `item`, `work_item`, `outbox`. At startup
an application with state but no projections is backfilled in one transaction
(idempotent). `0001` is unchanged.

**Deployment**: Helm allows `replicaCount > 1` and `RollingUpdate` for the `postgres`
dialect; memory stays at one replica with `Recreate`. Compose keeps one server, with a
commented second replica.

**Tests** (memory and Postgres through the contract suite):

- `transact` commits state, events, projections and outbox together; a throwing command
  leaves all of them, and the cached state, unchanged; `version` increments per commit.
- Two runtimes on one database: 50 interleaved commands lose no update, item numbers are
  unique, events have no gaps per item; B's subscriber sees A's change via `NOTIFY`.
- Clock: 10 minutes of wall time across two replicas advance the clock 10 × scale, not
  twice; killing the lock holder moves ticking to the other replica.
- `projectItem` unit tests in core for each token state, including leaving a step.
- Existing runtime and server tests keep passing; snapshot and catch-up tests are
  removed or rewritten.

**Docs**: ROADMAP (projections, outbox, durable clock done; locking "per application;
per item after M1"), ARCHITECTURE M2, DEPLOYMENT (replicas).
