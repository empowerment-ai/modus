# Load Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `pnpm load` runs a mixed, watchable load against 1–3 local Modus servers on a disposable Postgres and saves a comparable report.

**Architecture:** A `tools/load` workspace package holds a Compose stack (Postgres, 1–3 Modus servers built from the working tree, nginx, an observer), k6 scenarios run from the `grafana/k6` image, a host-side runner that orchestrates and writes the report, and a setup script that writes a test design into the database before the servers start.

**Tech Stack:** Docker Compose, grafana/k6 (Docker), nginx, Node 22 + tsx, Vitest, the server's Postgres adapter.

**Design:** `docs/plans/2026-10-13-load-tests-design.md` (approved). Read it first.

---

## Conventions

- Branch `feat/load-tests` (checked out). One commit per task; messages `load: …` / `docs: …`, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; author rmichak@gmail.com.
- Pin image tags to exact versions at least two weeks old (e.g. `grafana/k6:0.57.0` or newer known release, `nginx:1.27-alpine` style exact tag, `postgres:18-alpine` as the main compose file uses). Check what exists with `docker pull`.
- Ports on 127.0.0.1 only: nginx 8790, k6 dashboard 5665, Postgres 5546, observer 8791. Compose project name `modus-load`.
- Never touch the dev compose project, its volumes, or the dev database on 5434. The throwaway `modus-test-pg` (5544) is for unit tests only.
- Style: terse, no semicolons, single quotes, comments explain why. Docs: short, plain, US spelling.

---

### Task 1: Package and Compose stack

**Files:** `pnpm-workspace.yaml` (add `tools/*`), `Dockerfile` (copy `tools/load/package.json` in the manifests step so `--frozen-lockfile` keeps working), root `package.json` scripts (`load`, `load:compare` → `pnpm --filter @modus-bpm/load …`), `tools/load/package.json` (private; deps: `@modus-bpm/server` and `@modus-bpm/core` workspace, `pg`; dev: `tsx`, `vitest`, `typescript`, `@types/node`), `tools/load/tsconfig.json`, `tools/load/compose.yml`, `tools/load/nginx.conf`, `tools/load/.gitignore` (`results/`).

Compose services:
- `postgres` (postgres:18-alpine, tmpfs data, `max_connections=300`, published 127.0.0.1:5546).
- `modus1..3`: the image built from the repo root Dockerfile (`build: ../..`), `DB_DIALECT=postgres`, `DATABASE_URL` to `postgres`, `DB_POOL_MAX=20`, `TIME_SCALE` from env (default 60), `STATIC_DIR` as in the main compose file, webhook settings pointing at the observer (`WEBHOOK_URL=http://observer:8791/hook`, `WEBHOOK_SECRET`, `WEBHOOKS_ALLOW_HTTP=true`), `deploy.resources.limits` (cpus 1.5, memory 1g). `modus2`/`modus3` behind Compose profiles `s2`/`s3`.
- `nginx`: round-robin over the running servers (a template per server count, or `resolver` + upstream with all three and `max_fails`; pick the simpler that works), `proxy_buffering off` and long timeouts for `/api/apps/*/stream`, published 127.0.0.1:8790.
- `observer`: Task 3. Not yet.

Verify: `docker compose -f tools/load/compose.yml -p modus-load --profile s2 up -d --build postgres modus1 modus2 nginx`, `curl -s localhost:8790/api/ready` answers ok through nginx, then `down -v`. `pnpm install` and `pnpm typecheck` still pass; `docker build .` still works.

Commit: `load: workspace package and Compose stack (Postgres, servers, nginx)`

---

### Task 2: Test design setup

**Files:** `tools/load/src/design.ts`, `tools/load/src/design.test.ts`, `tools/load/src/setup.ts`.

- `loadDesign(clerks: number): Design` — `seedDesign()` plus `clerks` generated users (`u_load_0001`…, names `Load Clerk 0001`, copying the shape and title of an existing AP clerk) added to `g_clerks.memberIds`. Ids zero-padded to 4 digits. Pure.
- `setup.ts` (run on the host with tsx): `postgresStorage(url).migrate()` then `designs.save(loadDesign(n))`, then close. URL from `LOAD_DATABASE_URL` (default the stack's 127.0.0.1:5546).
- Tests: count and ids; members added to `g_clerks`; the result still loads in a live `Ctx` and `createObject(..., 'w_invoice', ...)` distributes to a generated clerk eventually (load balancing); the seed itself is not mutated.

Commit: `load: test design with generated clerks, written before the servers start`

---

### Task 3: Observer (webhook receiver + live-screen watcher)

**Files:** `tools/load/observer/server.mjs` (plain Node 22, no deps, so the container is `node:22-alpine` with the file mounted), compose service `observer` (published 127.0.0.1:8791), `tools/load/observer/server.test.ts` (vitest, imports it).

- `POST /hook`: verify `Modus-Signature` against `WEBHOOK_SECRET` (same scheme as `apps/server/src/webhooks.ts` `verify`; copy the 10 lines, comment where they come from), record `{ id, kind, lagMs: now - createdAt }`, answer 204. Count duplicates by id and bad signatures.
- Streams: on `POST /streams/start { count, servers: [urls] }` open `count` SSE connections to `/api/apps/app_invoice/stream` spread round-robin over the given server URLs (directly, not through nginx, so each stream is pinned to one server). For each `change` event record arrival time per item id per stream. Cross-server lag for an item = latest arrival − earliest arrival across streams on *different* servers.
- `GET /stats`: `{ webhooks: { received, duplicates, badSignatures, lag: { p50, p95, p99, max } }, streams: { open, reconnects, events, crossServerLag: { p50, p95, p99, max } } }`. `POST /reset` clears.
- Tests: signature accepted/rejected; lag and duplicate counting; percentile helper; SSE handling against a tiny fake SSE server.

Commit: `load: observer — webhook receiver and cross-server update lag`

---

### Task 4: k6 scenarios and profiles

**Files:** `tools/load/k6/main.js`, `tools/load/k6/profiles.js`, `tools/load/k6/data.js`.

One script, four scenarios from the design table, picked by `PROFILE` env (`smoke`, `baseline`, `full`):
- `items`: `constant-arrival-rate` (smoke/baseline) or `ramping-arrival-rate` (full); random invoice data (`f_invno` unique per VU/iter, `f_vendor` from the seed's vendor list, `f_amount`, `f_invdate`, `f_po` set on ~70%); user `u_maya` (a requester).
- `people`: `ramping-vus`; each VU is clerk `u_load_<VU id mod clerks>`; loop: GET basket, GET queues, POST `my/next`, GET the item, POST save (a note field if the type has one; otherwise skip), POST release with an outcome from the step, sleep 2–8 s. Read outcome ids and field ids from the item response, not hard-coded, where possible.
- `workers`: `constant-vus`; poll `/api/jobs/poll` for each service the sample design's live workflows call (read from `GET /api/apps` + item data, or list the seed's service ids in `data.js`), sleep 50–300 ms, complete (95%) or fail (5%).
- Live screens are opened by the runner through the observer (k6 can't hold SSE).
- Tags per request kind (`kind: create|basket|queues|next|open|save|release|poll|complete|fail`) so the report groups them; custom counter `busy` for 503s.
- `thresholds`: none that abort; the soft limits are computed by the report. Base URL from `BASE_URL` (nginx).

Verify against a stack started by hand (Task 1 command): `docker run --rm --network modus-load_default -e PROFILE=smoke -e BASE_URL=http://nginx -v $PWD/tools/load/k6:/k6 grafana/k6:<tag> run /k6/main.js` finishes with < 1% errors.

Commit: `load: k6 scenarios — items, people, workers; smoke, baseline and full profiles`

---

### Task 5: Runner, report, compare

**Files:** `tools/load/src/run.ts`, `tools/load/src/report.ts`, `tools/load/src/report.test.ts`, `tools/load/src/compare.ts`, `tools/load/src/compare.test.ts`.

`run.ts` (`pnpm load [--profile smoke|baseline|full] [--servers 1|2|3] [--keep]`):
1. Results dir `tools/load/results/<YYYYMMDD-HHMM>-<profile>-<n>srv/`.
2. `docker compose -p modus-load -f tools/load/compose.yml [--profile s2 s3] build` then `up -d postgres`; wait for health.
3. Run `setup.ts` (clerks: 20 smoke, 200 baseline, 1,000 full).
4. `up -d` servers, nginx, observer; wait for `/api/ready` on each server.
5. Observer: `POST /reset`, `POST /streams/start` with the profile's count and the server URLs (inside the network: `http://modus1:8787`…).
6. Print where to watch: `http://localhost:5665` (k6) and `http://localhost:8790` (Studio).
7. Run k6 in Docker on the stack network with `K6_WEB_DASHBOARD=true`, `K6_WEB_DASHBOARD_PORT=5665` published, `K6_WEB_DASHBOARD_EXPORT=/results/dashboard.html`, `--summary-export /results/k6.json`; stream its output.
8. Collect: observer `/stats`; backlog via `GET /api/apps/app_invoice/overview` (or the closest endpoint giving active items and waiting jobs); undelivered webhooks via the admin outbox list as an administrator (`x-user-id` of a seed admin); `docker compose logs` per server into the folder.
9. `report.ts` builds `summary.json` and `summary.md`; print the summary path.
10. `down -v` unless `--keep`. Always tear down on Ctrl-C or error (trap signals).

`report.ts`: pure function from (k6 summary JSON, observer stats, backlog, settings) to `{ json, markdown }`, including the soft limits with ✓/⚠. Tests with fixture inputs (a small k6 summary sample), including a run with missing pieces (observer down → "not measured").

`compare.ts` (`pnpm load:compare <dirA> <dirB>`): table of the main numbers with absolute and % change, marking better/worse. Tests with two fixture summaries.

Verify: `pnpm load --profile smoke` end to end on this machine; errors near zero; the report and dashboard exist; the stack is gone afterwards (`docker compose -p modus-load ps` empty).

Commit: `load: runner, report and compare`

---

### Task 6: First runs and docs

- Run `pnpm load --profile baseline --servers 1` and `--servers 2`. Keep the two summaries' numbers for the docs (not the files).
- `tools/load/README.md`: requirements (Docker memory), commands, profiles, watching, reading the report, comparing, the limits of laptop numbers, cleaning up.
- `docs/DEPLOYMENT.md` and `docs/ROADMAP.md`: short pointer (ROADMAP: "Load tests (local harness)" done; targets still to reach).
- Design doc: Status → implemented; a short "First results" paragraph with the two baseline runs' headline numbers and what they show.
- `pnpm test` and `pnpm typecheck` pass.

Commit: `docs: load tests — README, first baseline results`
