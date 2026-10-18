# Load tests

`pnpm load` runs a mixed load against 1-3 Modus servers on a throwaway Postgres on your machine,
lets you watch it, and saves a report you can compare with other runs. The numbers are for finding
bottlenecks and comparing before and after a change, not for sizing production.

Design: [docs/plans/2026-10-13-load-tests-design.md](../../docs/plans/2026-10-13-load-tests-design.md).

## What runs

A Compose project of its own, `modus-load`, on 127.0.0.1 only. It never touches the dev stack or
its database.

| Container | Limit | Port |
| --- | --- | --- |
| Postgres 18 (data in tmpfs, so in memory) | none | 5546 |
| `modus1`..`modus3`, built from the working tree | 1.5 CPU, 1 GB each | – |
| nginx, round robin over the servers | none | 8790 |
| observer: webhook receiver and live-screen streams | 0.5 CPU, 256 MB | 8791 |
| k6 (`grafana/k6`, started by the runner) | none | 5665 (dashboard) |

The servers run with `TIME_SCALE=60`, so timers, SLAs, escalations and the outbox fire during a
run. Each run starts from an empty database: the sample design plus generated clerks
(`u_load_0001`…), written before the servers start.

## Requirements

- Docker Desktop (or another Docker engine with Compose v2), Node 22, pnpm.
- Docker resources (Settings → Resources):
  - `smoke` and `baseline` with 1-2 servers: 4 CPUs and 6 GB should be enough (an estimate; the
    first runs used 10 CPUs and 8 GB).
  - 3 servers, or `full`: 8 CPUs and 8 GB or more. Three servers alone may take 4.5 CPUs and 3 GB;
    Postgres keeps its data in memory and grows with the run; k6 with 1,000 people needs a
    gigabyte or two of its own.
- The ports above free on 127.0.0.1.

The first run builds the image (a few minutes); later runs reuse Docker's cache.

## Running

From the repo root:

```bash
pnpm load                                 # smoke, 1 server (about 2 minutes all told)
pnpm load --profile baseline --servers 2  # about 12 minutes
pnpm load --profile full --servers 3      # about 25 minutes
pnpm load --profile baseline --keep       # leave the stack up afterwards to look around
```

| Profile | New items | People (clerks) | Service workers | Live screens | Length |
| --- | --- | --- | --- | --- | --- |
| `smoke` | 2/s | 10 | 2 | 10 | 1 min |
| `baseline` | 10/s | 100 | 4 | 100 | 10 min |
| `full` | 10 → 100/s over 15 min, then 5 min at 100/s | → 1,000 | 8 | 300 | 20 min |

`--servers 1|2|3` (default 1) sets how many servers sit behind nginx. People work the clerk
review: basket, queues, `my/next`, open, save, release with an outcome, thinking 2-8 s between
steps. Workers poll each service, wait as if calling it, and complete the job (about 5% fail on
purpose).

Each run writes `tools/load/results/<timestamp>-<profile>-<n>srv/` (git-ignored): `summary.md`,
`summary.json`, `dashboard.html` (the k6 dashboard, saved at the end), `k6.json`, and the logs of
the servers, nginx and the observer. Ctrl-C stops k6, leaves `INTERRUPTED` in the folder (a
failed run leaves `FAILED`) and tears the stack down; a cut-short run writes no report.

## Watching

- **k6 dashboard** at http://localhost:5665 while k6 runs: request rates, latency, VUs.
- **Studio** at http://localhost:8790, served by the servers through nginx. Open the Monitor: it
  starts on **Live** and shows the servers' state, not a simulation. Step counts move with every
  change on the live stream; the other panels (work in flight, activity, workload, the item
  explorer) refresh about once a second. It acts as the seed administrator, Avery Brooks
  (`u_avery`), as the run's own reads do. The Workspace still shows the Studio's in-browser
  simulation. Add `--keep` to look at the final state after the run; the badge then reads
  "Live · idle".
  Each open Monitor is one more live stream on top of the profile's (10 on smoke).
- `docker stats` for CPU and memory per container.

## Reading the report

`summary.md` has these sections:

- **Soft limits.** Reads p95 < 300 ms, changes p95 < 500 ms, errors < 1%, busy (503) < 2%,
  webhooks p95 within 5 s, cross-server updates p95 within 2 s, races < 2% of releases. They never
  fail a run; ⚠ marks what to look at. Reads are basket, queues and open; everything else changes
  something (`my/next` and a poll take work).
- **Throughput.** Requests per second, then p50/p95/p99/max, errors and busy answers per kind of
  request. Errors leave out the answers the script expects: 409 from `my/next`, save and release,
  410 from a job answer.
- **Script counters.** `busy` is 503s: a command waited 5 s for its application's lock and gave
  up. `races` is a save or release refused because the item moved on meanwhile (two people, or a
  timer, got there first). `jobs_gone` is a job finished, cancelled or re-leased before its worker
  answered. `next_empty` is a queue with nothing to take: quiet, or starved by a backlog upstream. `dropped_iterations` is item arrivals k6 could not start
  because every VU was busy: the offered rate was not reached, so the run measured less load than
  the profile asks for.
- **Webhooks.** Deliveries the observer received, duplicates, bad signatures, and the lag from
  the event's `createdAt` to its arrival. The lag includes the sender's polling (about every 2 s
  for anything that misses the wake-up on commit), so a p95 near 2 s is normal. The outbox counts
  are what was still pending or failed at the end.
- **Live screens.** The streams the observer held, events, reconnects, and with 2-3 servers the
  cross-server lag: how far apart the servers show the same update.
- **Backlog at the end.** Active items per step and waiting service jobs. Nobody plays the
  exception subflow (unmatched POs: about 30% of items have none) or the manager and Controller
  approvals (invoices over 1,000), so items pile up at those steps by design. Only a backlog at
  the AP clerk review or in waiting service jobs means the load outran the people or the workers.

A section the run could not measure (the observer down, one server for cross-server lag) says
"not measured" instead of a number.

When the servers fall behind, every change slows together: a server runs one application's
commands one at a time, in order, so a command waits behind the ones queued ahead of it. Reads
answer from the last committed state without waiting, so they slow only as far as the server's
one thread is busy. A request still unanswered after 60 s is k6's timeout and counts as an error.

## Comparing

```bash
pnpm load:compare tools/load/results/<run-a> tools/load/results/<run-b>
```

Prints the headline numbers side by side with the change, absolute and in percent, marked better
or worse. Compare runs of the same profile on the same machine: one server against two, or
before and after a change.

## Limits of laptop numbers

- Everything shares one machine: k6, Postgres, nginx and the servers compete for the same CPUs,
  so more servers can't scale the way separate machines would, and k6 itself can be the limit
  (watch `dropped_iterations`).
- Postgres runs in memory with no disk and no network hop, so database time is lower than in
  production.
- Docker Desktop's VM, other apps, thermal throttling and battery mode all move the numbers.
  Run the runs you compare back to back, plugged in, with little else open.
- Not in CI: shared runners give numbers that mean nothing.

## Cleaning up

A run tears its stack down unless you pass `--keep`. To check and to remove anything left:

```bash
docker compose -p modus-load ps -a
docker compose -p modus-load -f tools/load/compose.yml --profile s2 --profile s3 down -v --remove-orphans
docker rm -f modus-load-k6    # only if a k6 container was left behind
```

Results add up in `tools/load/results/`; delete old folders when you no longer need them. The
`modus-load:local` image stays for the next build; `docker image rm modus-load:local` removes it.
