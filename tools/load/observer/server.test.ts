import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sign } from '@modus-bpm/server/src/webhooks'
import { createObserver, percentile, Samples, signFor, sseParser, type SSEEvent } from './server.mjs'

const secret = 'test-secret'
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

async function listen(server: import('node:http').Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** An observer on a free port, with a clock the test sets. */
async function observer(opts: { settleMs?: number; idleMs?: number } = {}) {
  const clock = { t: Date.UTC(2026, 9, 13, 12) }
  const obs = createObserver({ secret, now: () => clock.t, backoffMs: 20, maxBackoffMs: 50, ...opts })
  const base = await listen(obs.server)
  cleanup.push(() => obs.close())
  return { obs, base, clock }
}

/** A stand-in for a Modus server's live stream: every client gets what the test pushes. */
async function fakeSSE() {
  const clients = new Set<ServerResponse>()
  let connections = 0
  let refuse = 0
  const server = createServer((req, res) => {
    connections++
    if (refuse > 0) {
      refuse--
      return void res.writeHead(503).end('busy')
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(': connected\n\n')
    clients.add(res)
    req.on('close', () => clients.delete(res))
  })
  const base = await listen(server)
  cleanup.push(
    () =>
      new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections()
      }),
  )
  return {
    base,
    clients,
    connections: () => connections,
    /** Answer the next `n` connections with 503. */
    refuseNext: (n: number) => (refuse = n),
    push: (text: string) => clients.forEach((c) => c.write(text)),
    /** Cut every open stream, as a restart or a proxy timeout would. */
    drop: () => clients.forEach((c) => c.destroy()),
  }
}

const change = (items: string[]) => `event: change\ndata: ${JSON.stringify({ clock: 1, items, counts: {}, active: 0 })}\n\n`

async function deliver(base: string, body: object, header: string | null) {
  const text = JSON.stringify(body)
  return fetch(`${base}/hook`, {
    method: 'POST',
    body: text,
    headers: { 'content-type': 'application/json', ...(header === null ? {} : { 'modus-signature': header }) },
  })
}

describe('webhooks', () => {
  it('verifies what the server signs, and refuses a wrong, stale or missing signature', async () => {
    const { obs, base, clock } = await observer()
    const body = { id: 1, kind: 'item.created', appId: 'app_invoice', itemId: 'i1', createdAt: new Date(clock.t).toISOString(), payload: {} }
    const text = JSON.stringify(body)
    // The server's own sign, so the copied verify can't drift from it unnoticed.
    expect((await deliver(base, body, sign(secret, text, clock.t))).status).toBe(204)
    expect((await deliver(base, { ...body, id: 2 }, sign('wrong', JSON.stringify({ ...body, id: 2 }), clock.t))).status).toBe(401)
    expect((await deliver(base, { ...body, id: 3 }, sign(secret, JSON.stringify({ ...body, id: 3 }), clock.t - 600_000))).status).toBe(401)
    expect((await deliver(base, { ...body, id: 4 }, null)).status).toBe(401)
    // Signed but not JSON.
    const junk = await fetch(`${base}/hook`, { method: 'POST', body: 'nope', headers: { 'modus-signature': signFor(secret, Math.floor(clock.t / 1000), 'nope') } })
    expect(junk.status).toBe(400)
    // Signed JSON that isn't an object.
    for (const text of ['null', '42', '[1]']) {
      const res = await fetch(`${base}/hook`, { method: 'POST', body: text, headers: { 'modus-signature': signFor(secret, Math.floor(clock.t / 1000), text) } })
      expect(res.status).toBe(400)
    }
    expect(obs.stats().webhooks).toMatchObject({ received: 1, duplicates: 0, badSignatures: 3, badBodies: 4 })
  })

  it('records lag from createdAt and counts a redelivery as a duplicate, not a second sample', async () => {
    const { obs, base, clock } = await observer()
    const created = clock.t
    const send = async (id: number) => {
      const body = JSON.stringify({ id, kind: 'item.created', appId: 'a', itemId: 'i', createdAt: new Date(created).toISOString(), payload: {} })
      const res = await fetch(`${base}/hook`, { method: 'POST', body, headers: { 'modus-signature': signFor(secret, Math.floor(clock.t / 1000), body) } })
      expect(res.status).toBe(204)
    }
    clock.t = created + 1500
    await send(1)
    clock.t = created + 3000
    await send(2)
    await send(1)
    // Delivered before it was created: the clocks disagree, which should show, not vanish.
    clock.t = created - 200
    await send(3)
    const { webhooks } = obs.stats()
    // received counts each id once; the redelivery of 1 shows only under duplicates.
    expect(webhooks).toMatchObject({ received: 3, duplicates: 1, badSignatures: 0, negative: 1 })
    expect(webhooks.lag).toEqual({ count: 3, p50: 1500, p95: 3000, p99: 3000, max: 3000 })

    await fetch(`${base}/reset`, { method: 'POST' })
    expect(obs.stats().webhooks).toMatchObject({ received: 0, duplicates: 0, negative: 0, lag: { count: 0, p50: null, max: null } })
  })

  it('reports its own event-loop delay', async () => {
    const { obs } = await observer()
    await new Promise((r) => setTimeout(r, 50))
    expect(obs.stats().observer.eventLoopDelayP99Ms).toBeGreaterThanOrEqual(0)
  })
})

describe('percentiles', () => {
  it('uses nearest rank', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1)
    expect([50, 95, 99, 100].map((p) => percentile(v, p))).toEqual([50, 95, 99, 100])
    expect(percentile([7], 50)).toBe(7)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([], 50)).toBeNull()
  })

  it('keeps samples bounded while count and max stay exact', () => {
    const s = new Samples(10)
    for (let i = 1; i <= 1000; i++) s.add(i)
    expect(s.values).toHaveLength(10)
    expect(s.summary()).toMatchObject({ count: 1000, max: 1000 })
  })
})

describe('SSE parsing', () => {
  it('skips comments, joins data lines, and copes with any line ending split anywhere', () => {
    const events: SSEEvent[] = []
    const feed = sseParser((e) => events.push(e))
    const text = ': connected\n\nevent: change\ndata: {"a":\ndata: 1}\n\n: ping\r\n\r\ndata:plain\r\rid: 3\nevent: x\n\n'
    // One byte at a time: every split point, including between a CR and its LF.
    for (const ch of text) feed(ch)
    expect(events).toEqual([
      { event: 'change', data: '{"a":\n1}' },
      { event: 'message', data: 'plain' },
    ])
  })
})

describe('streams', () => {
  it('reads change events from a live stream and reconnects when it drops', async () => {
    const { obs } = await observer()
    const sse = await fakeSSE()
    await obs.startStreams([sse.base], 2)
    await vi.waitFor(() => expect(obs.stats().streams.open).toBe(2))
    sse.push(': ping\n\n')
    // A change event whose JSON spans two data lines.
    sse.push('event: change\ndata: {"clock":1,"items":["a"],\ndata: "counts":{},"active":0}\n\n')
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(2))

    sse.drop()
    await vi.waitFor(() => expect(sse.connections()).toBe(4))
    await vi.waitFor(() => expect(obs.stats().streams.open).toBe(2))
    sse.push(change(['b']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(4))
    expect(obs.stats().streams.reconnects).toBe(2)
    // One server: nothing to compare against.
    expect(obs.stats().streams.crossServerLag).toBeNull()

    await obs.stopStreams()
    expect(obs.stats().streams.open).toBe(0)
  })

  it('retries a refused stream and cuts one that goes silent', async () => {
    const { obs } = await observer({ idleMs: 150 })
    const sse = await fakeSSE()
    sse.refuseNext(1)
    await obs.startStreams([sse.base], 1)
    await vi.waitFor(() => expect(obs.stats().streams.open).toBe(1))
    expect(obs.stats().streams.reconnects).toBe(1)
    // The fake server never pings: after idleMs the observer gives up on it and reconnects.
    await vi.waitFor(() => expect(sse.connections()).toBeGreaterThanOrEqual(3), { timeout: 2000 })
    expect(obs.stats().streams.reconnects).toBeGreaterThanOrEqual(2)
  })

  it('runs overlapping starts one after the other', async () => {
    const { obs } = await observer()
    const sse = await fakeSSE()
    await Promise.all([obs.startStreams([sse.base], 3), obs.startStreams([sse.base], 2)])
    await vi.waitFor(() => expect(obs.stats().streams.open).toBe(2))
    await vi.waitFor(() => expect(sse.clients.size).toBe(2))
  })

  it('measures cross-server lag from each server’s first arrival of an item', async () => {
    const { obs, clock } = await observer()
    const a = await fakeSSE()
    const b = await fakeSSE()
    // Round-robin: two streams on each server.
    await obs.startStreams([a.base, b.base], 4)
    await vi.waitFor(() => expect(obs.stats().streams.open).toBe(4))
    expect(a.clients.size).toBe(2)

    const t0 = clock.t
    a.push(change(['x']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(2))
    clock.t = t0 + 250
    b.push(change(['x', 'y']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(4))
    // Later appearances of x don't count again; y waits for server a.
    clock.t = t0 + 900
    b.push(change(['x']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(6))
    expect(obs.stats().streams.crossServerLag).toEqual({ count: 1, p50: 250, p95: 250, p99: 250, max: 250 })

    clock.t = t0 + 1000
    a.push(change(['y']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(8))
    expect(obs.stats().streams.crossServerLag).toMatchObject({ count: 2, p50: 250, max: 750 })
  })

  it('settles an item seen on only some servers once it is old enough', async () => {
    const { obs, clock } = await observer({ settleMs: 1000 })
    const [a, b, c] = [await fakeSSE(), await fakeSSE(), await fakeSSE()]
    await obs.startStreams([a.base, b.base, c.base], 3)
    await vi.waitFor(() => expect(obs.stats().streams.open).toBe(3))
    const t0 = clock.t
    a.push(change(['x', 'lonely']))
    a.push(change(['y']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(2))
    clock.t = t0 + 100
    b.push(change(['x', 'y']))
    c.push(change(['y']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(4))
    // y is on all three; x on two of three so far: shown, but still waiting on the third.
    expect(obs.stats().streams).toMatchObject({ crossServerLag: { count: 2, max: 100 }, incomplete: 0, unmatched: 0 })
    clock.t = t0 + 2000
    // Settled with what they had: x incomplete, the item seen on one server unmatched.
    expect(obs.stats().streams).toMatchObject({ crossServerLag: { count: 2, max: 100 }, incomplete: 1, unmatched: 1 })
    c.push(change(['x']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(5))
    expect(obs.stats().streams).toMatchObject({ crossServerLag: { count: 2, max: 100 }, incomplete: 1, unmatched: 1 })
  })
})
