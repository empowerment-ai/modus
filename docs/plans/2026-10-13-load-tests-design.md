# Load tests (local)

Status: implemented 2026-10-13 (`tools/load`, see its README). Roadmap item from M5; run before per-item locking (after M1) to get a baseline.

## Goal

One command runs a realistic mixed load against 1–3 Modus servers on a disposable Postgres on a
developer's machine, lets you watch it live, and saves a report you can compare with other runs.
Numbers are for finding bottlenecks and comparing before/after, not for production capacity.

## Setup

- `tools/load/` (a workspace package): `compose.yml`, k6 scenarios, a setup script, an observer, the
  runner, a README.
- `pnpm load [--profile smoke|baseline|full] [--servers 1-3]`: build the image from the working tree;
  start Postgres, the setup step, 1–3 Modus servers behind nginx, and the observer; run k6; write the
  report; tear everything down. Its own Compose project and ports, never the dev database.
- **Test design:** the sample design plus generated clerks (`u_load_0001`…) in the clerk group, written
  to the database before the servers start, so 1,000 simulated people are 1,000 identities.
- **Clock:** a high `TIME_SCALE` so timers, SLAs, escalations and the outbox fire during a run.
- **Containers** have CPU and memory limits so runs compare; the README says how much Docker memory to
  allow.
- **Watching:** the k6 web dashboard at `localhost:5665` (exported as HTML at the end), and the Studio
  on the load stack at `localhost:8790` (Monitor, Workspace).

## Traffic (all at once)

| Scenario | What it does | smoke | baseline | full |
| --- | --- | --- | --- | --- |
| New items | `POST /api/apps/app_invoice/items` at a constant arrival rate, random realistic data | 2/s | 10/s | 10 → 100/s |
| People | basket, queues, `my/next`, open, save, release with an outcome, think 2–8 s | 10 | 100 | → 1,000 |
| Workers | per service: poll, wait as if calling it, complete; ~5% fail | 2 | 4 | 8 |
| Live screens | SSE streams spread over the servers, measuring cross-server update lag (observer) | 10 | 100 | 300 |

Durations: smoke ~1 min, baseline ~10 min, full ~20 min.

The **observer** (one small Node container) is the webhook receiver (verifies signatures, records
delivery lag from `createdAt`) and holds the SSE streams (k6 has no SSE client); it serves its stats as
JSON for the report.

## Report

`tools/load/results/<timestamp>-<profile>-<n>srv/` (git-ignored): `summary.md` (settings; throughput;
p50/p95/p99 per request kind; errors; 503 busy rate; webhook lag; update lag across servers; backlog at
the end), `dashboard.html`, `summary.json`, server logs. `pnpm load:compare <a> <b>` prints the
differences.

Soft limits shown as ✓/⚠, never failing a run: reads p95 < 300 ms, changes p95 < 500 ms, errors < 1%,
busy < 2%, webhooks within 5 s, cross-server updates within 2 s.

Expected first result: one application's commands run one at a time and each copies the application's
state, so as items accumulate, latency and busy answers climb, and more servers help little. That is
the number per-item locking should move.

## First results

Two `baseline` runs on a 10-core MacBook Pro (Docker: 10 CPUs, 8 GB), commit 37607f3, back to
back:

| | 1 server | 2 servers |
| --- | ---: | ---: |
| Requests | 12.6/s | 13.6/s |
| Items created (10/s offered) | 3,383 | 3,452 |
| Item arrivals k6 couldn't start | 2,453 | 2,348 |
| Reads p95 / changes p95 | 52.1 s / 53.3 s | 53.5 s / 56.5 s |
| Errors (60 s timeouts) | 0.31% | 0.97% |
| Busy (503) | 0 | 0 |
| Webhook lag p95 | 325 ms | 464 ms |
| Same update on both servers, p95 | – | 17.9 s |
| Service jobs waiting at the end | 3,365 | 3,363 |
| Items at the clerk review at the end | 14 | 14 |

Baseline is already past what one application can take. Both servers' logs show the commands
answered per second falling as items pile up: on one server from about 30/s in the first minute
to 4.3/s in the tenth; on two, the two together from about 34/s to 4.4/s. A second server adds
almost nothing (+8% requests), which is the per-application bottleneck the design expected: each
command copies the whole application's state, so it gets slower as items accumulate, and
commands to one application run one at a time across servers.

It shows up as waiting, not as busy answers. Each server runs one application's commands and
reads one at a time in memory, so only one command per server ever waits on the row lock and
the 5 s lock timeout never fires; everything else queues inside the process, reads included, up
to k6's 60 s timeout. Live screens lag the same way: the second server's reload after a change
waits in the same queue (17.9 s p95). Webhooks stay fast (p95 under 0.5 s) because the sender
works outside that queue. The service jobs left waiting (3,000 at Capture & match PO) are the
workers' polls and completions stuck behind item creation, not a lack of workers. People keep
up: 14 items at the clerk review.

An earlier pair of runs found two harness faults, fixed before these: the end-of-run backlog
read timed out behind the queue, and nginx took both servers out of rotation after a few
timeouts and answered 502 itself (10.9% errors on two servers).

## Testing the harness

`smoke` must finish with near-zero errors. Unit tests for the design generator, the summary and the
compare. Not in GitHub CI (shared runners give meaningless numbers).

## Docs

`tools/load/README.md`; pointers from DEPLOYMENT and ROADMAP.
