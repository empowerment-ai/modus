import { create } from 'zustand'
import { advance, burst, newSim, type Ctx, type SimState } from '@throughline/core'
import { computeView, type SimView } from '@throughline/core/engine/view'
import type { Id } from '@throughline/core/model/types'
import { useDesign } from './design'
import { useUi } from './ui'

// The simulation state is a plain mutable object driven by a game-loop style
// timer. After every tick we recompute a small read model (SimView) and bump
// `version`; components that need raw objects read them via useSimObjects().

export interface TokenFlight {
  key: number
  edgeId: Id
  t0: number
  reject: boolean
}

export const SPEEDS = [
  { value: 2, label: '2 min/s' },
  { value: 10, label: '10 min/s' },
  { value: 30, label: '30 min/s' },
  { value: 120, label: '2 hr/s' },
] as const

const TICK_MS = 100
export const FLIGHT_MS = 900

interface SimStore {
  sims: Record<Id, SimState>
  views: Record<Id, SimView>
  version: number
  running: boolean
  speed: number
  flights: TokenFlight[]
  play: () => void
  pause: () => void
  toggle: () => void
  setSpeed: (speed: number) => void
  setArrivals: (on: boolean) => void
  fastForward: (minutes: number) => void
  burst: (workflowId: Id, count: number) => number
  reset: () => void
  /** Run an engine operation (admin action, create, ...) against the open app's simulation. */
  act: <T>(fn: (sim: SimState, ctx: Ctx) => T) => T
  refresh: () => void
}

export function ctxFor(appId: Id): Ctx | undefined {
  const d = useDesign.getState().design
  const app = d.apps.find((a) => a.id === appId)
  const ui = useUi.getState()
  // In the Workspace, the person you are working as is driven by you, not the simulation.
  const manualUserIds = ui.mode === 'workspace' ? [ui.actingAs] : []
  return app ? { app, users: d.users, groups: d.groups, services: d.services, manualUserIds } : undefined
}

function currentAppId(): Id {
  return useUi.getState().appId
}

let timer: ReturnType<typeof setInterval> | undefined
let lastTick = 0
let flightKey = 0

export const useSim = create<SimStore>()((set, get) => {
  const simFor = (appId: Id): SimState => {
    let sim = get().sims[appId]
    if (!sim) {
      sim = newSim(appId)
      set((s) => ({ sims: { ...s.sims, [appId]: sim! } }))
    }
    return sim
  }

  /** Recompute the read model and hand new token flights to the canvas. */
  const publish = (appId: Id, animate: boolean) => {
    const sim = simFor(appId)
    const ctx = ctxFor(appId)
    if (!ctx) return
    const now = performance.now()
    let flights = get().flights.filter((f) => now - f.t0 < FLIGHT_MS + 200)
    if (animate && sim.flights.length) {
      // Cap tokens per edge so high speeds stay readable.
      const perEdge = new Map<Id, number>()
      for (const f of flights) perEdge.set(f.edgeId, (perEdge.get(f.edgeId) ?? 0) + 1)
      sim.flights.forEach((f, i) => {
        const n = perEdge.get(f.edgeId) ?? 0
        if (n >= 4) return
        perEdge.set(f.edgeId, n + 1)
        flights.push({ key: ++flightKey, edgeId: f.edgeId, t0: now + (i % 6) * 60, reject: f.reject })
      })
    }
    sim.flights.length = 0
    if (flights.length > 120) flights = flights.slice(-120)
    set((s) => ({ views: { ...s.views, [appId]: computeView(sim, ctx) }, version: s.version + 1, flights }))
  }

  // Advance by real elapsed time, so throttled timers (background tabs, busy
  // main thread) still run at the chosen speed. Capped to avoid huge jumps.
  const tick = () => {
    const appId = currentAppId()
    const ctx = ctxFor(appId)
    if (!ctx) return
    const now = performance.now()
    const elapsed = Math.min(2000, now - (lastTick || now - TICK_MS))
    lastTick = now
    advance(simFor(appId), ctx, (get().speed * elapsed) / 1000)
    publish(appId, true)
  }

  return {
    sims: {},
    views: {},
    version: 0,
    running: false,
    speed: 10,
    flights: [],
    play: () => {
      if (timer) return
      lastTick = 0
      timer = setInterval(tick, TICK_MS)
      set({ running: true })
    },
    pause: () => {
      if (timer) clearInterval(timer)
      timer = undefined
      set({ running: false })
    },
    toggle: () => (get().running ? get().pause() : get().play()),
    setSpeed: (speed) => set({ speed }),
    setArrivals: (on) => {
      simFor(currentAppId()).arrivals = on
      publish(currentAppId(), false)
    },
    fastForward: (minutes) => {
      const appId = currentAppId()
      const ctx = ctxFor(appId)
      if (!ctx) return
      advance(simFor(appId), ctx, minutes)
      publish(appId, false)
    },
    burst: (workflowId, count) => {
      const appId = currentAppId()
      const ctx = ctxFor(appId)
      if (!ctx) return 0
      const made = burst(simFor(appId), ctx, workflowId, count)
      publish(appId, true)
      return made
    },
    reset: () => {
      const appId = currentAppId()
      const fresh = newSim(appId)
      fresh.arrivals = get().sims[appId]?.arrivals ?? true
      set((s) => ({ sims: { ...s.sims, [appId]: fresh }, flights: [] }))
      publish(appId, false)
    },
    act: (fn) => {
      const appId = currentAppId()
      const sim = simFor(appId)
      const ctx = ctxFor(appId)
      if (!ctx) throw new Error('No app open')
      const result = fn(sim, ctx)
      publish(appId, true)
      return result
    },
    refresh: () => publish(currentAppId(), false),
  }
})

// Model-driven: any design edit immediately re-evaluates the live read model,
// and switching apps shows that app's own simulation.
useDesign.subscribe(() => useSim.getState().refresh())
useUi.subscribe((s, prev) => {
  if (s.appId !== prev.appId) {
    useSim.setState({ flights: [] })
    useSim.getState().refresh()
  } else if (s.mode !== prev.mode || s.actingAs !== prev.actingAs) {
    useSim.getState().refresh()
  }
})

/** The open app's read model (counts per step, per user, totals). */
export function useSimView(): SimView | undefined {
  const appId = useUi((s) => s.appId)
  return useSim((s) => s.views[appId])
}

/** Raw simulation state for the open app; re-renders whenever the sim ticks. */
export function useSimState(): SimState | undefined {
  const appId = useUi((s) => s.appId)
  useSim((s) => s.version)
  return useSim.getState().sims[appId]
}
