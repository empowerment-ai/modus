// In-memory storage, optionally snapshotted to JSON files in a data directory so
// a restart picks up where it left off. Good for development, demos and tests;
// not for production: one process only, and a crash between the files of one
// commit can leave the state ahead of the log. Projections and the outbox live in
// memory only; the runtime rebuilds projections at startup. `transact` waits its
// turn behind the application's queue instead of raising StorageBusy.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Design, Id, OutboxMessage, ProjectedItem, SimState } from '@modus-bpm/core'
import type { ChangeNotice, DesignStore, EventLog, LoggedEvent, Projections, StateStore, Storage, Stored, Work } from '../ports'

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

/** An application as stored: the state with its version and clock time (`meta-<app>.json` on disk). */
interface Held {
  version: number
  tickedAt?: number
  state: SimState
}

export function memoryStorage(dataDir?: string): Storage {
  let design: Design | undefined
  const held = new Map<Id, Held>()
  const projected = new Map<Id, Map<Id, ProjectedItem>>()
  const outbox: Array<{ appId: Id; message: OutboxMessage & { id: number } }> = []
  let outboxId = 0
  /** Per application, the end of the queue of transactions: one at a time, like a row lock. */
  const locks = new Map<Id, Promise<unknown>>()
  const listeners = new Set<(n: ChangeNotice) => void>()
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
    const loaded = await readJson<SimState>(join(dataDir, `state-${appId}.json`))
    if (!loaded) return undefined
    // No meta file: a data directory from before versions, whose state counts as one commit.
    const meta = await readJson<{ version: number; tickedAt?: number }>(join(dataDir, `meta-${appId}.json`))
    // A commit that landed while the files were read wins.
    if (!held.has(appId)) held.set(appId, { version: meta?.version ?? 1, tickedAt: meta?.tickedAt, state: loaded })
    return held.get(appId)
  }

  const state: StateStore = {
    async load(appId) {
      const h = await current(appId)
      return h && stored(h, true)
    },
  }

  /** A copy for the caller: storage's own state must not change under it. */
  function stored(h: Held | undefined, withState: boolean): Stored {
    const out: Stored = { version: h?.version ?? 0 }
    if (h?.tickedAt !== undefined) out.tickedAt = h.tickedAt
    if (h && withState) out.state = structuredClone(h.state)
    return out
  }

  async function commit<T>(appId: Id, known: number, work: (stored: Stored) => Work<T> | Promise<Work<T>>) {
    await history
    const h = await current(appId)
    const version = h?.version ?? 0
    const { value, write } = await work(stored(h, version !== known))
    if (!write) return { value, version, committed: false, notice: undefined }

    // Copy and number everything before touching memory, so a failed file write changes nothing here.
    const text = JSON.stringify(write.state)
    const next: Held = { version: version + 1, tickedAt: write.tickedAt, state: JSON.parse(text) as SimState }
    const logged: LoggedEvent[] = []
    // Local positions, so two groups for one item in the same write don't reuse a number.
    const numbered = new Map<Id, number>()
    for (const { itemId, itemNumber, entries } of write.entries) {
      let seq = numbered.get(itemId) ?? lastSeq.get(`${appId}:${itemId}`) ?? 0
      for (const e of entries) logged.push({ ...structuredClone(e), appId, itemId, itemNumber, seq: ++seq })
      numbered.set(itemId, seq)
    }
    const items = write.items.map((p) => structuredClone(p))
    const messages = write.outbox.map((m) => ({ appId, message: { ...structuredClone(m), id: 0 } }))
    if (dataDir) {
      await ready
      await writeAtomic(join(dataDir, `state-${appId}.json`), text)
      await writeAtomic(join(dataDir, `meta-${appId}.json`), JSON.stringify({ version: next.version, tickedAt: next.tickedAt }))
      if (logged.length) await appendFile(join(dataDir, 'events.jsonl'), '\n' + logged.map((e) => JSON.stringify(e)).join('\n') + '\n') // leading newline: a torn line from a failed append can't swallow this one
    }

    held.set(appId, next)
    for (const e of logged) lastSeq.set(`${appId}:${e.itemId}`, e.seq)
    events.push(...logged)
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
    let rows = projected.get(appId)
    if (!rows) projected.set(appId, (rows = new Map()))
    for (const p of items) rows.set(p.item.itemId, p)
    for (const m of messages) m.message.id = ++outboxId
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
      return outbox.filter((m) => m.appId === appId).map((m) => structuredClone(m.message))
    },
    async any(appId) {
      return !!projected.get(appId)?.size
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
