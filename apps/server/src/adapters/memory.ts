// In-memory storage, optionally snapshotted to JSON files in a data directory so
// a restart picks up where it left off. Good for development, demos and tests;
// not for production (no transactions, one process only).

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Design, Id, SimState } from '@modus-bpm/core'
import type { DesignStore, EventLog, LoggedEvent, StateStore, Storage } from '../ports'

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

export function memoryStorage(dataDir?: string): Storage {
  let design: Design | undefined
  const states = new Map<Id, SimState>()
  const events: LoggedEvent[] = []
  /** The highest position logged per item, so a batch sent again is not logged twice. */
  const lastSeq = new Map<string, number>()
  const ready = dataDir ? mkdir(dataDir, { recursive: true }) : Promise.resolve(undefined)
  // The event log written before a restart, read once on first use (the latest MAX_EVENTS of it).
  const history = dataDir
    ? readFile(join(dataDir, 'events.jsonl'), 'utf8').then(
        (text) => {
          const lines = text.split('\n').filter(Boolean).slice(-MAX_EVENTS)
          events.unshift(...lines.map((l) => JSON.parse(l) as LoggedEvent))
          for (const e of events) lastSeq.set(`${e.appId}:${e.itemId}`, Math.max(e.seq, lastSeq.get(`${e.appId}:${e.itemId}`) ?? 0))
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

  const state: StateStore = {
    async load(appId) {
      const hit = states.get(appId)
      if (hit || !dataDir) return hit
      await ready
      const loaded = await readJson<SimState>(join(dataDir, `state-${appId}.json`))
      if (loaded) states.set(appId, loaded)
      return loaded
    },
    async save(appId, s) {
      states.set(appId, s)
      if (dataDir) {
        await ready
        await writeAtomic(join(dataDir, `state-${appId}.json`), JSON.stringify(s))
      }
    },
  }

  const log: EventLog = {
    async append(batch) {
      await history
      // Idempotent, like the SQL adapters: a batch sent again skips what already landed, and a
      // different entry at a taken position refuses the whole batch.
      for (const e of batch) {
        if (e.seq > (lastSeq.get(`${e.appId}:${e.itemId}`) ?? 0)) continue
        const had = events.findLast((x) => x.appId === e.appId && x.itemId === e.itemId && x.seq === e.seq)
        if (had && !isDeepStrictEqual(had, JSON.parse(JSON.stringify(e))))
          throw new Error(`Event log conflict: item ${e.itemNumber} already has a different entry at position ${e.seq}.`)
      }
      batch = batch.filter((e) => e.seq > (lastSeq.get(`${e.appId}:${e.itemId}`) ?? 0))
      if (!batch.length) return
      for (const e of batch) lastSeq.set(`${e.appId}:${e.itemId}`, e.seq)
      events.push(...batch)
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
      if (dataDir) {
        await ready
        await appendFile(join(dataDir, 'events.jsonl'), batch.map((e) => JSON.stringify(e)).join('\n') + '\n')
      }
    },
    async read({ appId, itemId, limit = 200 }) {
      await history
      const out: LoggedEvent[] = []
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i]!
        if ((appId && e.appId !== appId) || (itemId && e.itemId !== itemId)) continue
        out.push(e)
      }
      return out.reverse()
    },
  }

  return { name: 'memory', designs, state, events: log }
}
