import type { Attempt, Delivery, Storage } from './ports'
import { classify, type Endpoint, GIVE_UP_AFTER_MS, matches, type Outcome, retryDelay, sign } from './webhooks'

/** The outbox sender: fans messages out to webhook endpoints, claims due deliveries, POSTs them signed and records what came of it. */

export interface SenderOptions {
  storage: Storage
  endpoints: Endpoint[]
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch
  now?: () => number
  log?: (level: 'debug' | 'warn' | 'error', msg: string, extra?: object) => void
  intervalMs?: number
  leaseMs?: number
  timeoutMs?: number
  batch?: number
  keepMs?: number
  keepFailedMs?: number
}

const FAN_OUT = 100
const FAN_OUT_LOOPS = 5
const PRUNE_EVERY_MS = 60 * 60_000
const DAY = 24 * 60 * 60_000
/** classify keeps 500 characters; read a little more than that and drop the rest unread. */
const MAX_BODY = 2048

const defaultLog: NonNullable<SenderOptions['log']> = (level, msg, extra) => {
  if (level !== 'debug') console[level](msg, extra ?? '')
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export class Sender {
  private readonly storage: Storage
  private readonly byName: Map<string, Endpoint>
  private readonly route: (m: { appId: string; kind: string }) => string[]
  private readonly fetch: typeof fetch
  private readonly now: () => number
  private readonly log: NonNullable<SenderOptions['log']>
  private readonly intervalMs: number
  private readonly leaseMs: number
  private readonly timeoutMs: number
  private readonly batch: number
  private readonly keepMs: number
  private readonly keepFailedMs: number
  private timers: NodeJS.Timeout[] = []
  private running?: Promise<void>
  private queued?: Promise<void>
  private stopped = false

  constructor(opts: SenderOptions) {
    this.storage = opts.storage
    const endpoints = [...opts.endpoints]
    this.byName = new Map(endpoints.map((e) => [e.name, e]))
    this.route = (m) => endpoints.filter((e) => matches(e, m)).map((e) => e.name)
    this.fetch = opts.fetch ?? globalThis.fetch
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? defaultLog
    this.intervalMs = opts.intervalMs ?? 2000
    this.leaseMs = opts.leaseMs ?? 60_000
    this.timeoutMs = opts.timeoutMs ?? 10_000
    this.batch = opts.batch ?? 20
    this.keepMs = opts.keepMs ?? 7 * DAY
    this.keepFailedMs = opts.keepFailedMs ?? 30 * DAY
  }

  /** Wake every intervalMs (commits wake it sooner) and prune once an hour. Unref'd: they never keep the process alive. */
  start(): void {
    if (this.stopped || this.timers.length) return
    this.timers.push(setInterval(() => void this.wake(), this.intervalMs).unref())
    this.timers.push(setInterval(() => void this.prune(), PRUNE_EVERY_MS).unref())
  }

  /** Run one round now (fan out, claim, send, record); concurrent calls coalesce into one extra round. Never rejects. */
  wake(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    // The queued round starts after the one in flight, so it sees everything committed before this call.
    if (this.queued) return this.queued
    if (this.running) {
      this.queued = this.running.then(() => {
        this.queued = undefined
        return this.run()
      })
      return this.queued
    }
    return this.run()
  }

  /** Clears the timers and waits for the rounds in flight or queued. */
  async stop(): Promise<void> {
    this.stopped = true
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    await this.queued
    await this.running
  }

  private run(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    const p: Promise<void> = this.round()
      .catch((err) => {
        this.log('error', 'webhooks: round failed, retrying next round', { error: message(err) })
      })
      .finally(() => {
        if (this.running === p) this.running = undefined
      })
    this.running = p
    return p
  }

  private async round() {
    const { deliveries } = this.storage
    const now = this.now()
    for (let i = 0; i < FAN_OUT_LOOPS; i++) if ((await deliveries.fanOut(this.route, now, FAN_OUT)) < FAN_OUT) break
    // With no endpoints, fan-out marks everything skipped and nothing is ever pending.
    if (!this.byName.size) return
    const claimed = await deliveries.claim(now, this.leaseMs, this.batch)
    await Promise.all(claimed.map((d) => this.send(d)))
  }

  private async send(d: Delivery) {
    try {
      const e = this.byName.get(d.endpoint)
      if (!e) return await this.settle(d, { ok: false, retry: false, error: 'endpoint no longer configured' })
      const body = JSON.stringify({ id: d.outboxId, kind: d.kind, appId: d.appId, itemId: d.itemId, createdAt: new Date(d.createdAt).toISOString(), payload: d.payload })
      let outcome: Outcome
      let status: number | undefined
      try {
        const res = await this.fetch(e.url, {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json', 'user-agent': 'Modus-Webhooks/1', 'Modus-Signature': sign(e.secret, body, this.now()), 'Modus-Delivery': String(d.outboxId) },
          // 'manual', not 'error': undici throws on 'error', which classify would retry instead of failing. Node hands back the real 3xx.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        status = res.status
        // A body we don't keep still holds the connection until read or cancelled.
        const text = res.ok ? void (await res.body?.cancel().catch(() => {})) : await head(res).catch(() => undefined)
        outcome = classify({ status: res.status, headers: res.headers, text }, this.now())
      } catch (error) {
        outcome = classify({ error }, this.now())
      }
      await this.settle(d, outcome, status)
    } catch (err) {
      // Storage failed recording: the lease runs out and the delivery is tried again.
      this.log('error', 'webhooks: could not record a delivery', { endpoint: d.endpoint, outboxId: d.outboxId, error: message(err) })
    }
  }

  private async settle(d: Delivery, outcome: Outcome, status?: number) {
    const now = this.now()
    let result: Attempt
    if (outcome.ok) result = { status: 'delivered', lastStatus: status }
    else {
      const delay = Math.max(retryDelay(d.attempts), outcome.retryAfterMs ?? 0)
      // The schedule counts from `since` (fan-out or the last manual retry), not from when the message was written.
      result =
        outcome.retry && now + delay < d.since + GIVE_UP_AFTER_MS
          ? { status: 'pending', nextAt: now + delay, lastStatus: outcome.status, lastError: outcome.error }
          : { status: 'failed', lastStatus: outcome.status, lastError: outcome.error }
    }
    if (!(await this.storage.deliveries.record(d.outboxId, d.endpoint, d.nextAt, result, now))) {
      // Our lease ran out and another server took the delivery over; its result counts.
      return this.log('debug', 'webhooks: lease lost, result dropped', { endpoint: d.endpoint, outboxId: d.outboxId })
    }
    if (result.status === 'failed') this.log('warn', 'webhooks: gave up on a delivery', { endpoint: d.endpoint, outboxId: d.outboxId, status: result.lastStatus, error: result.lastError })
  }

  private async prune() {
    try {
      await this.storage.deliveries.prune(this.now(), this.keepMs, this.keepFailedMs)
    } catch (err) {
      this.log('error', 'webhooks: pruning failed', { error: message(err) })
    }
  }
}

/** The first MAX_BODY bytes of a response as text; the rest is never read. */
async function head(res: Response): Promise<string | undefined> {
  if (!res.body) return undefined
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (bytes < MAX_BODY) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.subarray(0, MAX_BODY - bytes)
      bytes += chunk.length
      text += decoder.decode(chunk, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text
}
