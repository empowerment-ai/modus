import { create } from 'zustand'
import type { ScenarioChange, ScenarioResult } from '@modus-bpm/core'
import type { Id } from '@modus-bpm/core/model/types'
import type { Verdict } from './lab'

// The lab's working state lives outside the view so a draft and recent runs
// survive a trip to People & Security (to hire) or the designer and back.
// Not persisted: results hold whole simulation views.

export interface Draft {
  key: number
  change: ScenarioChange
}

export interface Run {
  id: number
  appId: Id
  /** Sim minute the run started from. */
  from: number
  hours: number
  changes: ScenarioChange[]
  result: ScenarioResult
  /** Worded when the run finished, so later design edits (or applying it) don't rewrite history. */
  labels: string[]
  verdict: Verdict
  applied?: boolean
}

const KEEP = 5

interface LabStore {
  drafts: Record<Id, Draft[]>
  hours: number
  runs: Run[]
  selected: Record<Id, number | undefined>
  setHours: (hours: number) => void
  add: (appId: Id, changes: ScenarioChange[]) => void
  edit: (appId: Id, key: number, change: ScenarioChange) => void
  remove: (appId: Id, key: number) => void
  clear: (appId: Id) => void
  record: (run: Omit<Run, 'id'>) => void
  select: (appId: Id, id: number) => void
  markApplied: (id: number) => void
  forget: (appId: Id) => void
}

let seq = 0

/** Two changes aim at the same thing (and the newer one should replace the older). */
function sameTarget(a: ScenarioChange, b: ScenarioChange): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'staff':
      return a.groupId === (b as typeof a).groupId
    case 'handling':
    case 'distribution':
      return a.nodeId === (b as typeof a).nodeId
    case 'arrivals':
      return a.workflowId === (b as typeof a).workflowId
    default:
      return a.serviceId === (b as typeof a).serviceId
  }
}

export const useLab = create<LabStore>()((set) => ({
  drafts: {},
  hours: 8,
  runs: [],
  selected: {},
  setHours: (hours) => set({ hours }),
  add: (appId, changes) =>
    set((s) => {
      let list = s.drafts[appId] ?? []
      for (const change of changes) {
        const i = list.findIndex((d) => sameTarget(d.change, change))
        list = i >= 0 ? list.map((d, j) => (j === i ? { ...d, change } : d)) : [...list, { key: ++seq, change }]
      }
      return { drafts: { ...s.drafts, [appId]: list } }
    }),
  edit: (appId, key, change) => set((s) => ({ drafts: { ...s.drafts, [appId]: (s.drafts[appId] ?? []).map((d) => (d.key === key ? { ...d, change } : d)) } })),
  remove: (appId, key) => set((s) => ({ drafts: { ...s.drafts, [appId]: (s.drafts[appId] ?? []).filter((d) => d.key !== key) } })),
  clear: (appId) => set((s) => ({ drafts: { ...s.drafts, [appId]: [] } })),
  record: (run) =>
    set((s) => {
      const id = ++seq
      const mine = [...s.runs.filter((r) => r.appId === run.appId), { ...run, id }].slice(-KEEP)
      return { runs: [...s.runs.filter((r) => r.appId !== run.appId), ...mine], selected: { ...s.selected, [run.appId]: id } }
    }),
  select: (appId, id) => set((s) => ({ selected: { ...s.selected, [appId]: id } })),
  markApplied: (id) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, applied: true } : r)) })),
  forget: (appId) => set((s) => ({ runs: s.runs.filter((r) => r.appId !== appId), selected: { ...s.selected, [appId]: undefined } })),
}))
