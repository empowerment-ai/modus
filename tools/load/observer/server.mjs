// @ts-check
// The load-test observer: receives Modus webhooks (checks signatures, records delivery lag) and holds
// live-screen SSE streams on each server, recording how far apart the servers show the same update.
// Plain Node 22, no dependencies, so the container is stock node:22-alpine with this file mounted.
//
//   POST /hook                                  a webhook delivery (Modus-Signature checked)
//   POST /streams/start { count, servers }      open `count` streams spread round-robin over `servers`
//   POST /streams/stop                          close them
//   GET  /stats                                 counters and lag percentiles
//   POST /reset                                 clear counters and samples (streams stay open)
//
// Webhook lag is the event's createdAt to its arrival here. It includes the sender's polling: a
// commit wakes the sender on its own server at once, but anything that misses that wake waits for
// the next round (every ~2 s), and failed deliveries wait for their retry.
//
// `received` counts deliveries with a good signature and a JSON body, each event id once;
// `duplicates` counts redeliveries of an id already received, apart from it.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

// ----- Signatures: copied from apps/server/src/webhooks.ts (`hmac`, `verify`); keep in step -----

/** @param {string} secret @param {number} t @param {string} body */
const hmac = (secret, t, body) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')

/** A `Modus-Signature` header for tests and hand checks. @param {string} secret @param {number} tSeconds @param {string} body */
export const signFor = (secret, tSeconds, body) => `t=${tSeconds},v1=${hmac(secret, tSeconds, body)}`

/**
 * True when `header` is `t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` and at most `toleranceMs` old.
 * @param {string} secret @param {string} body @param {unknown} header @param {number} now
 */
export function verify(secret, body, header, now, toleranceMs = 5 * 60_000) {
  if (typeof header !== 'string') return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const ts = parts.find(([k]) => k === 't')?.[1]
  if (!ts || !/^[1-9]\d*$/.test(ts)) return false
  const t = Number(ts)
  if (Math.abs(now - t * 1000) > toleranceMs) return false
  const expected = Buffer.from(hmac(secret, t, body), 'hex')
  return parts.some(([k, v]) => {
    if (k !== 'v1' || !v || !/^[0-9a-f]{64}$/.test(v)) return false
    return timingSafeEqual(Buffer.from(v, 'hex'), expected)
  })
}

// ----- Samples and percentiles -----

/** Nearest-rank percentile of an ascending array; null when empty. @param {number[]} sorted @param {number} p */
export function percentile(sorted, p) {
  if (!sorted.length) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null
}

/**
 * Lag samples with bounded memory: past `cap` values a reservoir keeps a uniform sample, so a long
 * run can't exhaust memory. Count and max stay exact.
 */
export class Samples {
  /** @param {number} cap @param {() => number} random */
  constructor(cap = 100_000, random = Math.random) {
    this.cap = cap
    this.random = random
    /** @type {number[]} */
    this.values = []
    this.count = 0
    this.max = -Infinity
  }

  /** @param {number} v */
  add(v) {
    this.count++
    if (v > this.max) this.max = v
    if (this.values.length < this.cap) this.values.push(v)
    else {
      const j = Math.floor(this.random() * this.count)
      if (j < this.cap) this.values[j] = v
    }
  }

  /** @param {number[]} [extra] values to include in this summary without keeping them */
  summary(extra = []) {
    const sorted = [...this.values, ...extra].sort((a, b) => a - b)
    // A loop, not Math.max(...extra): spreading a long array overflows the call stack.
    const max = extra.reduce((m, v) => (v > m ? v : m), this.max)
    return {
      count: this.count + extra.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: Number.isFinite(max) ? max : null,
    }
  }
}

/** A Set that forgets its oldest entries past `cap`, for "seen before?" over a long run. */
class RecentSet {
  /** @param {number} cap */
  constructor(cap) {
    this.cap = cap
    /** @type {Set<string>} */
    this.set = new Set()
  }

  /** True when `key` was already there. @param {string} key */
  addSeen(key) {
    if (this.set.has(key)) return true
    this.set.add(key)
    if (this.set.size > this.cap) this.set.delete(/** @type {string} */ (this.set.values().next().value))
    return false
  }
}

// ----- Server-Sent Events -----

/**
 * @typedef {{ event: string, data: string }} SSEEvent
 * An incremental parser per the SSE spec: lines end in CRLF, LF or CR; `:` lines are comments; an
 * event ends on a blank line; several `data` lines join with newlines; an event with no data is dropped.
 * @param {(e: SSEEvent) => void} onEvent
 */
export function sseParser(onEvent) {
  let buf = ''
  let event = ''
  /** @type {string[]} */
  let data = []
  /** @param {string} line */
  const line = (line) => {
    if (line === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n') })
      event = ''
      data = []
      return
    }
    if (line.startsWith(':')) return
    const i = line.indexOf(':')
    const field = i < 0 ? line : line.slice(0, i)
    let value = i < 0 ? '' : line.slice(i + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  /** @param {string} chunk */
  return (chunk) => {
    buf += chunk
    const re = /\r\n|\r|\n/g
    let start = 0
    let m
    while ((m = re.exec(buf))) {
      // A CR at the very end may be the first half of a CRLF split across chunks: wait for more.
      if (m[0] === '\r' && m.index === buf.length - 1) break
      line(buf.slice(start, m.index))
      start = m.index + m[0].length
    }
    buf = buf.slice(start)
  }
}

/** @param {number} ms @param {AbortSignal} signal */
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve(undefined)), { once: true })
  })

// ----- The observer -----

/**
 * @param {{
 *   secret: string,
 *   now?: () => number,
 *   streamPath?: string,
 *   backoffMs?: number,
 *   maxBackoffMs?: number,
 *   sampleCap?: number,
 *   settleMs?: number,
 *   idleMs?: number,
 * }} opts
 */
export function createObserver(opts) {
  const now = opts.now ?? Date.now
  const streamPath = opts.streamPath ?? '/api/apps/app_invoice/stream'
  const backoffMs = opts.backoffMs ?? 250
  const maxBackoffMs = opts.maxBackoffMs ?? 5_000
  const sampleCap = opts.sampleCap ?? 100_000
  // An item not seen on every server by then is settled with the servers that did show it.
  const settleMs = opts.settleMs ?? 30_000
  // The server pings a quiet stream every 25 s: 60 s of silence means a dead connection, not a quiet app.
  const idleMs = opts.idleMs ?? 60_000
  // Our own event loop: if it lags, our arrival times do too, and the lag numbers are suspect.
  const loopResolutionMs = 10
  const loop = monitorEventLoopDelay({ resolution: loopResolutionMs })
  loop.enable()

  /** @type {ReturnType<typeof fresh>} */
  let s = fresh()
  function fresh() {
    return {
      received: 0,
      duplicates: 0,
      badSignatures: 0,
      badBodies: 0,
      /** Deliveries stamped before the event was created: clocks disagree. Counted as 0 lag. */
      negative: 0,
      // 200k ids each keeps the observer well inside its 256 MB.
      hookIds: new RecentSet(200_000),
      hookLag: new Samples(sampleCap),
      reconnects: 0,
      events: 0,
      crossLag: new Samples(sampleCap),
      /** Settled after settleMs on at least two servers but not all. */
      incomplete: 0,
      /** Settled after settleMs seen on one server only. */
      unmatched: 0,
      /** First arrival per server for items still settling. @type {Map<string, { first: number, at: Map<string, number> }>} */
      pending: new Map(),
      /** Items already measured: only an item's first appearance counts. */
      measured: new RecentSet(200_000),
    }
  }

  let open = 0
  let serverCount = 0
  /** @type {AbortController | null} */
  let streams = null
  /** @type {Promise<void>[]} */
  let running = []

  /** @param {{ at: Map<string, number> }} p */
  const spread = (p) => {
    const times = [...p.at.values()]
    return Math.max(...times) - Math.min(...times)
  }

  /** Settle items past `settleMs`: measured if two servers showed them, else dropped. */
  function sweep() {
    const cutoff = now() - settleMs
    for (const [id, p] of s.pending) {
      // Map order is arrival order, so the first young entry ends the sweep.
      if (p.first > cutoff) break
      if (p.at.size >= 2) {
        s.crossLag.add(spread(p))
        s.incomplete++
      } else s.unmatched++
      s.pending.delete(id)
    }
  }

  /** @param {string} server @param {string} data */
  function onChange(server, data) {
    s.events++
    /** @type {{ items?: unknown }} */
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    // One server can't disagree with itself; `items: null` (too much changed) names nothing to compare.
    if (serverCount < 2 || !Array.isArray(msg.items)) return
    const t = now()
    for (const raw of msg.items) {
      const id = String(raw)
      let p = s.pending.get(id)
      if (!p) {
        if (s.measured.addSeen(id)) continue
        p = { first: t, at: new Map() }
        s.pending.set(id, p)
      }
      if (!p.at.has(server)) p.at.set(server, t)
      if (p.at.size >= serverCount) {
        s.crossLag.add(spread(p))
        s.pending.delete(id)
      }
    }
    sweep()
  }

  /** @param {string} base @param {AbortSignal} signal */
  async function runStream(base, signal) {
    const url = new URL(streamPath, base).href
    let wait = backoffMs
    while (!signal.aborted) {
      let counted = false
      // Per connection: stopped with the rest, or cut alone when it goes silent.
      const conn = new AbortController()
      /** @type {NodeJS.Timeout | undefined} */
      let idle
      const quiet = () => {
        clearTimeout(idle)
        idle = setTimeout(() => conn.abort(), idleMs)
      }
      try {
        quiet()
        const res = await fetch(url, { signal: AbortSignal.any([signal, conn.signal]), headers: { accept: 'text/event-stream' } })
        if (!res.ok || !res.body) {
          // An unread body holds the connection open.
          await res.body?.cancel()
          throw new Error(`stream answered ${res.status}`)
        }
        open++
        counted = true
        wait = backoffMs
        const feed = sseParser((e) => e.event === 'change' && onChange(base, e.data))
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          quiet()
          feed(decoder.decode(value, { stream: true }))
        }
      } catch {
        // Refused, reset, silent too long or stopped: reconnect below unless stopped.
      } finally {
        clearTimeout(idle)
        if (counted) open--
      }
      if (signal.aborted) break
      s.reconnects++
      await sleep(wait, signal)
      wait = Math.min(wait * 2, maxBackoffMs)
    }
  }

  // Start and stop run one at a time, so two quick starts can't leave both sets of streams open.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const serial = (fn) => {
    const next = queue.then(fn)
    queue = next.catch(() => {})
    return next
  }

  async function stopNow() {
    streams?.abort()
    streams = null
    await Promise.all(running)
    running = []
  }

  /** Open `count` streams spread round-robin over `servers`, replacing any open now. @param {string[]} servers @param {number} count */
  const startStreams = (servers, count) =>
    serial(async () => {
      await stopNow()
      serverCount = new Set(servers).size
      const ctl = new AbortController()
      streams = ctl
      running = Array.from({ length: count }, (_, i) => runStream(/** @type {string} */ (servers[i % servers.length]), ctl.signal))
    })

  const stopStreams = () => serial(stopNow)

  function stats() {
    sweep()
    // Items still settling but already on two servers count now; they stay pending for a later, fuller measure.
    const settling = [...s.pending.values()].filter((p) => p.at.size >= 2).map(spread)
    return {
      webhooks: {
        received: s.received,
        duplicates: s.duplicates,
        badSignatures: s.badSignatures,
        badBodies: s.badBodies,
        negative: s.negative,
        lag: s.hookLag.summary(),
      },
      streams: {
        open,
        servers: serverCount,
        reconnects: s.reconnects,
        events: s.events,
        // One server can't disagree with itself: not measured.
        crossServerLag: serverCount >= 2 ? s.crossLag.summary(settling) : null,
        incomplete: s.incomplete,
        unmatched: s.unmatched,
      },
      // The histogram's samples include its own timer interval; less that, it's the delay we added.
      observer: { eventLoopDelayP99Ms: loop.count ? Math.max(0, Math.round((loop.percentile(99) / 1e6 - loopResolutionMs) * 100) / 100) : null },
    }
  }

  function reset() {
    s = fresh()
    loop.reset()
  }

  /** @param {string} body @param {unknown} signature @returns {number} the status to answer */
  function hook(body, signature) {
    const t = now()
    if (!verify(opts.secret, body, signature, t)) {
      s.badSignatures++
      return 401
    }
    /** @type {{ id?: unknown, createdAt?: unknown } | null | undefined} */
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      msg = undefined
    }
    // null, a number or an array is valid JSON but no delivery.
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
      s.badBodies++
      return 400
    }
    if (s.hookIds.addSeen(String(msg.id))) {
      s.duplicates++
      return 204
    }
    s.received++
    const created = typeof msg.createdAt === 'string' ? Date.parse(msg.createdAt) : NaN
    if (Number.isFinite(created)) {
      const lag = t - created
      if (lag < 0) s.negative++
      s.hookLag.add(Math.max(0, lag))
    }
    return 204
  }

  /** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} [body] */
  const send = (res, status, body) => {
    if (body === undefined) return void res.writeHead(status).end()
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }

  const server = createServer((req, res) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      // Webhook bodies are small; anything this big is a mistake, not a delivery.
      if (size > 1_000_000) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const route = `${req.method} ${(req.url ?? '').split('?')[0]}`
      try {
        if (route === 'POST /hook') return send(res, hook(body, req.headers['modus-signature']))
        if (route === 'GET /stats') return send(res, 200, stats())
        if (route === 'POST /reset') return (reset(), send(res, 204))
        if (route === 'POST /streams/stop') return void stopStreams().then(() => send(res, 204))
        if (route === 'POST /streams/start') {
          const { count, servers } = JSON.parse(body || '{}')
          if (!Array.isArray(servers) || !servers.length || !servers.every((u) => typeof u === 'string' && URL.canParse(u)))
            return send(res, 400, { error: 'servers: a list of base URLs' })
          if (!Number.isInteger(count) || count < 1 || count > 10_000) return send(res, 400, { error: 'count: 1 to 10000' })
          return void startStreams(servers, count).then(() => send(res, 202, { count, servers }))
        }
        send(res, 404, { error: 'not found' })
      } catch (err) {
        send(res, 400, { error: err instanceof Error ? err.message : String(err) })
      }
    })
  })

  async function close() {
    loop.disable()
    await stopStreams()
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }

  return { server, stats, reset, startStreams, stopStreams, close }
}

// ----- Run directly: `node server.mjs` -----

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) {
    console.error('WEBHOOK_SECRET is required')
    process.exit(1)
  }
  const port = Number(process.env.PORT ?? 8791)
  const obs = createObserver({ secret })
  obs.server.listen(port, '0.0.0.0', () => console.log(`observer listening on :${port}`))
  for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT'])) process.on(sig, () => void obs.close().then(() => process.exit(0)))
}
