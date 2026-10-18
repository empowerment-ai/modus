// The runtime: the same engine the studio simulates with, run live. Every command
// runs in one storage transaction: under the application's row lock it catches the
// clock up, runs on a copy of the state, and commits the state with the audit
// entries, projections and outbox messages that changed. The cached state is
// replaced only after a commit, so a failed command or commit leaves it as it was.
// Commands run one at a time per application within a process (a queue per
// application) and under the row lock across processes. Replicas hear each
// other's commits through the storage's change notices, and one replica per
// application, the holder of its clock lock, moves the clock.

import { randomUUID } from 'node:crypto'
import { advance, buildIndex, changesBetween, type Ctx, type Design, type Id, newSim, projectItem, type ProjectedItem, type SimState } from '@modus-bpm/core'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { type ChangeNotice, type Deliveries, type Storage, StorageBusy } from './ports'

export interface RuntimeOptions {
  storage: Storage
  /** Simulated minutes per real minute. 1 = real time; demos may run faster. */
  timeScale?: number
  /** How often the clock moves (timers, escalations, retries). */
  tickMs?: number
  /** Start from the sample design when storage has none. */
  seedIfEmpty?: boolean
  /**
   * Background work that failed: a clock tick or reloading another server's change (both retried), or a
   * subscriber that threw on a change (not retried; the change stands).
   */
  onError?: (err: unknown, during: 'tick' | 'listen' | 'subscriber') => void
}

export interface Change {
  appId: Id
  clock: number
  /** Items touched by this change. */
  itemIds: Id[]
}

export class NotFound extends Error {}

/** Storage can't take writes right now (the HTTP layer answers 503). */
export class StorageUnavailable extends Error {}

/** An application's state as of a committed version. Never mutated: commands run on a copy. */
interface Cached {
  version: number
  sim: SimState
  /** Wall time (epoch ms) `sim.clock` corresponds to. Absent: never ticked. */
  tickedAt?: number
}

/** Items that differ between two committed states (both left unchanged). */
const moved = (before: SimState, after: SimState) => changesBetween(before, after).itemIds

/** A tick that logged nothing and comes this soon after the last stored clock time is rolled back. */
const IDLE_TICK_MS = 30_000

export class Runtime {
  design!: Design
  private readonly cache = new Map<Id, Cached>()
  private readonly queues = new Map<Id, Promise<unknown>>()
  private readonly listeners = new Set<(c: Change) => void>()
  /** Who holds this runtime's clock locks (the memory adapter tells runtimes on one store apart by it). */
  private readonly owner = randomUUID()
  private timer?: ReturnType<typeof setInterval>
  private ticking?: Promise<void>
  private unlisten?: () => Promise<void>
  private stopping = false

  private constructor(private readonly opts: Required<Omit<RuntimeOptions, 'storage'>> & { storage: Storage }) {}

  static async create(options: RuntimeOptions): Promise<Runtime> {
    const rt = new Runtime({ timeScale: 1, tickMs: 1000, seedIfEmpty: true, onError: (err, during) => console.error(`Runtime ${during} failed:`, err), ...options })
    const { storage } = rt.opts
    const stored = await storage.designs.load()
    rt.design = stored ?? seedDesign()
    if (!stored && rt.opts.seedIfEmpty) await storage.designs.save(rt.design)
    // Listen before loading, so a commit another server makes meanwhile isn't missed.
    rt.unlisten = await storage.listen(
      (n) => void rt.heard(n),
      () => void rt.reloadAll(),
    )
    try {
      for (const app of rt.design.apps) {
        // In the application's queue, so a reload heard meanwhile runs before or after, not during.
        await rt.serial(app.id, async () => {
          const s = await storage.state.load(app.id)
          if (!s?.state) return
          rt.adopt(app.id, { version: s.version, sim: s.state, tickedAt: s.tickedAt })
          // Projections arrived after this state was first written: fill them in once.
          if (Object.keys(s.state.objects).length && !(await storage.projections.any(app.id))) await rt.backfill(app.id)
        })
      }
    } catch (err) {
      await rt.stop().catch(() => undefined)
      throw err
    }
    return rt
  }

  /** Start the clock. */
  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      // A slow tick (a busy database) isn't overlapped by the next one.
      if (!this.ticking) this.ticking = this.tick().finally(() => (this.ticking = undefined))
    }, this.opts.tickMs)
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
    } catch (err) {
      return { storage: storage.name, error: err instanceof Error ? err.message : String(err) }
    }
    // Without change notices this replica's cache goes stale; another may serve instead.
    if (storage.listening && !storage.listening()) return { storage: storage.name, error: 'Storage is reachable but this server is not receiving other servers’ changes.' }
    return { storage: storage.name }
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.ticking
    // A reload heard meanwhile can queue more work: wait until every queue is quiet.
    for (;;) {
      const tail = [...this.queues.values()]
      await Promise.all(tail)
      if ([...this.queues.values()].every((q, i) => q === tail[i])) break
    }
    await this.unlisten?.()
    this.unlisten = undefined
    await this.opts.storage.releaseClocks(this.owner)
  }

  /** The engine context for an application, in live mode. */
  ctx(appId: Id): Ctx {
    const app = this.design.apps.find((a) => a.id === appId)
    if (!app) throw new NotFound(`No application “${appId}”`)
    return { app, users: this.design.users, groups: this.design.groups, services: this.design.services, live: true }
  }

  /** The outbox's deliveries, for the administrators' routes (the sender works on the storage directly). */
  get deliveries(): Deliveries {
    return this.opts.storage.deliveries
  }

  /** The cached state (don't change it: commands run on a copy). An application never written starts empty. */
  state(appId: Id): SimState {
    return this.cached(appId).sim
  }

  /** Application minutes per real minute. */
  get timeScale(): number {
    return this.opts.timeScale
  }

  /**
   * The application's clock as of now: the cached clock plus the wall time since it was stored. The
   * cached clock lags on a quiet application (idle ticks aren't committed); this doesn't.
   */
  clockNow(appId: Id): number {
    const c = this.cached(appId)
    if (c.tickedAt === undefined) return c.sim.clock
    return c.sim.clock + (Math.max(0, Date.now() - c.tickedAt) / 60_000) * this.opts.timeScale
  }

  /** Run a command against one application's live state, in one storage transaction. */
  run<T>(appId: Id, fn: (sim: SimState, ctx: Ctx) => T): Promise<T> {
    return this.command(appId, fn)
  }

  /**
   * Read the last committed state without changing anything. Not queued behind commands: it sees every
   * command that finished before it, a caller's own awaited ones included, and none still running.
   */
  async read<T>(appId: Id, fn: (sim: SimState, ctx: Ctx) => T): Promise<T> {
    return fn(this.state(appId), this.ctx(appId))
  }

  /** Move the clock of every application this runtime is the ticker for. One failing doesn't stop the rest. */
  async tick(): Promise<void> {
    for (const app of this.design.apps) {
      if (this.stopping) return
      try {
        if (await this.opts.storage.tryClock(app.id, this.owner)) await this.command(app.id, () => undefined, true)
      } catch (err) {
        this.opts.onError(err, 'tick')
      }
    }
  }

  subscribe(listener: (c: Change) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private cached(appId: Id): Cached {
    this.ctx(appId)
    let c = this.cache.get(appId)
    if (!c) {
      const sim = newSim(appId, Date.now() & 0x7fffffff)
      sim.arrivals = false
      this.cache.set(appId, (c = { version: 0, sim }))
    }
    return c
  }

  /** One at a time per application, in order; a failure doesn't hold up what comes next. */
  private serial<T>(appId: Id, fn: () => T | Promise<T>): Promise<T> {
    const next = (this.queues.get(appId) ?? Promise.resolve()).then(fn)
    this.queues.set(
      appId,
      next.catch(() => undefined),
    )
    return next
  }

  /** Adopt a committed state unless the cache already holds that version or a later one. */
  private adopt(appId: Id, c: Cached): boolean {
    if (c.version <= (this.cache.get(appId)?.version ?? 0)) return false
    this.cache.set(appId, c)
    return true
  }

  private command<T>(appId: Id, fn: (sim: SimState, ctx: Ctx) => T, tick = false): Promise<T> {
    return this.serial(appId, async () => {
      const ctx = this.ctx(appId)
      const cached = this.cached(appId)
      // A throw from our side of the transaction (the command, or projecting its result), as opposed to storage's.
      let failed: { err: unknown } | undefined
      // Another server's newer state, handed over under the lock: worth keeping whatever happens next.
      let fresh: Cached | undefined
      let sim!: SimState
      let tickedAt: number | undefined
      let itemIds: Id[] = []
      let r: { value: T; version: number; committed: boolean }
      try {
        r = await this.opts.storage.transact(appId, cached.version, (stored) => {
          try {
            if (stored.state) fresh = { version: stored.version, sim: stored.state, tickedAt: stored.tickedAt }
            const before = stored.state ?? cached.sim
            sim = structuredClone(before)
            // Taken under the lock: waiting for it doesn't count as clock time already spent.
            const now = Date.now()
            // Catch the clock up from when it was last moved, by whichever server. A state from before
            // clock times were kept isn't moved; this commit starts keeping one.
            const last = stored.tickedAt
            if (last !== undefined && now > last) advance(sim, ctx, ((now - last) / 60_000) * this.opts.timeScale)
            const value = fn(sim, ctx)
            const c = changesBetween(before, sim)
            itemIds = c.itemIds
            if (tick && !c.itemIds.length && last !== undefined && now - last < IDLE_TICK_MS) return { value }
            const idx = buildIndex(ctx)
            const items = c.itemIds.map((id) => projectItem(sim, ctx, id, idx)).filter((p): p is ProjectedItem => !!p)
            // Never write a clock time earlier than the stored one (another server's clock may run ahead).
            tickedAt = Math.max(now, last ?? now)
            return { value, write: { state: sim, entries: c.entries, items, outbox: c.outbox, tickedAt } }
          } catch (err) {
            failed = { err }
            throw err
          }
        })
      } catch (err) {
        // The command failed, but another server's change it was handed is real: keep and show it.
        if (fresh && this.adopt(appId, fresh)) this.emit({ appId, clock: fresh.sim.clock, itemIds: moved(cached.sim, fresh.sim) })
        if (failed) throw failed.err
        if (err instanceof StorageBusy) throw new StorageUnavailable(err.message, { cause: err })
        throw new StorageUnavailable('Storage is unavailable, so the change wasn’t made. Try again shortly.', { cause: err })
      }
      // Items another server moved since our cached version, which this runtime hasn't told anyone about.
      const theirs = fresh ? moved(cached.sim, fresh.sim) : []
      if (r.committed) {
        this.adopt(appId, { version: r.version, sim, tickedAt })
        this.emit({ appId, clock: sim.clock, itemIds: [...new Set([...theirs, ...itemIds])].sort() })
      } else if (fresh && this.adopt(appId, fresh)) {
        // A rolled-back idle tick still brought another server's change: show it.
        this.emit({ appId, clock: fresh.sim.clock, itemIds: theirs })
      }
      return r.value
    })
  }

  /** Another server (or this one) committed: reload unless the cache has that version already. */
  private heard(n: ChangeNotice): Promise<void> {
    if (this.stopping || !this.design.apps.some((a) => a.id === n.appId)) return Promise.resolve()
    // Cheap check first: this process's own commits arrive here too.
    if (n.version <= (this.cache.get(n.appId)?.version ?? 0)) return Promise.resolve()
    return this.reload(n.appId, n)
  }

  /** The connection to storage came back: anything may have been missed. */
  private async reloadAll(): Promise<void> {
    if (this.stopping) return
    await Promise.all(this.design.apps.map((a) => this.reload(a.id)))
  }

  /** Load the stored state when it is newer than the cache, and tell listeners. Never throws. */
  private reload(appId: Id, n?: ChangeNotice): Promise<void> {
    return this.serial(appId, async () => {
      const was = this.cached(appId)
      // Checked again in turn: a commit queued ahead (this runtime's own, say) may have brought the cache there.
      if (n && n.version <= was.version) return
      const s = await this.opts.storage.state.load(appId)
      if (!s?.state || !this.adopt(appId, { version: s.version, sim: s.state, tickedAt: s.tickedAt })) return
      // The notice's items cover the state only when it is the one commit between the cache and storage.
      const one = n?.itemIds && s.version === n.version && was.version === n.version - 1
      this.emit({ appId, clock: s.state.clock, itemIds: one ? n.itemIds! : moved(was.sim, s.state) })
    }).catch((err) => this.opts.onError(err, 'listen'))
  }

  /** Project every item of a state stored before projections existed. */
  private async backfill(appId: Id) {
    const ctx = this.ctx(appId)
    const cached = this.cached(appId)
    let sim = cached.sim
    let tickedAt: number | undefined
    const r = await this.opts.storage.transact(appId, cached.version, (stored) => {
      sim = stored.state ?? cached.sim
      tickedAt = stored.tickedAt ?? Date.now()
      const idx = buildIndex(ctx)
      const items = Object.keys(sim.objects)
        .map((id) => projectItem(sim, ctx, id, idx))
        .filter((p): p is ProjectedItem => !!p)
      return { value: undefined, write: { state: sim, entries: [], items, outbox: [], tickedAt: tickedAt! } }
    })
    this.adopt(appId, { version: r.version, sim, tickedAt })
  }

  private emit(change: Change) {
    for (const l of this.listeners) {
      // The change is committed: a failing listener is its own problem, not the command's.
      try {
        l(change)
      } catch (err) {
        this.opts.onError(err, 'subscriber')
      }
    }
  }
}
