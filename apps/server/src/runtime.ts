// The runtime: the same engine the studio simulates with, run live. It owns the
// state of every application, serializes commands (one at a time per process —
// the in-memory stand-in for the per-item row lock a SQL adapter takes), moves
// the clock, writes every new audit entry to the event log, and tells listeners
// (the live stream) what changed.

import { advance, type Ctx, type Design, type Id, newSim, type SimState } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import type { LoggedEvent, Storage } from './ports'

export interface RuntimeOptions {
  storage: Storage
  /** Simulated minutes per real minute. 1 = real time; demos may run faster. */
  timeScale?: number
  /** How often the clock moves (timers, escalations, retries). */
  tickMs?: number
  /** Start from the sample design when storage has none. */
  seedIfEmpty?: boolean
  /** Background work (clock ticks, state snapshots) that failed, e.g. while the database is unreachable. It is retried. */
  onError?: (err: unknown, during: 'tick' | 'snapshot' | 'log') => void
}

export interface Change {
  appId: Id
  clock: number
  /** Items touched since the last change notice. */
  itemIds: Id[]
}

export class NotFound extends Error {}

/** Storage can't take writes right now (the HTTP layer answers 503). */
export class StorageUnavailable extends Error {}

export class Runtime {
  design!: Design
  private readonly sims = new Map<Id, SimState>()
  private readonly logged = new Map<string, number>()
  /** Positions the log holds beyond an item's history (after a crash lost recent state), per item. */
  private readonly offset = new Map<string, number>()
  /** What the log held per item at startup, for items the restored state no longer has. */
  private readonly positions = new Map<Id, Map<Id, number>>()
  private readonly listeners = new Set<(c: Change) => void>()
  private readonly dirty = new Set<Id>()
  private timer?: ReturnType<typeof setInterval>
  private saver?: ReturnType<typeof setInterval>
  private lastTick = Date.now()
  private queue: Promise<unknown> = Promise.resolve()
  private stopping = false
  private logBackoff = 0
  private logRetryAt = 0

  private constructor(private readonly opts: Required<Omit<RuntimeOptions, 'storage'>> & { storage: Storage }) {}

  static async create(options: RuntimeOptions): Promise<Runtime> {
    const rt = new Runtime({ timeScale: 1, tickMs: 1000, seedIfEmpty: true, onError: (err, during) => console.error(`Runtime ${during} failed:`, err), ...options })
    const stored = await rt.opts.storage.designs.load()
    rt.design = stored ?? seedDesign()
    if (!stored && rt.opts.seedIfEmpty) await rt.opts.storage.designs.save(rt.design)
    for (const app of rt.design.apps) {
      const s = await rt.opts.storage.state.load(app.id)
      // The state is snapshotted every few seconds but the log is written as things happen, so after a
      // crash the log can be ahead of the state (or, if the log failed, behind it). Line them up so new
      // entries never reuse a position the log already holds, which would refuse every change from then on.
      const logged = await rt.opts.storage.events.positions(app.id)
      rt.positions.set(app.id, logged)
      if (s) {
        rt.sims.set(app.id, s)
        for (const o of Object.values(s.objects)) {
          const key = `${app.id}:${o.id}`
          const inLog = logged.get(o.id) ?? 0
          // State ahead: log the entries the log is missing. Log ahead: number new entries after it.
          rt.logged.set(key, Math.min(o.history.length, inLog))
          rt.offset.set(key, Math.max(0, inLog - o.history.length))
        }
      }
    }
    return rt
  }

  /** Start the clock and periodic state snapshots. */
  start() {
    this.lastTick = Date.now()
    this.timer = setInterval(() => this.tick().catch((err) => this.opts.onError(err, 'tick')), this.opts.tickMs)
    this.saver = setInterval(() => this.persist().catch((err) => this.opts.onError(err, 'snapshot')), 5000)
  }

  /** Loaded and not shutting down: the readiness probe. */
  get ready(): boolean {
    return !this.stopping
  }

  /** Readiness of the storage behind the runtime: its name, and the error when it cannot be reached. */
  async checkStorage(): Promise<{ storage: string; error?: string }> {
    const { storage } = this.opts
    try {
      await storage.ping?.()
      return { storage: storage.name }
    } catch (err) {
      return { storage: storage.name, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    if (this.saver) clearInterval(this.saver)
    await this.queue
    // One last try for log entries held back by a failing log.
    for (const app of this.design.apps) await this.flush(app.id, true)
    await this.persist()
  }

  /** The engine context for an application, in live mode. */
  ctx(appId: Id): Ctx {
    const app = this.design.apps.find((a) => a.id === appId)
    if (!app) throw new NotFound(`No application “${appId}”`)
    return { app, users: this.design.users, groups: this.design.groups, services: this.design.services, live: true }
  }

  state(appId: Id): SimState {
    this.ctx(appId)
    let s = this.sims.get(appId)
    if (!s) {
      s = newSim(appId, Date.now() & 0x7fffffff)
      s.arrivals = false
      this.sims.set(appId, s)
    }
    return s
  }

  /** Run a command against one application's live state. Commands never interleave. */
  run<T>(appId: Id, fn: (sim: SimState, ctx: Ctx) => T): Promise<T> {
    const next = this.queue.then(async () => {
      const ctx = this.ctx(appId)
      const sim = this.state(appId)
      // Every change must reach the audit log: don't take a command while entries are still waiting to be written.
      if (!(await this.flush(appId, true))) throw new StorageUnavailable('Storage is unavailable, so changes can’t be recorded. Try again shortly.')
      const result = fn(sim, ctx)
      if (!(await this.flush(appId, true)))
        throw new StorageUnavailable('The change was made but its audit entries aren’t written yet; they will be as soon as storage is back. Further changes wait until then.')
      return result
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Read without changing anything (still ordered after pending commands). */
  read<T>(appId: Id, fn: (sim: SimState, ctx: Ctx) => T): Promise<T> {
    const next = this.queue.then(() => fn(this.state(appId), this.ctx(appId)))
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Move every application's clock by the real time elapsed. */
  tick(): Promise<void> {
    const now = Date.now()
    const minutes = ((now - this.lastTick) / 60_000) * this.opts.timeScale
    this.lastTick = now
    const next = this.queue.then(async () => {
      for (const app of this.design.apps) {
        const sim = this.state(app.id)
        advance(sim, this.ctx(app.id), minutes)
        await this.flush(app.id)
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  subscribe(listener: (c: Change) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Append new audit entries to the event log and tell listeners which items changed. True when
   * nothing is left unwritten. Commands always try (`now`); the clock backs off while the log fails.
   */
  private async flush(appId: Id, now = false): Promise<boolean> {
    const sim = this.state(appId)
    const batch: LoggedEvent[] = []
    const touched: Id[] = []
    const written = new Map<string, number>()
    // Later, the SQL adapters write events inside the command's transaction instead of scanning.
    for (const o of Object.values(sim.objects)) {
      const key = `${appId}:${o.id}`
      const done = this.logged.get(key) ?? 0
      if (o.history.length <= done) continue
      let off = this.offset.get(key)
      if (off === undefined) this.offset.set(key, (off = this.positions.get(appId)?.get(o.id) ?? 0))
      o.history.slice(done).forEach((e, i) => batch.push({ ...e, appId, itemId: o.id, itemNumber: o.number, seq: off + done + i + 1 }))
      written.set(key, o.history.length)
      touched.push(o.id)
    }
    if (batch.length) {
      // The state changed whether or not the log write succeeds, so the next snapshot saves it either way.
      this.dirty.add(appId)
      // Unwritten entries stay in the items' history (bounded by the state itself) and go out on the next
      // attempt; appends are idempotent, so a batch that partly landed can't wedge the log.
      let ok = false
      if (now || Date.now() >= this.logRetryAt) {
        try {
          await this.opts.storage.events.append(batch)
          for (const [key, n] of written) this.logged.set(key, n)
          this.logBackoff = 0
          this.logRetryAt = 0
          ok = true
        } catch (err) {
          this.logBackoff = Math.min(60_000, Math.max(1000, this.logBackoff * 2))
          this.logRetryAt = Date.now() + this.logBackoff
          this.opts.onError(err, 'log')
        }
      }
      if (!ok) return false
    }
    const change: Change = { appId, clock: sim.clock, itemIds: touched }
    for (const l of this.listeners) l(change)
    return true
  }

  private async persist() {
    for (const appId of [...this.dirty]) {
      this.dirty.delete(appId)
      try {
        await this.opts.storage.state.save(appId, this.state(appId))
      } catch (err) {
        // Try again on the next snapshot.
        this.dirty.add(appId)
        throw err
      }
    }
  }
}
