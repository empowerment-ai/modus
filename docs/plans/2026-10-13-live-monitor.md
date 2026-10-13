# Live Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Served by a Modus server, the Studio's Monitor shows the server's real state live, with a switch back to the simulation.

**Architecture:** The server adds administrator-only read endpoints over its in-memory state (`/monitor`, `/monitor/series`, `/monitor/feed`, `/monitor/items`) and `GET /api/design`. The Studio adds a server client and a live store fed by those endpoints and the existing SSE stream; Monitor panels read from either the simulation store or the live store.

**Tech Stack:** Fastify + zod (server), React 19 + zustand (studio), Vitest, the core read models (`computeView`, etc.).

**Design:** `docs/plans/2026-10-13-live-monitor-design.md` (approved). Read it first.

---

## Conventions

- Worktree `/Users/randymichak/Projects/modus-live-monitor`, branch `feat/live-monitor` (from main). Work only there. Another branch is being worked on in `/Users/randymichak/Projects/modus` at the same time: don't touch that folder.
- One commit per task; messages `server: …` / `studio: …` / `docs: …`, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; author rmichak@gmail.com.
- Commands (from the worktree): `pnpm install` once, then `pnpm test`, `pnpm typecheck`, `pnpm --filter @modus-bpm/studio build`.
- Style: terse, no semicolons, single quotes, comments explain why. Match each package's existing patterns (read neighboring files first).

---

### Task 1: `GET /api/design` and `GET /api/apps/:app/monitor`

**Files:** `apps/server/src/http.ts`, `apps/server/src/dto.ts` (if a DTO helps), tests in `apps/server/src/platform.test.ts` or a new `monitor.test.ts`.

- `GET /api/design`: any named user (`who(req)`), returns the runtime's published design. Doc comment: the Workspace will use it too.
- `GET /api/apps/:app/monitor`: administrators only (`isAdmin` from core, as the outbox routes do; 401 without a user, 403 otherwise). Returns `{ clock, view, expeditedByStep, working }` where `view` is `computeView(sim, ctx)` as the Studio computes it, `expeditedByStep` matches the Studio's `expeditedByStep(sim)` (move that helper into core if it's only in the Studio, and use it from both), and `working` is core's `workingNow(sim)`: each person with work in the `working` state maps to `{ itemId, number, stepId, startedAt, also }`. The simulation's `currentId` wins; otherwise the latest started item (people starting work through the API never set `currentId`); `also` counts the other items they have started. Read `apps/studio/src/features/monitor/*.tsx` to see exactly what each panel needs.
- Tests: 401/403/200; shape includes KPIs, steps, services, users; `expeditedByStep` and `working` reflect an expedited item and a started work item.

Commit: `server: published design and the Monitor view over the API`

---

### Task 2: series, feed and items

**Files:** `apps/server/src/http.ts`, tests.

- `GET /api/apps/:app/monitor/series?since=<sim minute>` → `{ points: [{ t, wip, done }] }` with `t > since` (all when absent).
- `GET /api/apps/:app/monitor/feed?limit=1..300` (default 100) → `{ entries }`, newest first like the Studio's ActivityFeed expects (check its order).
- `GET /api/apps/:app/monitor/items?status&type&step&assignee&q&limit&cursor` → `{ items: [...], next?: cursor }`: the same filters and row fields the Studio's ObjectExplorer uses (read it), over all items (administrator view, no field filtering beyond what an administrator sees), newest first, `limit` 1..200 (default 50), cursor = opaque string (e.g. base64 of the last `createdAt|id`). Text `q` matches like the explorer does today.
- All administrator-only; zod-validated query; 400 on bad input.
- Tests: incremental series; feed limit and order; items filters each, paging across two pages without duplicates or gaps, `q`.

Commit: `server: Monitor series, activity feed and item explorer endpoints`

---

### Task 3: Studio server client and live store

**Files:** `apps/studio/package.json` (add `vitest` dev dep and a real `test` script; keep `typecheck`), `apps/studio/src/server/client.ts`, `apps/studio/src/server/live.ts` (zustand store), tests next to them.

- `client.ts`: `detectServer(fetch)` → boolean via `GET /api/health` (short timeout, never throws); `api(path, { user })` adding `x-user-id`; typed calls for the Task 1-2 endpoints; `openStream(appId, onEvent, onState)` using `fetch` + a reader (not EventSource: custom header needed) with an SSE parser that ignores `:` comments, reconnect with backoff, and `onState('live' | 'reconnecting')`.
- `live.ts` store: `{ available, mode: 'live' | 'simulation', actingAdmin, design, monitor, series, feed, explorer, lastUpdate, status, error }`; `connect(appId)` loads design + monitor + series + feed, opens the stream; on `change`: apply `counts` to step totals immediately, schedule a throttled (≥ 1 s) refetch of monitor/feed and an incremental series fetch; `items: null` → full refetch; disconnect → status reconnecting, keep data; 403 → error "not an administrator".
- `actingAdmin`: default the first user in the server design with the `admin` role; persisted in the existing UI store if there's a natural place, else local.
- Tests (vitest, fake fetch and a fake SSE stream): detection true/false; connect loads everything; a change event updates counts and triggers one throttled refetch for a burst; `items: null` refetches; stream drop → reconnecting → live again; 403 sets the error.

Commit: `studio: server client and live Monitor store`

---

### Task 4: Monitor UI in Live mode

**Files:** `apps/studio/src/features/monitor/*.tsx`, `apps/studio/src/App.tsx` or `main.tsx` (run detection once), `apps/studio/vite.config.ts` (dev proxy).

- Detection at startup; if available, the Monitor header shows a **Live / Simulation** switch (Live default) and, in Live, a badge "Live · updated Ns ago" / "reconnecting…" (amber), the acting administrator, and a note when the server's design differs from the browser's (compare by a cheap stable hash or the published versions).
- Each panel reads from the live store in Live mode and from the simulation store otherwise, with the same layout: KPIs, bottleneck, steps (+ expedited), services, workload (using `working`), WIP chart (series), activity feed, explorer (server paging and filters; debounce `q`), OCEL download (link to `/api/apps/:app/export/ocel` with the header — use fetch + blob since a plain link can't send headers).
- WorkloadTable: in Live mode hide or recompute utilization (`busyMinutes` stays 0 on a server, people aren't simulated); in both modes take "working on" from core's `workingNow` (Live: the endpoint's `working`; Simulation: `workingNow(sim)`), replacing its own `currentId` lookup.
- Live mode hides simulation-only controls (speed, arrivals, burst, reset, the steps "shuffle" action) and says why on hover.
- The map/heat counts elsewhere in the Studio are not in scope.
- `vite.config.ts`: when `MODUS_SERVER` is set, proxy `/api` to it, so `MODUS_SERVER=http://localhost:8787 pnpm dev` works against a running server; without it, unchanged.
- Verify by hand: run the server (`pnpm --filter @modus-bpm/server dev` with defaults: memory storage) and the studio with the proxy; create an invoice via the API; the Live Monitor shows it within a second or two; toggle to Simulation and back. Then build (`pnpm --filter @modus-bpm/studio build`) and check the standalone build still has no server mode.

Commit: `studio: the Monitor shows a server's live state, with a switch back to simulation`

---

### Task 5: End-to-end smoke and docs

- A smoke script `apps/server/scripts/live-monitor-smoke.ts` (or a vitest under server with a flag) that: builds nothing itself; starts the server with `STATIC_DIR` pointing at the built studio, fetches `/` (HTML) and the Monitor endpoints as the admin, creates an invoice, and checks `/monitor` reflects it and the stream delivers a change. Document how to run it; not part of `pnpm test` if it needs the studio build.
- Docs: ARCHITECTURE (M3 slice: Monitor live, the endpoints, `x-user-id` as administrator until OIDC), ROADMAP (Monitor on the server: done; Workspace next), DEPLOYMENT (one line: the served Studio's Monitor shows the server's state), design doc status → implemented with refinements.
- `pnpm test`, `pnpm typecheck`, studio build pass.

Commit: `docs: live Monitor — smoke check, architecture and roadmap`
