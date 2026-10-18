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
  on the load stack at `localhost:8790`, whose Monitor in Live mode shows the servers' own counts as
  the seed administrator (since the live Monitor merged in).

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
to 4.3/s in the tenth; on two, the two together from about 34/s to 4.28/s. A second server adds
almost nothing (+8% requests), which is the per-application bottleneck the design expected:
commands to one application run one at a time across servers, and each one costs more as items
accumulate.

### What a command really costs

Measured at about 3,500 items, when the application's state is 4.7 MB as JSON:

| Per command | Cost |
| --- | ---: |
| `computeView` once per open live stream (about 1.1 ms each, 100 streams) | ~32 ms |
| `structuredClone` of the whole state | ~31 ms |
| Saving the whole state as JSON under the row lock (stringify; the Postgres write comes on top) | ~14 ms |
| 2 servers: reloading and parsing the whole state after the other server's commits | ~15 ms, often twice |
| `advance` scanning every token | ~7 ms |
| `changesBetween` | ~6 ms |

The live streams are the biggest single cost. Each open stream recomputes the view after every
change, and each of those is a read queued behind the commands (the stream route in `http.ts`).
Together it comes to about 90 ms of CPU per command, plus the database: 5 to 10 commands a
second, which matches the 4.3/s measured.

The servers looked half idle at about 0.7 CPU of their 1.5 CPU limit, but they weren't. Node
runs the application code on one thread, so 0.7 CPU means that thread is saturated; the rest is
garbage collection and I/O threads.

### Where the time goes

It shows up as waiting, not as busy answers. Each server runs one application's commands and
reads one at a time in memory, so only one command per server ever waits on the row lock and
the 5 s lock timeout never fires; everything else queues inside the process, reads included, up
to k6's 60 s timeout. Live screens lag the same way: the second server's reload after a change
waits in the same queue (17.9 s p95). Webhooks look fast (p95 under 0.5 s), but their lag is
measured from the commit, so it leaves out the time each command waited in the queue first.

The service jobs left waiting (about 3,000 at Capture & match PO) are the workers' polls and
completions stuck behind item creation, not a lack of workers. That starves everyone
downstream. The 14 items at the clerk review don't mean people kept up: in the 1-server run all
570 `my/next` calls found nothing, and only 223 releases happened. The clerks had little to do
because the work never got past Capture & match PO.

### Cheap fixes to try before per-item locking

- Serve reads from the committed cache instead of queuing them behind commands. *Done.*
- Compute one stream view per change per application, shared by every open stream. *Done.*
- Track the items a command changes instead of cloning the whole state and diffing it. *Done as a
  cheap copy and a cheaper diff; see Speed-ups.*
- Stringify outside the row lock, and compress `app_state.state` (lz4). *lz4 done, and json instead
  of jsonb, the bigger win. Stringifying outside the lock only helps several servers; writing only
  what changed (next) helps both.*
- Apply the other server's changes instead of reloading the whole state. *Comes with writing only
  what changed.*

### Speed-ups (2026-10-18)

Done on `feat/speed-ups`, each measured with the bench at 3,500 items:

- Reads answer from the committed state at once instead of queuing behind commands.
- One view per committed state, shared by every stream, the overview and the Monitor (~32 ms → 1.1 ms
  per change with 100 streams).
- Commands run on `copyState`, which copies what the engine changes in place and shares what it
  only adds (29 ms → 1.7 ms). A test freezes each state before the next command runs on its copy.
- `changesBetween` compares tokens in place and builds output only for what moved (8 ms → 1.3 ms).
- The state column is `json` with lz4, not `jsonb` (migration 0004). The Postgres write turned out
  to be the biggest cost of all: 140 ms per command at 3,500 items, 90 ms of it Postgres parsing
  the 3.4 MB into jsonb. As json: 50 ms, of which ~45 ms is sending 3.4 MB at all. Reading it
  back: 73 → 35 ms.

Three `baseline` runs, 1 server, back to back on the same machine (10 CPUs, 8 GB for Docker):

| | main (604ea2e) | copy (17e1e97) | json (81dae4e) |
| --- | ---: | ---: | ---: |
| Requests | 10.9/s | 19.3/s | 31.5/s |
| Items created (10/s offered) | 2,136 | 3,476 | 4,890 |
| Item arrivals k6 couldn't start | 2,858 | 2,322 | 971 |
| Reads p95 | 60 s (timeouts) | 25 ms | 31 ms |
| Changes p95 | 60 s (timeouts) | 52.4 s | 31.0 s |
| Errors | 19.0% | 0.85% | 0.00% |
| Releases | 173 | 289 | 636 |
| Service jobs completed | 724 | 1,230 | 2,431 |
| Webhook lag p95 | 379 ms | 216 ms | 176 ms |

This main run did worse than the 10-13 one (12.6/s, 0.31% errors): same code, a busier machine,
which is why only back-to-back runs are compared. Commands answered per second, by minute:

| Minute | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main | 29.3 | 10.8 | 9.4 | 6.8 | 6.2 | 4.8 | – | – | – | – |
| json | 55.2 | 32.9 | 24.2 | 18.6 | 14.3 | 13.9 | 12.9 | 11.3 | 10.7 | 9.6 |

(main's server logged nothing after minute 6: every request after that timed out.) It's still
falling as items pile up: a command still costs time in proportion to the whole state. Per
command at 3,500 items: about 17 ms in the engine (11 ms of it stringifying the state for the
write) and about 50 ms writing 3.4 MB to Postgres. Releases racing (3.2%, over the 2% soft limit)
come with the clerks getting far more work through; worth watching, not a fault.

Next: write only what a command changed. With `copyState` an item changed exactly when its copy
differs from its original at the levels the copy made, a cheap check. Storing items as their own
rows beside a small application row would make the write, and another server's reload, cost what
changed instead of the whole state. That changes the storage layout, so it gets its own design.

### Harness faults found first

An earlier pair of runs found two harness faults, fixed before these: the end-of-run backlog
read timed out behind the queue, and nginx took both servers out of rotation after a few
timeouts and answered 502 itself (10.9% errors on two servers).

## Testing the harness

`smoke` must finish with near-zero errors. Unit tests for the design generator, the summary and the
compare. Not in GitHub CI (shared runners give meaningless numbers).

## Docs

`tools/load/README.md`; pointers from DEPLOYMENT and ROADMAP.
