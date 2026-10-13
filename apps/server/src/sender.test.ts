import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { newSim, type OutboxMessage } from '@modus-bpm/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './adapters/memory'
import type { Storage } from './ports'
import { Sender, type SenderOptions } from './sender'
import { type Endpoint, GIVE_UP_AFTER_MS, verify } from './webhooks'

interface Seen {
  url: string
  headers: IncomingMessage['headers']
  body: string
}

/** A real local HTTP server, so the request goes over the wire; `handle` answers each request. */
async function listen(handle: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void) {
  const seen: Seen[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c: string) => (body += c))
    req.on('end', () => {
      const s = { url: req.url!, headers: req.headers, body }
      seen.push(s)
      handle(req, res, s)
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  servers.push(server)
  return { seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}
let servers: Server[] = []

const SECRET = 'a-secret-of-at-least-16'
const answer =
  (status: number, headers: Record<string, string> = {}, body = '') =>
  (_: IncomingMessage, res: ServerResponse) =>
    res.writeHead(status, headers).end(body)

let storage: Storage
let version: number
let now: number
let logged: Array<[string, string, object | undefined]>
let senders: Sender[]

beforeEach(() => {
  storage = memoryStorage()
  version = 0
  // Messages get a real wall-clock createdAt at commit; the fake clock must not run behind it.
  now = Date.now() + 60_000
  logged = []
  senders = []
})

afterEach(async () => {
  await Promise.all(senders.map((s) => s.stop()))
  for (const s of servers) {
    s.closeAllConnections()
    await new Promise((ok) => s.close(ok))
  }
  servers = []
  vi.useRealTimers()
})

function sender(endpoints: Endpoint[], opts: Partial<SenderOptions> = {}) {
  const s = new Sender({ storage, endpoints, now: () => now, log: (level, msg, extra) => logged.push([level, msg, extra]), ...opts })
  senders.push(s)
  return s
}

async function commit(...outbox: OutboxMessage[]) {
  const r = await storage.transact('app_a', version, () => ({ value: 0, write: { state: newSim('app_a', 1), entries: [], items: [], outbox, tickedAt: 0 } }))
  version = r.version
}
const msg = (kind: OutboxMessage['kind'] = 'job.ready', itemId = 'i1'): OutboxMessage => ({ itemId, kind, payload: { itemId, n: 1 } })
const only = async () => {
  const all = await storage.deliveries.list({})
  expect(all).toHaveLength(1)
  return all[0]!
}

describe('Sender', () => {
  it('delivers a committed message once, in the documented format, signed', async () => {
    const hook = await listen(answer(204))
    const s = sender([{ name: 'ops', url: `${hook.url}/in`, secret: SECRET }])
    await commit(msg('notify'))
    await s.wake()
    await s.wake()

    expect(hook.seen).toHaveLength(1)
    const [req] = hook.seen
    const body = JSON.parse(req!.body)
    const [m] = await storage.deliveries.list({})
    expect(body).toEqual({ id: m!.outboxId, kind: 'notify', appId: 'app_a', itemId: 'i1', createdAt: new Date(m!.createdAt).toISOString(), payload: { itemId: 'i1', n: 1 } })
    expect(req!.url).toBe('/in')
    expect(req!.headers['content-type']).toBe('application/json')
    expect(req!.headers['user-agent']).toBe('Modus-Webhooks/1')
    expect(req!.headers['modus-delivery']).toBe(String(m!.outboxId))
    expect(verify(SECRET, req!.body, req!.headers['modus-signature'] as string, now)).toBe(true)
    expect(m).toMatchObject({ status: 'delivered', attempts: 1, lastStatus: 204, deliveredAt: now })
    expect(await storage.projections.outbox('app_a')).toEqual([])
  })

  it('sends a message only to endpoints whose filters match', async () => {
    const all = await listen(answer(200))
    const notes = await listen(answer(200))
    const s = sender([
      { name: 'all', url: all.url, secret: SECRET },
      { name: 'notes', url: notes.url, secret: SECRET, kinds: ['notify'] },
    ])
    await commit(msg('job.ready'))
    await s.wake()
    expect(all.seen).toHaveLength(1)
    expect(notes.seen).toHaveLength(0)
    expect((await storage.deliveries.list({})).map((d) => d.endpoint)).toEqual(['all'])
  })

  it('retries a 5xx 10 s later, and delivers then', async () => {
    let status = 500
    const hook = await listen((_, res) => res.writeHead(status).end('down for a bit'))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    await s.wake()
    expect(await only()).toMatchObject({ status: 'pending', attempts: 1, nextAt: now + 10_000, lastStatus: 500, lastError: 'HTTP 500: down for a bit' })

    await s.wake() // not due yet
    expect(hook.seen).toHaveLength(1)
    now += 10_000
    status = 200
    await s.wake()
    expect(await only()).toMatchObject({ status: 'delivered', attempts: 2, lastStatus: 200 })
    expect(hook.seen).toHaveLength(2)
  })

  it('fails a 4xx at once, and says so', async () => {
    const hook = await listen(answer(400, {}, 'bad'))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    await s.wake()
    const d = await only()
    expect(d).toMatchObject({ status: 'failed', attempts: 1, lastStatus: 400, lastError: 'HTTP 400: bad' })
    expect(logged).toContainEqual(['warn', expect.stringContaining('gave up'), expect.objectContaining({ endpoint: 'ops', outboxId: d.outboxId, status: 400, error: 'HTTP 400: bad' })])
    expect(await storage.projections.outbox('app_a')).toEqual([])
  })

  it('gives up on an endpoint that keeps failing once the next try would be 24 h after the schedule started', async () => {
    const hook = await listen(answer(503))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    const start = now
    const at: number[] = []
    for (let i = 0; i < 100; i++) {
      at.push(now)
      await s.wake()
      const d = await only()
      if (d.status !== 'pending') break
      now = d.nextAt
    }
    const d = await only()
    expect(d).toMatchObject({ status: 'failed', lastStatus: 503, since: start })
    expect(hook.seen).toHaveLength(at.length)
    expect(d.attempts).toBe(at.length)
    // 10 s, 30 s, 2 min, 10 min, then hourly: the last try is the one whose next would land at or past 24 h.
    expect(at.slice(1, 5).map((t, i) => t - at[i]!)).toEqual([10_000, 30_000, 120_000, 600_000])
    expect(at.at(-1)! - start).toBeLessThan(GIVE_UP_AFTER_MS)
    expect(at.at(-1)! + 3_600_000).toBeGreaterThanOrEqual(start + GIVE_UP_AFTER_MS)
    expect(logged.filter(([level]) => level === 'warn')).toHaveLength(1)
  })

  it('honors a longer Retry-After', async () => {
    const hook = await listen(answer(429, { 'retry-after': '300' }))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    await s.wake()
    expect(await only()).toMatchObject({ status: 'pending', nextAt: now + 300_000, lastStatus: 429 })
  })

  it('does not follow a redirect: fails it', async () => {
    const target = await listen(answer(200))
    const hook = await listen(answer(301, { location: `${target.url}/elsewhere` }))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    await s.wake()
    expect(await only()).toMatchObject({ status: 'failed', lastStatus: 301, lastError: expect.stringContaining('redirects are not followed') })
    expect(hook.seen).toHaveLength(1)
    expect(target.seen).toHaveLength(0)
  })

  it('aborts a request that hangs past the timeout and retries it', async () => {
    const hook = await listen(() => {}) // never answers
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }], { timeoutMs: 50 })
    await commit(msg())
    await s.wake()
    expect(await only()).toMatchObject({ status: 'pending', attempts: 1, nextAt: now + 10_000, lastError: expect.stringMatching(/timeout|abort/i) })
    expect((await only()).lastStatus).toBeUndefined()
  })

  it('fails deliveries to an endpoint no longer configured', async () => {
    const hook = await listen(answer(200))
    const before = sender([{ name: 'gone', url: hook.url, secret: SECRET }])
    await commit(msg())
    await storage.deliveries.fanOut(() => ['gone'], now, 100)
    await before.stop()
    const after = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await after.wake()
    expect(await only()).toMatchObject({ endpoint: 'gone', status: 'failed', attempts: 1, lastError: 'endpoint no longer configured' })
    expect(hook.seen).toHaveLength(0)
  })

  it('marks messages skipped with no endpoints', async () => {
    const s = sender([])
    await commit(msg())
    await s.wake()
    expect(await storage.projections.outbox('app_a')).toEqual([])
    expect(await storage.deliveries.list({})).toEqual([])
  })

  it('with no endpoints left, still settles pending deliveries to removed ones as failed', async () => {
    await commit(msg())
    await storage.deliveries.fanOut(() => ['gone'], now, 100)
    const s = sender([])
    await s.wake()
    expect(await only()).toMatchObject({ endpoint: 'gone', status: 'failed', lastError: 'endpoint no longer configured' })
    expect(await storage.projections.outbox('app_a')).toEqual([])
  })

  it('refuses a lease that would not outlast two timeouts', () => {
    expect(() => new Sender({ storage, endpoints: [], leaseMs: 20_000, timeoutMs: 10_000 })).toThrow(/leaseMs/)
    expect(() => new Sender({ storage, endpoints: [], leaseMs: 20_001, timeoutMs: 10_000 })).not.toThrow()
  })

  it('warns with a short error; storage keeps the full one', async () => {
    const hook = await listen(answer(400, {}, 'x'.repeat(400)))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    await s.wake()
    expect((await only()).lastError).toBe(`HTTP 400: ${'x'.repeat(400)}`)
    const [, , extra] = logged.find(([level]) => level === 'warn')!
    expect(extra).toMatchObject({ status: 400 })
    expect((extra as { error: string }).error.length).toBeLessThanOrEqual(101)
  })

  it('survives a log function that throws', async () => {
    const hook = await listen(answer(400))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }], {
      log: () => {
        throw new Error('log broke')
      },
    })
    await commit(msg())
    await expect(s.wake()).resolves.toBeUndefined()
    expect(await only()).toMatchObject({ status: 'failed' })
  })

  it('reads only the head of an endless error body, in time, and lets the connection go', async () => {
    let closed = false
    const hook = await listen((_, res) => {
      res.socket!.on('close', () => (closed = true))
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.write('y'.repeat(1024 * 1024)) // ~1 MB, and the body never ends
    })
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }], { timeoutMs: 2000 })
    await commit(msg())
    const started = performance.now()
    await s.wake()
    expect(performance.now() - started).toBeLessThan(2000)
    const d = await only()
    expect(d).toMatchObject({ status: 'pending', lastStatus: 500, lastError: expect.stringMatching(/^HTTP 500: y+$/) })
    expect(d.lastError!.length).toBeLessThanOrEqual(500)
    await vi.waitFor(() => expect(closed).toBe(true))
  })

  it('stop() drops a queued round', async () => {
    let release!: () => void
    const gate = new Promise<void>((ok) => (release = ok))
    const fetch = vi.fn(async () => {
      await gate
      return new Response(null, { status: 200 })
    })
    const claim = vi.spyOn(storage.deliveries, 'claim')
    const s = sender([{ name: 'ops', url: 'http://127.0.0.1:1/', secret: SECRET }], { fetch })
    await commit(msg())
    const first = s.wake()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const queued = s.wake()
    const stopped = s.stop()
    release()
    await Promise.all([first, queued, stopped])
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('drops a result when another server took the delivery over', async () => {
    const hook = await listen(answer(200))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    vi.spyOn(storage.deliveries, 'record').mockResolvedValueOnce(false)
    await s.wake()
    expect(logged.filter(([level]) => level !== 'debug')).toEqual([])
    expect(logged).toContainEqual(['debug', expect.any(String), expect.objectContaining({ endpoint: 'ops' })])
  })

  it('coalesces wakes: one round in flight plus one queued', async () => {
    let release!: () => void
    const gate = new Promise<void>((ok) => (release = ok))
    const fetch = vi.fn(async () => {
      await gate
      return new Response(null, { status: 200 })
    })
    const claim = vi.spyOn(storage.deliveries, 'claim')
    const s = sender([{ name: 'ops', url: 'http://127.0.0.1:1/', secret: SECRET }], { fetch })
    await commit(msg())
    const first = s.wake()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const queued = [s.wake(), s.wake(), s.wake()]
    expect(queued[0]).toBe(queued[1])
    release()
    await Promise.all([first, ...queued])
    expect(claim).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('logs a failed round and keeps going', async () => {
    vi.spyOn(storage.deliveries, 'claim').mockRejectedValueOnce(new Error('storage down'))
    const hook = await listen(answer(200))
    const s = sender([{ name: 'ops', url: hook.url, secret: SECRET }])
    await commit(msg())
    await expect(s.wake()).resolves.toBeUndefined()
    expect(logged).toContainEqual(['error', expect.any(String), expect.objectContaining({ error: expect.stringContaining('storage down') })])
    await s.wake()
    expect(hook.seen).toHaveLength(1)
  })

  it('wakes on its interval, and stop() leaves no timers behind', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }) // only what the sender uses: undici's pool sets its own timeouts
    const claim = vi.spyOn(storage.deliveries, 'claim')
    const s = sender([{ name: 'ops', url: 'http://127.0.0.1:1/', secret: SECRET }], { fetch: vi.fn(), intervalMs: 2000 })
    s.start()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(claim).toHaveBeenCalledTimes(1)
    await s.stop()
    expect(vi.getTimerCount()).toBe(0)
    await s.wake()
    expect(claim).toHaveBeenCalledTimes(1)
  })
})
