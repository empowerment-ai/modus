# Item rows: write only what a command changed

Status: proposed 2026-10-18. Follows the speed-ups in
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
- New `item_state (app_id, item_id, version bigint, ord bigserial, state json lz4)`, primary
  key `(app_id, item_id)`, index on `(app_id, version)`. One row per item: its `SimObject` as
  the engine keeps it. `version` is the application version of the commit that last wrote it.
  `ord` is assigned on first insert and never changes: loading `order by ord` rebuilds
  `objects` in the order the items were created. The engine iterates `objects` in places (ties
  in sorting, search), and every server must hold the same order.
- A command upserts the rows of the items it changed, in `objects` order, with the new version.

Rejected: putting the object into the `item` projection row. Projections are the read model M3
will query and may reshape, and they are written only for items whose projected fields moved.
The state row is the engine's private format, written whenever anything in the item changed (a
worker's lease, say). Keeping them apart keeps both simple.

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

- `Write` gains `changed: Id[]`: the items whose state rows to write. `state` stays the whole
  `SimState` (adapters store what they need of it).
- `Stored.state` (handed over under the lock when another server committed since `known`) and
  `StateStore.load` give way to a delta: the application row as stored, plus the item rows with
  `version > known`, in `ord` order. `known = 0` is a full load. A core helper
  `withItems(base, rest, objects)` builds the new state: the stored rest, the base's objects with
  the newer ones replaced and the new ones appended. The cached state is never changed: the new
  `objects` map is a fresh copy of 3,500 references (well under 1 ms).
- `ChangeNotice` is unchanged. Hearing one, a server loads the delta since its cached version
  instead of the whole state. That covers "apply the other server's changes".

**Memory adapter.** It holds whole states in memory as now, keeps each item's last-written
version, and answers deltas the same way, so the contract suite checks both adapters alike.
With a data directory it still writes the whole state to `state-<app>.json`: it serves one
process, and per-item files would add little. Its JSON round trip of the whole state per write
becomes a round trip of the changed items.

## 4. Migration `0005_item_state`

Create `item_state`. For each `app_state` row with a state, insert one row per entry of
`state->'objects'` in stored order (`json_each ... with ordinality`, order preserved because the
column is `json` since 0004), with the row's version; then rewrite the state without `objects`.
In one transaction, like every migration. Down: fold the rows back into the state in `ord` order
and drop the table.

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
- Contract (memory and Postgres): a write stores only the changed rows; a full load and a delta
  rebuild the same state, key order included; a delta since an older version brings every item
  changed since; items that never changed keep their version.
- Runtime: two runtimes on one store, a random series of commands on both: after each, the
  incremental reload's state equals a full load's, as JSON.
- Migration: a database at 0004 with a whole state splits into rows and loads equal; down
  restores it.
- Load: `baseline` with 1 and 2 servers, back to back with the run before the change.

## 6. Expected effect

Per command at 3,500 items: about 6 ms of engine work, 1-4 ms to find the changed items, about
1 ms to stringify, and 7-10 ms in Postgres. Roughly 20 ms, against about 70 ms now, and
it barely grows with finished items. Two servers stop paying 35 ms per commit for each other's
reloads. The single row lock still allows one command at a time per application across servers;
that is what 4a, per-item locking, removes.

## Left for later

- Finished items in the hot state. `copyState`, `changedItems` and the diff still visit every
  item, finished ones included: O(all items) per command, a few ms per thousand items. Leaving
  finished items out of the in-memory state, loaded on demand, is a follow-up.
- `advance` scans every active token once per simulated minute; with `TIME_SCALE=60` that is
  once per real second per command. A due-time index would make it cheaper; also later.
- Per-item locking (4a) after M1's engine split.

## Open questions

1. A separate `item_state` table rather than state inside the `item` projection row
   (recommended above).
2. The memory adapter's snapshot files stay whole-state (recommended), or become per-item too.
