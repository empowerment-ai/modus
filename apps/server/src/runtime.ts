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
}

export interface Change {
  appId: Id
  clock: number
  /** Items touched since the last change notice. */
  itemIds: Id[]
}

export class NotFound extends Error {}

export class Runtime {
  design!: Design
  private readonly sims = new Map<Id, SimState>()
  private readonly logged = new Map<string, number>()
  private readonly listeners = new Set<(c: Change) => void>()
  private readonly dirty = new Set<Id>()
  private timer?: ReturnType<typeof setInterval>
  private saver?: ReturnType<typeof setInterval>
  private lastTick = Date.now()
  private queue: Promise<unknown> = Promise.resolve()
  private stopping = false

  private constructor(private readonly opts: Required<Omit<RuntimeOptions, 'storage'>> & { storage: Storage }) {}

  static async create(options: RuntimeOptions): Promise<Runtime> {
    const rt = new Runtime({ timeScale: 1, tickMs: 1000, seedIfEmpty: true, ...options })
    const stored = await rt.opts.storage.designs.load()
    rt.design = stored ?? seedDesign()
    if (!stored && rt.opts.seedIfEmpty) await rt.opts.storage.designs.save(rt.design)
    for (const app of rt.design.apps) {
      const s = await rt.opts.storage.state.load(app.id)
      if (s) {
        rt.sims.set(app.id, s)
        for (const o of Object.values(s.objects)) rt.logged.set(`${app.id}:${o.id}`, o.history.length)
      }
    }
    return rt
  }

  /** Start the clock and periodic state snapshots. */
  start() {
    this.lastTick = Date.now()
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs)
    this.saver = setInterval(() => void this.persist(), 5000)
  }

  /** Loaded and not shutting down: the readiness probe. */
  get ready(): boolean {
    return !this.stopping
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    if (this.saver) clearInterval(this.saver)
    await this.queue
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
      const result = fn(sim, ctx)
      await this.flush(appId)
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

  /** Append new audit entries to the event log and tell listeners which items changed. */
  private async flush(appId: Id) {
    const sim = this.state(appId)
    const batch: LoggedEvent[] = []
    const touched: Id[] = []
    // The SQL adapters write events inside the command's transaction instead of scanning.
    for (const o of Object.values(sim.objects)) {
      const key = `${appId}:${o.id}`
      const done = this.logged.get(key) ?? 0
      if (o.history.length <= done) continue
      o.history.slice(done).forEach((e, i) => batch.push({ ...e, appId, itemId: o.id, itemNumber: o.number, seq: done + i + 1 }))
      this.logged.set(key, o.history.length)
      touched.push(o.id)
    }
    if (batch.length) {
      await this.opts.storage.events.append(batch)
      this.dirty.add(appId)
    }
    const change: Change = { appId, clock: sim.clock, itemIds: touched }
    for (const l of this.listeners) l(change)
  }

  private async persist() {
    for (const appId of [...this.dirty]) {
      this.dirty.delete(appId)
      await this.opts.storage.state.save(appId, this.state(appId))
    }
  }
}
