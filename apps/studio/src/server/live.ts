// The live Monitor's source: a Modus server's state, kept fresh from its event stream.
// A vanilla zustand store (no React) so tests drive it directly; the Monitor wraps it with `useLive`.
//
// Load stays bounded however busy the server is: step counts come with every `change` event, and the
// other panels refetch at most once per `throttleMs` (series incrementally) whatever the event rate.

import { createStore } from 'zustand/vanilla'
import type { ExplorerRow, FeedEntry, Id } from '@modus-bpm/core'
import {
  ApiError,
  detectServer,
  getDesign,
  getFeed,
  getItems,
  getMonitor,
  getSeries,
  openStream,
  type ApiOptions,
  type ChangeEvent,
  type Fetch,
  type ItemFilters,
  type MonitorSnapshot,
  type SeriesPoint,
  type ServerDesign,
} from './client'

export type LiveMode = 'live' | 'simulation'

/** idle: not connected (no server, Simulation mode, or not started) · error: see `error`. */
export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error'

export interface ExplorerState {
  filters: ItemFilters
  rows: ExplorerRow[]
  total: number
  next?: string
  loading: boolean
}

export interface LiveState {
  /** A Modus server serves the Studio (set by `detect`). Nothing is ever requested while false. */
  available: boolean
  mode: LiveMode
  /** Who the Studio acts as (`x-user-id`) until OIDC: by default the design's first administrator. */
  actingAdmin?: Id
  appId?: Id
  design?: ServerDesign
  monitor?: MonitorSnapshot
  series: SeriesPoint[]
  feed: FeedEntry[]
  explorer: ExplorerState
  /** Date.now() of the last data received. */
  lastUpdate?: number
  /** Date.now() of the last change event that moved an item, for "last change Ns ago". */
  lastChange?: number
  status: LiveStatus
  error?: string

  detect: () => Promise<boolean>
  setMode: (mode: LiveMode) => void
  setActingAdmin: (userId: Id) => void
  /** Load everything for the app and follow its stream (only in Live mode). */
  connect: (appId: Id) => Promise<void>
  disconnect: () => void
  /** Ask for a full refetch (throttled like the rest). */
  refresh: () => void
  /** Change explorer filters; paging starts over. */
  setFilters: (f: Partial<ItemFilters>) => void
  loadMore: () => Promise<void>
}

export interface LiveDeps {
  fetch?: Fetch
  /** Where the acting administrator is remembered; null for nowhere. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  throttleMs?: number
  pageSize?: number
  feedLimit?: number
  /** Before connecting again when the design couldn't be loaded. */
  retryMs?: number
  /** Whether the tab is hidden, and a way to hear when that changes. Default: the document's, or always visible. */
  visibility?: Visibility
}

export interface Visibility {
  hidden: () => boolean
  /** Calls back when the tab is shown or hidden. */
  subscribe: (onChange: () => void) => void
}

/** The page's visibility; outside a browser (tests, server rendering) the tab counts as always visible. */
function documentVisibility(): Visibility {
  if (typeof document === 'undefined') return { hidden: () => false, subscribe: () => {} }
  return { hidden: () => document.hidden, subscribe: (cb) => document.addEventListener('visibilitychange', cb) }
}

const ADMIN_KEY = 'modus-live-admin'
/** The server keeps the last 3000 points; so does the Studio. */
const SERIES_MAX = 3000
/** On a refetch the explorer re-reads the rows already shown, up to the server's page limit. */
const PAGE_MAX = 200

const defaultFilters = (): ItemFilters => ({ status: 'all', q: '' })
const emptyExplorer = (): ExplorerState => ({ filters: defaultFilters(), rows: [], total: 0, loading: false })

function defaultStorage(): LiveDeps['storage'] {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // blocked storage (private mode, sandboxed frame)
  }
}

/** Keep someone the design knows (an explicit non-administrator choice shows the 403); else its first administrator. */
function pickAdmin(design: ServerDesign, current: Id | undefined): Id | undefined {
  if (current && design.users.some((u) => u.id === current)) return current
  return design.users.find((u) => u.roles?.includes('admin'))?.id
}

export function createLiveStore(deps: LiveDeps = {}) {
  const f = deps.fetch ?? ((input, init) => fetch(input, init))
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage
  const throttleMs = deps.throttleMs ?? 1000
  const pageSize = deps.pageSize ?? 50
  const feedLimit = deps.feedLimit ?? 300
  const retryMs = deps.retryMs ?? 3000
  const visibility = deps.visibility ?? documentVisibility()

  const remembered = (): Id | undefined => {
    try {
      return storage?.getItem(ADMIN_KEY) ?? undefined
    } catch {
      return undefined
    }
  }
  const remember = (id: Id) => {
    try {
      storage?.setItem(ADMIN_KEY, id)
    } catch {}
  }

  // Connection state outside the store: a new connect bumps `gen`, so late answers to an old one are dropped.
  let gen = 0
  let closeStream: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastFetch = 0
  let pending = false
  let pendingFull = false
  let inFlight = false
  /** A load failed or the stream dropped: the next refetch reloads everything. */
  let stale = false
  let streamLive = false
  /** The design is in and the acting administrator chosen: only now may admin endpoints be called. */
  let ready = false
  let explorerSeq = 0

  const store = createStore<LiveState>()((set, get) => {
    const opts = (): ApiOptions => ({ user: get().actingAdmin!, fetch: f })
    const connected = (g: number) => ready && g === gen && !!get().appId && get().available

    const stop = () => {
      gen++
      closeStream?.()
      closeStream = undefined
      clearTimeout(timer)
      timer = undefined
      pending = pendingFull = inFlight = streamLive = ready = false
    }

    const denied = () => {
      stop()
      const { actingAdmin, design } = get()
      const who = design?.users.find((u) => u.id === actingAdmin)?.name ?? actingAdmin ?? 'The acting person'
      set({ status: 'error', error: `${who} is not an administrator, and only administrators can see the Monitor.` })
    }

    const fail = (g: number, e: unknown) => {
      if (g !== gen) return
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return denied()
      stale = true
      set({ status: 'reconnecting', error: e instanceof Error ? e.message : String(e) })
    }

    const mergeSeries = (have: SeriesPoint[], points: SeriesPoint[]) => {
      const last = have.at(-1)?.t ?? -Infinity
      const merged = have.concat(points.filter((p) => p.t > last))
      return merged.length > SERIES_MAX ? merged.slice(-SERIES_MAX) : merged
    }

    /** The explorer's first page, or (on a refetch) as many rows as are shown. */
    const loadExplorer = async (g: number, limit = pageSize) => {
      const seq = ++explorerSeq
      const { appId, explorer } = get()
      let page
      try {
        page = await getItems(appId!, explorer.filters, { limit }, opts())
      } catch (e) {
        if (g === gen && seq === explorerSeq) set((s) => ({ explorer: { ...s.explorer, loading: false } }))
        throw e
      }
      if (g !== gen || seq !== explorerSeq) return
      set((s) => ({ explorer: { ...s.explorer, rows: page.items, total: page.total, next: page.next, loading: false } }))
    }

    const load = async (g: number, full: boolean) => {
      const { appId, series, explorer } = get()
      const since = full ? undefined : series.at(-1)?.t
      const shown = Math.max(pageSize, explorer.rows.length)
      const [monitor, points, feed] = await Promise.all([
        getMonitor(appId!, opts()),
        getSeries(appId!, since, opts()),
        getFeed(appId!, feedLimit, opts()),
        full || shown <= PAGE_MAX ? loadExplorer(g, full ? pageSize : shown) : undefined,
      ])
      if (g !== gen) return
      set((s) => ({
        monitor,
        series: full ? points.points.slice(-SERIES_MAX) : mergeSeries(s.series, points.points),
        feed: feed.entries,
        lastUpdate: Date.now(),
        error: undefined,
        // A failed refetch said reconnecting; this one worked and the stream is up.
        ...(s.status === 'reconnecting' && streamLive ? { status: 'live' as const } : {}),
      }))
    }

    const flush = async () => {
      timer = undefined
      const g = gen
      if (!pending || !connected(g)) return
      // Hidden since this was scheduled: wait for the tab to come back, then reload it all once.
      if (visibility.hidden()) return void (pendingFull = true)
      const full = pendingFull || stale
      pending = pendingFull = stale = false
      inFlight = true
      lastFetch = Date.now()
      try {
        await load(g, full)
      } catch (e) {
        fail(g, e)
        // The stream is fine but a read failed (a restart, a 500): try again rather than stay 'reconnecting'.
        if (g === gen && streamLive) {
          inFlight = false
          pending = pendingFull = true
          if (!timer) timer = setTimeout(flush, retryMs)
          return
        }
      }
      if (g !== gen) return
      inFlight = false
      if (pending) schedule(false)
    }

    /** At most one refetch per `throttleMs`: a burst of events coalesces into the next one. */
    const schedule = (full: boolean) => {
      if (!connected(gen)) return
      pending = true
      pendingFull ||= full
      // A hidden tab refetches nothing (the stream still keeps the counts); it reloads once when shown.
      if (visibility.hidden()) return void (pendingFull = true)
      if (timer || inFlight) return
      timer = setTimeout(flush, Math.max(0, lastFetch + throttleMs - Date.now()))
    }

    const onChange = (e: ChangeEvent) => {
      // Clock ticks arrive with no items; only events that moved something count as a change.
      if (e.items === null || e.items.length) set({ lastChange: Date.now() })
      set((s) => {
        if (!s.monitor) return { lastUpdate: Date.now() }
        const nodes = { ...s.monitor.view.nodes }
        for (const [id, total] of Object.entries(e.counts)) if (nodes[id]) nodes[id] = { ...nodes[id], total }
        return { monitor: { ...s.monitor, clock: e.clock, view: { ...s.monitor.view, clock: e.clock, nodes, active: e.active } }, lastUpdate: Date.now() }
      })
      schedule(e.items === null)
    }

    const follow = (g: number, appId: Id) => {
      closeStream = openStream(
        appId,
        (e) => g === gen && onChange(e),
        (state) => {
          if (g !== gen) return
          streamLive = state === 'live'
          if (state === 'reconnecting') {
            stale = true
            set({ status: 'reconnecting' })
            return
          }
          set({ status: 'live', error: undefined })
          if (stale) schedule(true)
        },
        {
          user: opts().user,
          fetch: f,
          onDenied: () => g === gen && denied(),
          // The server doesn't run this app (any more): nothing to follow. If the design we hold still lists
          // it, the server dropped it after we loaded: say so rather than going quietly idle.
          onNotFound: () => {
            if (g !== gen) return
            stop()
            if (get().design?.apps.some((a) => a.id === appId)) set({ status: 'error', error: 'The server no longer runs this app. Reload to see its current design.' })
            else set({ status: 'idle' })
          },
        },
      )
    }

    // Back in view: one full reload, whatever was missed while hidden.
    visibility.subscribe(() => {
      if (!visibility.hidden()) schedule(true)
    })

    return {
      available: false,
      mode: 'live',
      series: [],
      feed: [],
      explorer: emptyExplorer(),
      status: 'idle',

      detect: async () => {
        const available = await detectServer(f)
        set({ available })
        return available
      },

      setMode: (mode) => {
        if (mode === get().mode) return
        set({ mode })
        const { appId } = get()
        if (mode === 'simulation') {
          stop()
          set({ status: 'idle' })
        } else if (appId) void get().connect(appId)
      },

      setActingAdmin: (userId) => {
        remember(userId)
        set({ actingAdmin: userId })
        const { appId, mode, available } = get()
        if (appId && mode === 'live' && available) void get().connect(appId)
      },

      connect: async (appId) => {
        if (!get().available) return
        const sameApp = appId === get().appId
        stop()
        const g = gen
        set({
          appId,
          ...(sameApp ? {} : { monitor: undefined, series: [], feed: [], explorer: emptyExplorer(), lastUpdate: undefined, lastChange: undefined }),
        })
        if (get().mode !== 'live') return
        set({ status: 'connecting', error: undefined })
        stale = false
        try {
          // Anyone named may read the design: before we know an administrator, say who we'd like to be.
          const design = await getDesign({ user: get().actingAdmin ?? remembered() ?? 'studio', fetch: f })
          if (g !== gen) return
          const admin = pickAdmin(design, get().actingAdmin ?? remembered())
          if (!admin) {
            set({ design, status: 'error', error: 'The server’s design has no administrator, and only administrators can see the Monitor.' })
            return
          }
          remember(admin)
          set({ design, actingAdmin: admin })
          // A server that doesn't run this app has nothing to show for it: no Monitor reads, no stream.
          if (!design.apps.some((a) => a.id === appId)) {
            set({ status: 'idle' })
            return
          }
          ready = true
          set((s) => ({ explorer: { ...s.explorer, loading: true } }))
          lastFetch = Date.now()
          await load(g, true)
        } catch (e) {
          fail(g, e)
          if (g !== gen || get().status === 'error') return
          // Without the design there's no one to act as: try the whole connect again later.
          if (!get().design) {
            timer = setTimeout(() => g === gen && void get().connect(appId), retryMs)
            return
          }
          // Otherwise unreachable for now: the stream retries and a full reload follows when it's back.
        }
        if (g !== gen) return
        follow(g, appId)
      },

      disconnect: () => {
        stop()
        set({ status: 'idle' })
      },

      refresh: () => schedule(true),

      setFilters: (patch) => {
        set((s) => ({ explorer: { ...s.explorer, filters: { ...s.explorer.filters, ...patch }, rows: [], total: 0, next: undefined, loading: connected(gen) } }))
        const g = gen
        if (connected(g) && get().status !== 'error') loadExplorer(g).catch((e) => fail(g, e))
      },

      loadMore: async () => {
        const g = gen
        const { appId, explorer } = get()
        if (!connected(g) || !explorer.next || explorer.loading) return
        const seq = ++explorerSeq
        set((s) => ({ explorer: { ...s.explorer, loading: true } }))
        try {
          const page = await getItems(appId!, explorer.filters, { limit: pageSize, cursor: explorer.next }, opts())
          if (g !== gen || seq !== explorerSeq) return
          set((s) => {
            const seen = new Set(s.explorer.rows.map((r) => r.id))
            return { explorer: { ...s.explorer, rows: s.explorer.rows.concat(page.items.filter((r) => !seen.has(r.id))), total: page.total, next: page.next, loading: false } }
          })
        } catch (e) {
          if (seq === explorerSeq) set((s) => ({ explorer: { ...s.explorer, loading: false } }))
          fail(g, e)
        }
      },
    }
  })
  return store
}

/** The Studio's one live store. */
export const liveStore = createLiveStore()
