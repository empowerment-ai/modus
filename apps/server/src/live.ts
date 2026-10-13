import type { Writable } from 'node:stream'

/** What a change event shows besides the changed items: read fresh when the event is sent. */
export interface LiveSnapshot {
  clock: number
  counts: Record<string, number>
  active: unknown
}

/**
 * Change events for one live stream. While the client's buffer is full the changed item ids are
 * held (not written, so a slow client can't grow our memory without bound) and sent as one merged
 * event when it drains, with the counts as of then. Past `cap` held ids the event says
 * `items: null`: too much changed, refetch everything. A snapshot that fails is reported to
 * `onError` and its ids kept, to go out with the next change (changes come with every write and
 * with ticks, at most about once a second, so they wait about that long).
 */
export function liveChanges(out: Writable, snapshot: () => Promise<LiveSnapshot>, { cap = 1000, onError = () => {} }: { cap?: number; onError?: (err: unknown) => void } = {}) {
  const held = new Set<string>()
  let overflow = false
  let armed = false
  const closed = () => out.writableEnded || out.destroyed

  const write = (s: LiveSnapshot, items: string[] | null) => out.write(`event: change\ndata: ${JSON.stringify({ clock: s.clock, items, counts: s.counts, active: s.active })}\n\n`)

  function keep(items: string[] | null) {
    if (items === null) overflow = true
    if (!overflow) for (const id of items!) held.add(id)
    if (held.size > cap) overflow = true
    if (overflow) held.clear()
  }

  /** The kept ids, plus `items`, as one event's list; nothing is kept afterwards. */
  function take(items: string[] = []) {
    keep(items)
    const all = overflow ? null : [...held].sort()
    held.clear()
    overflow = false
    return all
  }

  function hold(items: string[] | null) {
    keep(items)
    if (!armed) {
      armed = true
      out.once('drain', flush)
    }
  }

  function flush() {
    armed = false
    read(take(), (s) => s)
  }

  /** Reads the snapshot and sends `items` with it; on failure the ids wait for the next event. */
  function read(items: string[] | null, stamp: (s: LiveSnapshot) => LiveSnapshot) {
    // Through a promise, so a snapshot that throws before returning one is caught too.
    Promise.resolve()
      .then(snapshot)
      .then(
        (s) => send(stamp(s), items),
        (err) => {
          onError(err)
          if (closed()) return
          // Still behind: wait for the drain as usual. Caught up: no drain is coming, so the next change takes them.
          if (out.writableNeedDrain) hold(items)
          else keep(items)
        },
      )
  }

  function send(s: LiveSnapshot, items: string[] | null) {
    if (closed()) return
    // Filled up again between the check and the read: keep holding.
    if (out.writableNeedDrain) return hold(items)
    write(s, items)
  }

  return {
    /** One change: written now, or held while the client drains. `clock` is the change's own. */
    change(clock: number, items: string[]) {
      if (closed()) return
      // Skip the read too: the view isn't needed until the client catches up.
      if (out.writableNeedDrain || armed) return hold(items)
      read(held.size || overflow ? take(items) : items, (s) => ({ ...s, clock }))
    },
  }
}
