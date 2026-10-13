import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { liveChanges, type LiveSnapshot } from './live'

// A real Writable with a tiny buffer whose consumer the test controls, so writableNeedDrain and
// 'drain' behave exactly as on a socket, without having to fill a kernel buffer.
function slowClient() {
  const written: string[] = []
  const waiting: Array<() => void> = []
  const out = new Writable({
    highWaterMark: 64,
    write(chunk, _enc, done) {
      written.push(String(chunk))
      waiting.push(done)
    },
  })
  return {
    out,
    /** The data of each change event written so far. */
    events: () => written.filter((w) => w.startsWith('event: change')).map((w) => JSON.parse(w.slice(w.indexOf('data: ') + 6))),
    /** The client reads everything queued. */
    async catchUp() {
      while (waiting.length) {
        waiting.shift()!()
        await new Promise((r) => setImmediate(r))
      }
    },
  }
}

const settle = () => new Promise((r) => setImmediate(r))

function snapshots() {
  let clock = 1
  return {
    tick: () => clock++,
    read: async (): Promise<LiveSnapshot> => ({ clock, counts: { s1: clock }, active: clock }),
  }
}

describe('live changes', () => {
  it('writes at once while the client keeps up', async () => {
    const c = slowClient()
    const live = liveChanges(c.out, snapshots().read)
    live.change(7, ['a'])
    await settle()
    expect(c.events()).toEqual([{ clock: 7, items: ['a'], counts: { s1: 1 }, active: 1 }])
  })

  it('holds changed ids while the client drains and sends them merged, with counts as of then', async () => {
    const c = slowClient()
    const snap = snapshots()
    const live = liveChanges(c.out, snap.read)
    live.change(1, ['first'])
    await settle()
    // The first event is past the 64-byte buffer: the client is now behind.
    expect(c.out.writableNeedDrain).toBe(true)
    live.change(2, ['c', 'b'])
    live.change(3, ['b', 'a'])
    await settle()
    expect(c.events()).toHaveLength(1)

    snap.tick()
    await c.catchUp()
    await settle()
    expect(c.events()).toEqual([
      { clock: 1, items: ['first'], counts: { s1: 1 }, active: 1 },
      { clock: 2, items: ['a', 'b', 'c'], counts: { s1: 2 }, active: 2 },
    ])
  })

  it('says items: null when too much changed while held', async () => {
    const c = slowClient()
    const live = liveChanges(c.out, snapshots().read, { cap: 3 })
    live.change(1, ['first'])
    await settle()
    live.change(2, ['a', 'b'])
    live.change(3, ['c', 'd'])
    // Later ids add nothing once the client must refetch everything anyway.
    live.change(4, ['e'])
    await c.catchUp()
    await settle()
    expect(c.events().map((e) => e.items)).toEqual([['first'], null])

    // Back to normal afterwards.
    await c.catchUp()
    live.change(5, ['f'])
    await settle()
    expect(c.events().map((e) => e.items)).toEqual([['first'], null, ['f']])
  })

  it('reports a failed read and sends its ids with the next event', async () => {
    const c = slowClient()
    const snap = snapshots()
    let fail = true
    const errors: unknown[] = []
    const live = liveChanges(c.out, () => (fail ? Promise.reject(new Error('boom')) : snap.read()), { onError: (e) => errors.push(e) })
    live.change(1, ['lost?'])
    await settle()
    expect(errors).toHaveLength(1)
    expect(c.events()).toEqual([])

    fail = false
    live.change(2, ['next'])
    await settle()
    expect(c.events().map((e) => e.items)).toEqual([['lost?', 'next']])
  })

  it('catches a snapshot that throws instead of rejecting', async () => {
    const c = slowClient()
    const errors: unknown[] = []
    const live = liveChanges(
      c.out,
      () => {
        throw new Error('sync')
      },
      { onError: (e) => errors.push(e) },
    )
    expect(() => live.change(1, ['a'])).not.toThrow()
    await settle()
    expect(errors).toHaveLength(1)
  })

  it('reports a failed read after a drain and keeps the held ids', async () => {
    const c = slowClient()
    const snap = snapshots()
    let fail = false
    const errors: unknown[] = []
    const live = liveChanges(c.out, () => (fail ? Promise.reject(new Error('boom')) : snap.read()), { onError: (e) => errors.push(e) })
    live.change(1, ['first'])
    await settle()
    live.change(2, ['held'])
    fail = true
    await c.catchUp()
    await settle()
    expect(errors).toHaveLength(1)
    expect(c.events().map((e) => e.items)).toEqual([['first']])

    // Not stuck waiting for a drain that won't come: the next change carries the held ids.
    fail = false
    live.change(3, ['later'])
    await settle()
    expect(c.events().map((e) => e.items)).toEqual([['first'], ['held', 'later']])
  })

  it('writes nothing once the stream has ended', async () => {
    const c = slowClient()
    const live = liveChanges(c.out, snapshots().read)
    live.change(1, ['first'])
    await settle()
    live.change(2, ['held'])
    c.out.destroy()
    await c.catchUp()
    live.change(3, ['late'])
    await settle()
    expect(c.events().map((e) => e.items)).toEqual([['first']])
  })
})
