// In-memory storage, optionally kept in a data directory so a restart picks up
// where it left off. Good for development, demos and tests; not for production:
// one process only, and a crash between the state and event files of one commit
// can leave the state ahead of the log. Each application's state is a log,
// `state-<app>.jsonl`: one line per commit with the rest of the state and only
// the items it changed, rewritten as one full line now and then. Projections and
// the outbox live in memory only; the runtime rebuilds projections at startup.
// `transact` waits its turn behind the application's queue instead of raising
// StorageBusy.

import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Design, type Id, type OutboxMessage, type ProjectedItem, type SimObject, type SimState, withoutItems } from '@modus-bpm/core'
import type { ChangeNotice, Deliveries, Delivery, DesignStore, EventLog, Loaded, LoggedEvent, Projections, StateStore, Storage, Stored, Work } from '../ports'

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

let writes = 0

/** Events kept in memory for reading; the file keeps them all. */
const MAX_EVENTS = 50_000

/** Write via a temporary file and rename, so a crash or a backup never sees half a snapshot. */
async function writeAtomic(path: string, text: string) {
  const tmp = `${path}.${process.pid}-${++writes}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

/** An application as stored. */
interface Held {
  version: number
  tickedAt?: number
  /** Never changed in place: each commit builds the next state, sharing the items it didn't write. */
  state: SimState
  /** The version that last wrote each item (shared by successive Helds; set once a commit is in). */
  written: Map<Id, number>
}

/** One line of `state-<app>.jsonl`: a commit's rest of the state and the items it wrote, or every item (`full`). */
interface LogLine {
  version: number
  tickedAt?: number
  full?: true
  state: SimState
  items: SimObject[]
}

/** How much an application's log holds: its last full line, and what was appended since. */
interface LogSize {
  full: number
  since: number
  /** Loaded from the files before the log (`state-<app>.json`, `meta-<app>.json`): the first commit converts them. */
  legacy?: boolean
}

/** A log is rewritten as one full line once what was appended since outgrows the full line (and this). */
const COMPACT_BYTES = 1_000_000

/** An outbox message as held: sent once delivered, failed or skipped everywhere. */
interface Queued {
  appId: Id
  message: OutboxMessage & { id: number }
  /** Wall time of the commit (epoch ms). */
  createdAt: number
  sentAt?: number
  skipped?: boolean
}

export function memoryStorage(dataDir?: string, opts: { compactBytes?: number } = {}): Storage {
  const compactBytes = opts.compactBytes ?? COMPACT_BYTES
  let design: Design | undefined
  const held = new Map<Id, Held>()
  const projected = new Map<Id, Map<Id, ProjectedItem>>()
  const outbox: Queued[] = []
  // Ids keep growing across restarts, so receivers that drop ids they've seen never drop a new message.
  // Nothing to persist: seeded from the clock, 1000 ids per millisecond of uptime before a restart could reuse one.
  let outboxId = Date.now() * 1000
  /** Keyed `${outboxId}:${endpoint}`, in the order fanned out. */
  const sending = new Map<string, Delivery>()
  /** Per application, the end of the queue of transactions: one at a time, like a row lock. */
  const locks = new Map<Id, Promise<unknown>>()
  const listeners = new Set<(n: ChangeNotice) => void>()
  /** Each application's log in the data directory (absent: no log yet). */
  const logs = new Map<Id, LogSize>()
  /** Clock owner per application. */
  const clocks = new Map<Id, string>()
  const events: LoggedEvent[] = []
  /** The highest position logged per item: new entries are numbered after it. */
  const lastSeq = new Map<string, number>()
  const ready = dataDir ? mkdir(dataDir, { recursive: true }) : Promise.resolve(undefined)
  // The event log written before a restart, read once on first use (the latest MAX_EVENTS of it).
  const history = dataDir
    ? readFile(join(dataDir, 'events.jsonl'), 'utf8').then(
        (text) => {
          // A crash mid-append can leave a torn last line, and a retried append the same entry twice:
          // skip what doesn't parse and keep the first entry at each position.
          const seen = new Set<string>()
          const loaded: LoggedEvent[] = []
          for (const line of text.split('\n')) {
            let e: LoggedEvent
            try {
              e = JSON.parse(line) as LoggedEvent
            } catch {
              continue
            }
            const key = `${e.appId}:${e.itemId}:${e.seq}`
            if (seen.has(key)) continue
            seen.add(key)
            loaded.push(e)
            lastSeq.set(`${e.appId}:${e.itemId}`, Math.max(e.seq, lastSeq.get(`${e.appId}:${e.itemId}`) ?? 0))
          }
          events.unshift(...loaded.slice(-MAX_EVENTS))
        },
        () => undefined,
      )
    : Promise.resolve()

  const designs: DesignStore = {
    async load() {
      if (design) return design
      if (!dataDir) return undefined
      await ready
      return (design = await readJson<Design>(join(dataDir, 'design.json')))
    },
    async save(d) {
      design = d
      if (dataDir) {
        await ready
        await writeAtomic(join(dataDir, 'design.json'), JSON.stringify(d, null, 2))
      }
    },
  }

  /** The application as stored, read from the data directory on first use. */
  async function current(appId: Id): Promise<Held | undefined> {
    const hit = held.get(appId)
    if (hit || !dataDir) return hit
    await ready
    const loaded = (await replay(appId)) ?? (await legacy(appId))
    if (!loaded) return undefined
    // A commit that landed while the files were read wins.
    if (!held.has(appId)) {
      held.set(appId, loaded.held)
      logs.set(appId, loaded.size)
    }
    return held.get(appId)
  }

  /** Replay an application's log: the last line's rest and version, each item as last written. */
  async function replay(appId: Id): Promise<{ held: Held; size: LogSize } | undefined> {
    let text: string
    try {
      text = await readFile(join(dataDir!, `state-${appId}.jsonl`), 'utf8')
    } catch {
      return undefined
    }
    let objects: Record<Id, SimObject> = {}
    let written = new Map<Id, number>()
    let last: LogLine | undefined
    const size: LogSize = { full: 0, since: 0 }
    for (const line of text.split('\n')) {
      if (!line) continue
      let r: LogLine
      try {
        r = JSON.parse(line) as LogLine
      } catch {
        // A crash mid-append leaves a torn line: that commit never happened.
        continue
      }
      if (r.full) {
        objects = {}
        written = new Map()
        size.full = line.length
        size.since = 0
      } else size.since += line.length + 2
      for (const o of r.items) {
        objects[o.id] = o
        written.set(o.id, r.version)
      }
      last = r
    }
    if (!last) return undefined
    return { held: { version: last.version, tickedAt: last.tickedAt, state: { ...last.state, objects }, written }, size }
  }

  /** A data directory from before the log: the whole state, and its version and clock time beside it. */
  async function legacy(appId: Id): Promise<{ held: Held; size: LogSize } | undefined> {
    const loaded = await readJson<SimState>(join(dataDir!, `state-${appId}.json`))
    if (!loaded) return undefined
    // No meta file: a data directory from before versions, whose state counts as one commit.
    const meta = await readJson<{ version: number; tickedAt?: number }>(join(dataDir!, `meta-${appId}.json`))
    const version = meta?.version ?? 1
    const written = new Map(Object.keys(loaded.objects).map((id) => [id, version]))
    return { held: { version, tickedAt: meta?.tickedAt, state: loaded, written }, size: { full: 0, since: 0, legacy: true } }
  }

  /**
   * Add a commit to the application's log: one appended line with the rest and the items written, or the
   * whole file afresh as one full line when there is no log yet, it holds the old files' state, or what was
   * appended since the last full line has outgrown it.
   */
  async function record(appId: Id, version: number, tickedAt: number, rest: string, items: string[], state: SimState) {
    const path = join(dataDir!, `state-${appId}.jsonl`)
    const head = JSON.stringify({ version, tickedAt }).slice(0, -1)
    const line = `${head},"state":${rest},"items":[${items.join(',')}]}`
    const size = logs.get(appId)
    if (size && !size.legacy && size.since + line.length + 2 <= Math.max(size.full, compactBytes)) {
      // A leading newline: a torn line from a failed append can't swallow this one.
      await appendFile(path, `\n${line}\n`)
      size.since += line.length + 2
      return
    }
    const all = Object.values(state.objects).map((o) => JSON.stringify(o))
    const full = `${head},"full":true,"state":${rest},"items":[${all.join(',')}]}`
    await writeAtomic(path, `${full}\n`)
    logs.set(appId, { full: full.length, since: 0 })
    if (size?.legacy) for (const old of [`state-${appId}.json`, `meta-${appId}.json`]) await rm(join(dataDir!, old), { force: true })
  }

  const state: StateStore = {
    async load(appId) {
      const h = await current(appId)
      if (!h) return undefined
      const out: Loaded = { version: h.version, state: structuredClone(h.state) }
      if (h.tickedAt !== undefined) out.tickedAt = h.tickedAt
      return out
    },
    async since(appId, version) {
      const h = await current(appId)
      return h && stored(h, version)
    },
  }

  /** What changed after `since`, as copies: storage's own state must not change under the caller. */
  function stored(h: Held | undefined, since: number): Stored {
    const out: Stored = { version: h?.version ?? 0 }
    if (h?.tickedAt !== undefined) out.tickedAt = h.tickedAt
    if (h && h.version !== since) {
      const objects: SimObject[] = []
      for (const id in h.state.objects) if ((h.written.get(id) ?? 0) > since) objects.push(structuredClone(h.state.objects[id]!))
      out.changes = { state: structuredClone(withoutItems(h.state)), objects }
    }
    return out
  }

  async function commit<T>(appId: Id, known: number, work: (stored: Stored) => Work<T> | Promise<Work<T>>) {
    await history
    const h = await current(appId)
    const version = h?.version ?? 0
    const { value, write } = await work(stored(h, known))
    if (!write) return { value, version, committed: false, notice: undefined }

    // Copy and number everything before touching memory, so a failed file write changes nothing here. Of the
    // items, only those written are copied (in item order); the next state shares the others.
    const listed = new Set(write.items.map((p) => p.item.itemId))
    for (const id of listed) if (!write.state.objects[id]) throw new Error(`The write lists item ${id}, which its state doesn't hold.`)
    const ids: Id[] = []
    const texts: string[] = []
    for (const id in write.state.objects)
      if (listed.has(id)) {
        ids.push(id)
        texts.push(JSON.stringify(write.state.objects[id]))
      }
    const rest = JSON.stringify(withoutItems(write.state))
    const objects = { ...h?.state.objects }
    ids.forEach((id, i) => (objects[id] = JSON.parse(texts[i]!) as SimObject))
    const written = h?.written ?? new Map<Id, number>()
    const next: Held = { version: version + 1, tickedAt: write.tickedAt, state: { ...(JSON.parse(rest) as SimState), objects }, written }
    const logged: LoggedEvent[] = []
    // Local positions, so two groups for one item in the same write don't reuse a number.
    const numbered = new Map<Id, number>()
    for (const { itemId, itemNumber, entries } of write.entries) {
      let seq = numbered.get(itemId) ?? lastSeq.get(`${appId}:${itemId}`) ?? 0
      for (const e of entries) logged.push({ ...structuredClone(e), appId, itemId, itemNumber, seq: ++seq })
      numbered.set(itemId, seq)
    }
    const items = write.items.map((p) => structuredClone(p))
    const messages: Queued[] = write.outbox.map((m) => ({ appId, message: { ...structuredClone(m), id: 0 }, createdAt: 0 }))
    if (dataDir) {
      await ready
      await record(appId, next.version, write.tickedAt, rest, texts, next.state)
      if (logged.length) await appendFile(join(dataDir, 'events.jsonl'), '\n' + logged.map((e) => JSON.stringify(e)).join('\n') + '\n') // leading newline: a torn line from a failed append can't swallow this one
    }

    held.set(appId, next)
    for (const id of ids) written.set(id, next.version)
    for (const e of logged) lastSeq.set(`${appId}:${e.itemId}`, e.seq)
    events.push(...logged)
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
    let rows = projected.get(appId)
    if (!rows) projected.set(appId, (rows = new Map()))
    for (const p of items) rows.set(p.item.itemId, p)
    const at = Date.now()
    for (const m of messages) {
      m.message.id = ++outboxId
      m.createdAt = at
    }
    outbox.push(...messages)
    return { value, version: next.version, committed: true, notice: { appId, version: next.version, itemIds: items.map((p) => p.item.itemId) } }
  }

  const projections: Projections = {
    async item(appId, itemId) {
      const p = projected.get(appId)?.get(itemId)
      return p && structuredClone(p.item)
    },
    async workItems(appId, itemId) {
      const rows = projected.get(appId)
      if (!rows) return []
      const of = itemId ? [rows.get(itemId)] : [...rows.values()]
      const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
      // As Postgres orders them: item, time entered, token.
      return of
        .flatMap((p) => (p ? structuredClone(p.workItems) : []))
        .sort((x, y) => cmp(x.itemId, y.itemId) || x.enteredAt - y.enteredAt || cmp(x.tokenId, y.tokenId))
    },
    async outbox(appId) {
      return outbox.filter((m) => m.appId === appId && m.sentAt === undefined).map((m) => structuredClone(m.message))
    },
    async any(appId) {
      return !!projected.get(appId)?.size
    },
  }

  // Synchronous inside each call, so concurrent callers can't interleave mid-claim.
  const byId = (id: number) => outbox.find((m) => m.message.id === id)
  const of = (id: number) => [...sending.values()].filter((d) => d.outboxId === id)
  const deliveries: Deliveries = {
    async fanOut(route, now, limit) {
      const routed = new Set([...sending.values()].map((d) => d.outboxId))
      const fresh = outbox.filter((m) => m.sentAt === undefined && !m.skipped && !routed.has(m.message.id)).slice(0, limit)
      for (const m of fresh) {
        const endpoints = route({ appId: m.appId, kind: m.message.kind })
        if (!endpoints.length) {
          m.skipped = true
          m.sentAt = now
        }
        for (const endpoint of endpoints) {
          const { id: outboxId, itemId, kind, payload } = m.message
          sending.set(`${outboxId}:${endpoint}`, { outboxId, endpoint, appId: m.appId, itemId, kind, payload: structuredClone(payload), createdAt: m.createdAt, status: 'pending', attempts: 0, since: now, nextAt: now })
        }
      }
      return fresh.length
    },
    async claim(now, leaseMs, limit) {
      const due = [...sending.values()]
        .filter((d) => d.status === 'pending' && d.nextAt <= now)
        .sort((x, y) => x.nextAt - y.nextAt || x.outboxId - y.outboxId || (x.endpoint < y.endpoint ? -1 : x.endpoint > y.endpoint ? 1 : 0))
        .slice(0, limit)
      for (const d of due) d.nextAt = now + leaseMs
      return due.map((d) => structuredClone(d))
    },
    async record(outboxId, endpoint, claimedUntil, result, now) {
      const d = sending.get(`${outboxId}:${endpoint}`)
      // A late result: the lease ran out and the delivery was claimed again, settled or retried since.
      if (!d || d.status !== 'pending' || d.nextAt !== claimedUntil) return false
      d.status = result.status
      d.attempts++
      if (result.status === 'pending') d.nextAt = result.nextAt
      // As a SQL update would: this attempt's answer replaces the last one's.
      if (result.lastStatus === undefined) delete d.lastStatus
      else d.lastStatus = result.lastStatus
      if (result.lastError === undefined) delete d.lastError
      else d.lastError = result.lastError
      if (result.status === 'delivered') d.deliveredAt = now
      const m = byId(outboxId)
      if (m && !of(outboxId).some((x) => x.status === 'pending')) m.sentAt = now
      return true
    },
    async list({ status, limit = 100 }) {
      return [...sending.values()]
        .filter((d) => !status || d.status === status)
        .sort((x, y) => y.outboxId - x.outboxId || (x.endpoint < y.endpoint ? -1 : x.endpoint > y.endpoint ? 1 : 0))
        .slice(0, limit)
        .map((d) => structuredClone(d))
    },
    async retry(outboxId, now) {
      const failed = of(outboxId).filter((d) => d.status === 'failed')
      for (const d of failed) {
        // A fresh schedule: the first retry is soon again, and giving up counts from now.
        d.status = 'pending'
        d.nextAt = now
        d.attempts = 0
        d.since = now
      }
      const m = byId(outboxId)
      if (failed.length && m) delete m.sentAt
      return failed.length > 0
    },
    async prune(now, keepMs, keepFailedMs) {
      const failed = new Set([...sending.values()].filter((d) => d.status === 'failed').map((d) => d.outboxId))
      const gone = new Set<number>()
      // Skipped messages count as sent.
      for (const m of outbox) if (m.sentAt !== undefined && m.sentAt < now - (failed.has(m.message.id) ? keepFailedMs : keepMs)) gone.add(m.message.id)
      if (!gone.size) return 0
      for (const [key, d] of sending) if (gone.has(d.outboxId)) sending.delete(key)
      const kept = outbox.filter((m) => !gone.has(m.message.id))
      outbox.splice(0, outbox.length, ...kept)
      return gone.size
    },
  }

  const log: EventLog = {
    async read({ appId, itemId, limit = 200 }) {
      await history
      const out: LoggedEvent[] = []
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i]!
        if ((appId && e.appId !== appId) || (itemId && e.itemId !== itemId)) continue
        out.push(structuredClone(e))
      }
      return out.reverse()
    },
  }

  return {
    name: 'memory',
    designs,
    state,
    events: log,
    projections,
    deliveries,
    async transact(appId, known, work) {
      const run = (locks.get(appId) ?? Promise.resolve()).then(() => commit(appId, known, work))
      const done = run.then(
        () => undefined,
        () => undefined,
      )
      locks.set(appId, done)
      void done.then(() => {
        if (locks.get(appId) === done) locks.delete(appId)
      })
      const { notice, ...result } = await run
      // After the lock is released, as NOTIFY is delivered after COMMIT.
      // A listener's failure (thrown or rejected) is its own; the commit stands. Each gets its own copy.
      if (notice)
        for (const l of listeners)
          void Promise.resolve()
            .then(() => l(structuredClone(notice)))
            .catch(() => undefined)
      return result
    },
    async listen(onChange) {
      // One process: no connection to lose, so `onReconnect` is never called.
      listeners.add(onChange)
      return async () => {
        listeners.delete(onChange)
      }
    },
    async tryClock(appId, owner) {
      const had = clocks.get(appId)
      if (had !== undefined && had !== owner) return false
      clocks.set(appId, owner)
      return true
    },
    async releaseClocks(owner) {
      for (const [appId, o] of clocks) if (o === owner) clocks.delete(appId)
    },
  }
}
