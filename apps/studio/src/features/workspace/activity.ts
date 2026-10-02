import { useMemo, useRef } from 'react'
import type { AuditEntry, SimObject, SimState } from '@modus-bpm/core'
import type { Id, User } from '@modus-bpm/core/model/types'

export interface Activity {
  entry: AuditEntry
  obj: SimObject
}

interface Scan {
  sim?: SimState
  userId?: Id
  /** History entries already looked at, per item. */
  seen: Map<Id, number>
  found: Activity[]
}

/**
 * Recent history on your items: entries that mention you, and everything that happens
 * to items you created. Scans only entries added since the last pass, so it stays cheap
 * with thousands of simulated items.
 */
export function useMyActivity(sim: SimState | undefined, me: User, tick: string, limit = 8): Activity[] {
  const scan = useRef<Scan>({ seen: new Map(), found: [] })
  return useMemo(() => {
    if (!sim) return []
    let s = scan.current
    if (s.sim !== sim || s.userId !== me.id) s = scan.current = { sim, userId: me.id, seen: new Map(), found: [] }
    const fresh: Activity[] = []
    for (const obj of Object.values(sim.objects)) {
      const from = s.seen.get(obj.id) ?? 0
      if (from >= obj.history.length) continue
      const mine = obj.createdBy === me.id
      for (let i = from; i < obj.history.length; i++) {
        const e = obj.history[i]!
        if (mine || e.userId === me.id || e.actor === me.name || e.text.includes(me.name)) fresh.push({ entry: e, obj })
      }
      s.seen.set(obj.id, obj.history.length)
    }
    if (fresh.length) s.found = [...s.found, ...fresh].sort((a, b) => b.entry.at - a.entry.at).slice(0, 40)
    return s.found.slice(0, limit)
  }, [sim, me.id, me.name, tick, limit])
}

/** "Maya Patel released…" reads as "You released…" when Maya is looking. */
export function asYou(text: string, name: string): string {
  return text.startsWith(name) ? `You${text.slice(name.length)}` : text
}
