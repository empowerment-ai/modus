# Item rows: write only what a command changed

Status: approved 2026-10-18, with both open questions decided the other way: item state lives in the `item` projection row, and the memory adapter's files are written per item too. Follows the speed-ups in
[2026-10-13-load-tests-design.md](2026-10-13-load-tests-design.md#speed-ups-2026-10-18). Comes
before per-item locking (4a), which still needs M1.

## Goal

Make a command's write, and another server's reload, cost what the command changed instead of
the whole application state. After the speed-ups, the full-state write is the largest cost a
command has left, and it grows with every item ever created.

## Where it stands

Every command writes the application's whole `SimState` as one `app_state.state` value, and every
other server reloads it whole after each commit. Measured at 3,500 items (state 3.41 MB):

| Per command | Now |
| --- | ---: |
| Engine work (copy, clock, command, diff, projections) | ~6 ms |
| `JSON.stringify` of the whole state | ~11 ms |
| Postgres write of 3.4 MB (`json`, lz4), of which ~45 ms just sending it | ~50 ms |
| Another server's reload: read and parse 3.4 MB | ~35 ms |

Items are 97% of it: 3.33 MB of `objects`, 0.7 KB per item at the median and 1.4 KB at p95. The
rest (counters, workloads, forks, cursors, feed, series, active ids) is about 85 KB. Items are
never removed from the state, so finished ones add to every write forever.

Measured on the test Postgres with the same 3,500 items stored the proposed way:

| | Now | Proposed |
| --- | ---: | ---: |
| Write: the application row plus the changed items (1-20), stringify included | ~61 ms | 7-10 ms |
| Another server's reload after one commit | ~35 ms | ~2 ms |
| Full load at startup (3,500 item rows) | ~35 ms | ~45 ms |

## 1. Storage layout

- `app_state.state` keeps everything except `objects`: the 85 KB, written by every command as
  now. Version, clock time and the row lock stay where they are.
- The `item` projection row gains `state json` (lz4), the item's `SimObject` as the engine
  keeps it, and `ord bigint`, the item's position in `objects`, with an index on
  `(app_id, version)`. `version` (already there) is the application version of the commit that
  last wrote the row. Items are never removed, so an item's position never changes: loading
  `order by ord` rebuilds `objects` in the same order. The engine iterates `objects` in places
  (ties in sorting, search), and every server must hold the same order.
- A command rewrites the rows of every item it changed: projection columns, state and work-item
  rows together. That is more items than today's projection writes, which covered only items
  whose projected fields moved; a worker's lease, say, now rewrites its item's rows too.

Considered: a separate `item_state` table, keeping the engine's private format apart from the
read model M3 will query. One row per item, written whole, is simpler to keep consistent.

## 2. Which items changed

`copyState` copies every item one level deep (the object, its data, tokens, passed steps,
history array, scope ends and version pins) and shares everything below, which the engine never
changes in place; the freeze test in `copy.test.ts` holds it to that. So an item changed exactly
when it is new, or its copy differs from its original at one of the copied levels by `===`: a
top-level field, a data key, a token field, a fork or call frame, a passed step, the history
length, a scope end or version pin. No serializing, no deep compare.

A pure core function, `changedItems(before, after): Id[]` in `state.ts` next to `copyState`.
A generic prototype takes 4.4 ms at 3,500 items; comparing an explicit list of fields should
bring it near 1 ms. `changesBetween` stays as it is: it reports what projections, the audit log
and the outbox need, a subset of this.

A false positive (a field set to an equal new object) only writes a row that didn't need it. A
false negative would lose a change, so the tests check the opposite way too (section 5).

## 3. The port

- `Write.items` becomes the projections of every changed item, in `objects` order; storage
  writes each one's state from `Write.state.objects`. `state` stays the whole `SimState`.
- `Stored.state` (handed over under the lock when another server committed since `known`) gives
  way to `Stored.changes`: the application row as stored, plus the items written after `known`,
  in `objects` order. `StateStore.since(appId, version)` returns the same outside a transaction;
  `StateStore.load` still returns the whole state (startup, tests). A core helper
  `withChanges(base, changes)` builds the new state: the stored rest, the base's objects with
  the newer ones replaced and the new ones appended. The cached state is never changed: the new
  `objects` map is a fresh copy of 3,500 references (well under 1 ms).
- `ChangeNotice` is unchanged. Hearing one, a server loads the delta since its cached version
  instead of the whole state. That covers "apply the other server's changes".

**Memory adapter.** It holds whole states in memory as now, keeps each item's last-written
version, and answers deltas the same way, so the contract suite checks both adapters alike. Its
JSON round trip of the whole state per write becomes a round trip of the rest and the changed
items. With a data directory it writes per item too: `state-<app>.jsonl`, one line per commit
with the version, clock time, the rest and the items it changed. A line is one append, so a
commit is on disk whole or (a torn last line) not at all. Once the lines since the last full one
add up to more than a full snapshot, the commit writes the file afresh as one full line instead.
Loading replays the lines. A data directory from before (`state-<app>.json` and
`meta-<app>.json`) loads as it did, and its first commit writes the new file in full and removes
the old ones. One file per item was considered: thousands of files, a rename each per change, and
no way to land one commit's items together.

## 4. Migration `0005_item_state`

Add `item.state` and `item.ord`. For each `app_state` row with a state, write every item's row
in full (projection, work-item rows, state, position, the row's version), then store the state
without `objects`. Every item: projections were written only for items whose projected fields
moved, and a database from before projections (0002) has none until the runtime backfills them,
which happens after migrations. So the migration projects each item itself, with the core's
`projectItem` and the stored design (the sample design when none is stored, as the runtime
does). In one transaction, like every migration. Down: fold the rows back into the state in `ord`
order and drop the columns.

Rolling upgrades: the chart rolls pods on Postgres, so old and new servers overlap. An old server
reads `app_state.state` whole and would find no items, and its commits write no item rows, so
its changes would be lost. Like the upgrade from before M2, this one needs the old pods stopped
first, once (`strategy: Recreate` for that upgrade); DEPLOYMENT.md gets the note. (0004 needed
nothing: old code writes and reads a `json` column just as it did `jsonb`.)

## 5. Errors and tests

**Errors.** Nothing new: the rows are written in the command's transaction, so a failure rolls
everything back and the cache stays as it was. A delta load that fails is retried like today's
reload (`onError(..., 'listen')`); a reconnect does a full load.

**Tests:**
- Core: `changedItems` never misses a change. In the copy test's random runs (simulated and
  live, versioned too), every item whose JSON differs between before and after is in the list,
  and it adds almost nothing else. Plus a breaking test per copied level, as for `copyState`.
- Contract (memory and Postgres): a write stores only the listed items; a full load and a delta
  rebuild the same state, key order included; a delta since an older version brings every item
  changed since; items that never changed keep their version.
- Runtime: two runtimes on one store, a random series of commands on both: after each, the
  incremental reload's state equals a full load's, as JSON.
- Migration: a database at 0004 with a whole state splits into rows and loads equal; one from
  before 0002 gets full projections from the migration; down restores the whole state.
- Memory files: replaying the log equals the state in memory; a torn last line is skipped; a
  compacted file loads the same; an old-format directory loads and converts.
- Load: `baseline` with 1 and 2 servers, back to back with the run before the change.

## 6. Expected effect

Per command at 3,500 items: about 6 ms of engine work, 1-4 ms to find the changed items, about
1 ms to stringify, and 7-10 ms in Postgres. Roughly 20 ms, against about 70 ms now, and
it barely grows with finished items. Two servers stop paying 35 ms per commit for each other's
reloads. The single row lock still allows one command at a time per application across servers;
that is what 4a, per-item locking, removes.

## Results (2026-10-18)

Four `baseline` runs back to back on the same machine (10 CPUs, 8 GB for Docker), main (d61ca79)
against this branch (fd74a78):

| | main, 1 server | item rows, 1 server | main, 2 servers | item rows, 2 servers |
| --- | ---: | ---: | ---: | ---: |
| Requests | 32.4/s | 68.6/s | 25.3/s | 69.3/s |
| Items created (10/s offered) | 4,959 | 5,787 | 3,951 | 5,803 |
| Item arrivals k6 couldn't start | 909 | 125 | 1,830 | 140 |
| Reads p95 | 33 ms | 24 ms | 57 ms | 23 ms |
| Changes p95 | 33.4 s | 11.6 s | 51.8 s | 13.4 s |
| Errors | 0.00% | 0.00% | 0.75% | 0.00% |
| Releases | 604 | 1,549 | 462 | 1,567 |
| Service jobs completed | 2,543 | 7,106 | 1,894 | 7,251 |
| Races (of releases) | 1.82% | 1.61% | 4.55% | 1.15% |
| Webhook lag p95 | 171 ms | 124 ms | 309 ms | 124 ms |
| Same update on both servers, p95 | – | – | 170 ms | 64 ms |

Commands answered per second, by minute (both servers together):

| Minute | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main, 1 server | 57.8 | 29.6 | 25.0 | 20.4 | 16.6 | 14.3 | 12.4 | 11.6 | 10.9 | 10.6 |
| item rows, 1 server | 75.5 | 85.2 | 73.5 | 51.6 | 37.8 | 30.1 | 25.6 | 22.4 | 19.9 | 17.6 |
| main, 2 servers | 55.1 | 24.2 | 18.4 | 15.5 | 12.6 | 10.2 | 8.9 | 7.5 | 6.3 | 5.9 |
| item rows, 2 servers | 71.3 | 83.0 | 77.5 | 58.4 | 41.2 | 31.1 | 26.7 | 19.0 | 16.8 | 19.6 |

About twice the work at every point of the run, and nearly all the offered items created. Two
servers no longer lose ground to one (they reloaded each other's whole state before), but they
don't add any either: commands still run one at a time per application, which is 4a's to fix.
The rate still falls as items pile up (4,800 active at the end, few finished, since nobody plays
the approvals and exceptions), so something per command still grows with the active items:
the copy, the comparisons, the clock's scans, and reads such as `my/next`. Next step there:
profile a server under load (`--cpu-prof`) before guessing.

## Left for later

- Finished items in the hot state. `copyState`, `changedItems` and the diff still visit every
  item, finished ones included: O(all items) per command, a few ms per thousand items. Leaving
  finished items out of the in-memory state, loaded on demand, is a follow-up.
- `advance` scans every active token once per simulated minute; with `TIME_SCALE=60` that is
  once per real second per command. A due-time index would make it cheaper; also later.
- Per-item locking (4a) after M1's engine split.
