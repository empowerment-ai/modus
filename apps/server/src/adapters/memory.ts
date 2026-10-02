// In-memory storage, optionally snapshotted to JSON files in a data directory so
// a restart picks up where it left off. Good for development, demos and tests;
// not for production (no transactions, one process only).

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Design, Id, SimState } from '@throughline/core'
import type { DesignStore, EventLog, LoggedEvent, StateStore, Storage } from '../ports'

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

export function memoryStorage(dataDir?: string): Storage {
  let design: Design | undefined
  const states = new Map<Id, SimState>()
  const events: LoggedEvent[] = []
  const ready = dataDir ? mkdir(dataDir, { recursive: true }) : Promise.resolve(undefined)

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
        await writeFile(join(dataDir, 'design.json'), JSON.stringify(d, null, 2))
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
        await writeFile(join(dataDir, `state-${appId}.json`), JSON.stringify(s))
      }
    },
  }

  const log: EventLog = {
    async append(batch) {
      if (!batch.length) return
      events.push(...batch)
      if (events.length > 50_000) events.splice(0, events.length - 50_000)
      if (dataDir) {
        await ready
        await appendFile(join(dataDir, 'events.jsonl'), batch.map((e) => JSON.stringify(e)).join('\n') + '\n')
      }
    },
    async read({ appId, itemId, limit = 200 }) {
      const out: LoggedEvent[] = []
      for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
        const e = events[i]!
        if ((appId && e.appId !== appId) || (itemId && e.itemId !== itemId)) continue
        out.push(e)
      }
      return out.reverse()
    },
  }

  return { designs, state, events: log }
}
