import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createObserver, percentile, Samples, sign, sseParser, type SSEEvent } from './server.mjs'

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
async function observer(opts: { settleMs?: number } = {}) {
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
  const server = createServer((req, res) => {
    connections++
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
  it('accepts a good signature and refuses a bad, stale or missing one', async () => {
    const { obs, base, clock } = await observer()
    const body = { id: 1, kind: 'item.created', appId: 'app_invoice', itemId: 'i1', createdAt: new Date(clock.t).toISOString(), payload: {} }
    const t = Math.floor(clock.t / 1000)
    expect((await deliver(base, body, sign(secret, t, JSON.stringify(body)))).status).toBe(204)
    expect((await deliver(base, body, sign('wrong', t, JSON.stringify(body)))).status).toBe(401)
    expect((await deliver(base, body, sign(secret, t - 600, JSON.stringify(body)))).status).toBe(401)
    expect((await deliver(base, body, null)).status).toBe(401)
    const { webhooks } = obs.stats()
    expect(webhooks).toMatchObject({ received: 1, duplicates: 0, badSignatures: 3 })
  })

  it('records lag from createdAt and counts a redelivery as a duplicate, not a second sample', async () => {
    const { obs, base, clock } = await observer()
    const created = clock.t
    const send = async (id: number) => {
      const body = JSON.stringify({ id, kind: 'item.created', appId: 'a', itemId: 'i', createdAt: new Date(created).toISOString(), payload: {} })
      const res = await fetch(`${base}/hook`, { method: 'POST', body, headers: { 'modus-signature': sign(secret, Math.floor(clock.t / 1000), body) } })
      expect(res.status).toBe(204)
    }
    clock.t = created + 1500
    await send(1)
    clock.t = created + 3000
    await send(2)
    await send(1)
    const { webhooks } = obs.stats()
    expect(webhooks).toMatchObject({ received: 3, duplicates: 1, badSignatures: 0 })
    expect(webhooks.lag).toEqual({ count: 2, p50: 1500, p95: 3000, p99: 3000, max: 3000 })

    await fetch(`${base}/reset`, { method: 'POST' })
    expect(obs.stats().webhooks).toMatchObject({ received: 0, duplicates: 0, lag: { count: 0, p50: null, max: null } })
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
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(1))
    clock.t = t0 + 100
    b.push(change(['x']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(2))
    // Two of three servers so far: shown, but still waiting on the third.
    expect(obs.stats().streams.crossServerLag).toMatchObject({ count: 1, max: 100 })
    clock.t = t0 + 2000
    // Settled with what it had; the item seen on one server only is dropped.
    expect(obs.stats().streams.crossServerLag).toMatchObject({ count: 1, max: 100 })
    c.push(change(['x']))
    await vi.waitFor(() => expect(obs.stats().streams.events).toBe(3))
    expect(obs.stats().streams.crossServerLag).toMatchObject({ count: 1, max: 100 })
  })
})
