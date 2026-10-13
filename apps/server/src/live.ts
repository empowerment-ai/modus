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
 * `items: null`: too much changed, refetch everything.
 */
export function liveChanges(out: Writable, snapshot: () => Promise<LiveSnapshot>, cap = 1000) {
  const held = new Set<string>()
  let overflow = false
  let armed = false
  const closed = () => out.writableEnded || out.destroyed

  const write = (s: LiveSnapshot, items: string[] | null) =>
    out.write(`event: change\ndata: ${JSON.stringify({ clock: s.clock, items, counts: s.counts, active: s.active })}\n\n`)

  function hold(items: string[] | null) {
    if (items === null) overflow = true
    if (!overflow) for (const id of items!) held.add(id)
    if (held.size > cap) overflow = true
    if (overflow) held.clear()
    if (!armed) {
      armed = true
      out.once('drain', flush)
    }
  }

  function flush() {
    armed = false
    const items = overflow ? null : [...held].sort()
    held.clear()
    overflow = false
    void snapshot().then((s) => send(s, items))
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
      void snapshot().then((s) => send({ ...s, clock }, items))
    },
  }
}
