import { useMemo } from 'react'
import {
  basketOf,
  type Ctx,
  distributionFor,
  type DistributionSummary,
  type QueueSummary,
  queuesFor,
  type RequestSummary,
  requestsBy,
  type Result,
  type SimState,
  type Supervision,
  supervisionFor,
  type WorkItem,
} from '@modus-bpm/core'
import type { Id } from '@modus-bpm/core/model/types'
import { useDesign } from '../../store/design'
import { ctxFor, useSim } from '../../store/sim'
import { useUi } from '../../store/ui'
import { useWorkspace } from './store'

/**
 * The open app's simulation for the Workspace. While it runs, components using this
 * re-render about twice a second instead of every tick, so typing stays smooth; when
 * paused, and right after your own actions, they refresh at once. `tick` changes
 * whenever the data may have changed: use it as a memo dependency.
 */
export function useLiveSim(): { sim: SimState | undefined; tick: string } {
  const appId = useUi((s) => s.appId)
  const running = useSim((s) => s.running)
  const step = useSim((s) => (running ? Math.floor(s.version / 5) : s.version))
  const nonce = useWorkspace((s) => s.nonce)
  const sim = useSim((s) => s.sims[appId])
  return { sim, tick: `${running ? 'r' : 'p'}${step}.${nonce}` }
}

/** Engine context for the open app; in the Workspace it marks the persona as a real person. */
export function useWorkspaceCtx(): Ctx | undefined {
  const appId = useUi((s) => s.appId)
  const actingAs = useUi((s) => s.actingAs)
  const mode = useUi((s) => s.mode)
  const design = useDesign((s) => s.design)
  return useMemo(() => ctxFor(appId), [design, appId, actingAs, mode])
}

/** Run a workspace operation against the live simulation. Refusals become a warning toast. */
export function perform<T>(fn: (sim: SimState, ctx: Ctx) => Result<T>): Result<T> {
  const r = useSim.getState().act(fn)
  useWorkspace.getState().bump()
  if (!r.ok) useUi.getState().toast(r.error, 'warn')
  return r
}

export interface WorkData {
  clock: number
  basket: WorkItem[]
  queues: QueueSummary[]
  distribution: DistributionSummary[]
  requests: RequestSummary[]
  /** Steps and processes the person oversees (everything, for administrators). */
  supervision: Supervision
}

const EMPTY: WorkData = { clock: 0, basket: [], queues: [], distribution: [], requests: [], supervision: { processes: [], steps: [] } }

/** Everything the Workspace shows for one person, recomputed at most twice a second while running. */
export function useWorkData(sim: SimState | undefined, ctx: Ctx | undefined, me: Id, tick: string): WorkData {
  return useMemo(() => {
    if (!sim || !ctx) return EMPTY
    return {
      clock: sim.clock,
      basket: basketOf(sim, ctx, me),
      queues: queuesFor(sim, ctx, me),
      distribution: distributionFor(sim, ctx, me),
      requests: requestsBy(sim, ctx, me),
      supervision: supervisionFor(sim, ctx, me),
    }
  }, [sim, ctx, me, tick])
}
