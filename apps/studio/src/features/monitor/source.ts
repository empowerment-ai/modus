// Where the Monitor's numbers come from: the in-browser simulation or a Modus server (Live).
// React-free so the choice and its small rules are unit-tested; MonitorView picks one per render.

import { expeditedByStep, publishedVersion, workingNow, type FeedEntry, type SimState, type SimView, type WorkingOn } from '@modus-bpm/core'
import type { App, Design, Group, Id, ServiceDef, User, Workflow } from '@modus-bpm/core/model/types'
import type { SeriesPoint, ServerDesign } from '../../server/client'
import type { LiveState } from '../../server/live'

/** Everything the Monitor's panels draw, from one source or the other. */
export interface MonitorData {
  live: boolean
  /** The application as that source runs it; undefined when it doesn't (a server without this app). */
  app: App | undefined
  users: User[]
  groups: Group[]
  services: ServiceDef[]
  view: SimView | undefined
  series: SeriesPoint[]
  feed: FeedEntry[]
  /** Expedited items at each step right now, when any are in flight. */
  expedited?: Record<Id, number>
  /** What each person is working on (core's `workingNow`). */
  working: Record<Id, WorkingOn>
  /** Anything was ever created: otherwise the Monitor shows how to get started. */
  hasWork: boolean
}

/** The Monitor shows the server: one serves the Studio and Live is chosen. */
export const isLive = (s: Pick<LiveState, 'available' | 'mode'>) => s.available && s.mode === 'live'

export function simSource(appId: Id, design: Design, view: SimView | undefined, sim: SimState | undefined): MonitorData {
  return {
    live: false,
    app: design.apps.find((a) => a.id === appId),
    users: design.users,
    groups: design.groups,
    services: design.services,
    view,
    series: sim?.series ?? [],
    feed: sim?.feed ?? [],
    expedited: sim && view?.expedited ? expeditedByStep(sim) : undefined,
    working: sim ? workingNow(sim) : {},
    hasWork: (sim?.created ?? 0) > 0,
  }
}

type LiveSlice = Pick<LiveState, 'design' | 'monitor' | 'series' | 'feed'>

export function liveSource(appId: Id, s: LiveSlice): MonitorData {
  const d = s.design
  const view = s.monitor?.view
  return {
    live: true,
    app: d?.apps.find((a) => a.id === appId),
    users: d?.users ?? [],
    groups: d?.groups ?? [],
    // The server leaves out connection details; the Monitor only shows names, kinds, status and capacity.
    services: (d?.services ?? []).map((svc) => ({ endpoint: '', ...svc })),
    view,
    series: s.series,
    feed: s.feed,
    expedited: view?.expedited ? s.monitor?.expeditedByStep : undefined,
    working: s.monitor?.working ?? {},
    hasWork: (view?.created ?? 0) > 0,
  }
}

/** Administrators the Studio can act as on the server, by name. */
export const adminsOf = (d: Pick<ServerDesign, 'users'> | undefined) => (d?.users ?? []).filter((u) => u.roles?.includes('admin')).sort((a, b) => a.name.localeCompare(b.name))

/**
 * How the server's design differs from the browser's, in a short sentence, or undefined when they agree.
 * Cheap on purpose: applications, their workflows and the version each publishes — not every field.
 */
/** A workflow without versions runs its map as is, as the browser's version 1 of the same map does. */
const versionOf = (w: Workflow) => publishedVersion(w) ?? 1

export function designDifference(server: Pick<Design, 'apps'>, local: Pick<Design, 'apps'>, appId?: Id): string | undefined {
  const diffs: Array<{ appId: Id; text: string }> = []
  const add = (id: Id, text: string) => diffs.push({ appId: id, text })
  const localApps = new Map(local.apps.map((a) => [a.id, a]))
  const serverIds = new Set(server.apps.map((a) => a.id))
  for (const a of server.apps) {
    const mine = localApps.get(a.id)
    if (!mine) {
      add(a.id, `${a.name} is only on the server`)
      continue
    }
    const wfs = new Map(mine.workflows.map((w) => [w.id, w]))
    for (const w of a.workflows) {
      const here = wfs.get(w.id)
      if (!here) add(a.id, `${w.name} is only on the server`)
      else if (versionOf(w) !== versionOf(here)) add(a.id, `${w.name} runs version ${versionOf(w)} on the server, ${versionOf(here)} here`)
      wfs.delete(w.id)
    }
    for (const w of wfs.values()) add(a.id, `${w.name} is only in this browser`)
  }
  for (const a of local.apps) if (!serverIds.has(a.id)) add(a.id, `${a.name} is only in this browser`)
  if (!diffs.length) return undefined
  // The open application's differences matter most.
  const first = diffs.find((d) => d.appId === appId) ?? diffs[0]!
  const more = diffs.length > 1 ? ` (and ${diffs.length - 1} more difference${diffs.length > 2 ? 's' : ''})` : ''
  return `The server’s design differs from this browser’s: ${first.text}${more}. Live shows the server’s.`
}

/** With no change for this long the badge says "idle" rather than counting on. */
export const IDLE_AFTER_MS = 30_000

export interface Badge {
  tone: 'green' | 'amber' | 'red' | 'slate'
  text: string
  /** The status alone, for screen readers (the text ticks every second). */
  word: string
}

/**
 * The Live badge. `lastChange` is the last event that moved an item, so a quiet server reads "idle"
 * instead of an ever-growing age.
 * TODO: once the stream sends pings (after the load-tests merge), add onActivity/lastHeard to the store and
 * treat 60 s of silence as a dropped stream (reconnect), so "Live" also means "heard from recently".
 */
export function liveBadge(s: { status: LiveState['status']; lastChange?: number; appOnServer: boolean }, now: number): Badge {
  switch (s.status) {
    case 'live': {
      if (s.lastChange === undefined || now - s.lastChange >= IDLE_AFTER_MS) return { tone: 'green', text: 'Live · idle', word: 'Live' }
      return { tone: 'green', text: `Live · last change ${Math.max(0, Math.floor((now - s.lastChange) / 1000))}s ago`, word: 'Live' }
    }
    case 'reconnecting':
      return { tone: 'amber', text: 'Reconnecting…', word: 'Reconnecting' }
    case 'connecting':
      return { tone: 'slate', text: 'Connecting…', word: 'Connecting' }
    case 'error':
      return { tone: 'red', text: 'Not connected', word: 'Not connected' }
    case 'idle':
      return s.appOnServer ? { tone: 'slate', text: 'Not connected', word: 'Not connected' } : { tone: 'slate', text: 'Not on this server', word: 'Not on this server' }
  }
}
