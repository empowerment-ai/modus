import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Id, Priority } from '@throughline/core/model/types'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

// Workspace-only UI state: which page is open, the open work item, basket
// filters, and unsaved form drafts. The simulation itself lives in store/sim.

export type Page = 'home' | 'work' | 'queues' | 'distribute' | 'requests' | 'new'

export type BasketSort = 'priority' | 'due' | 'age'

export interface BasketFilter {
  stepId: Id | ''
  priority: Priority | ''
  overdueOnly: boolean
  query: string
}

/** What you typed into a work item but haven't saved or released yet. */
export interface Draft {
  values: Record<string, unknown>
  comment: string
}

export const NO_FILTER: BasketFilter = { stepId: '', priority: '', overdueOnly: false, query: '' }

interface WorkspaceStore {
  page: Page
  /** Work item open in My work (token id). */
  tokenId: Id | null
  /** Request open in My requests (object id). */
  requestId: Id | null
  sort: BasketSort
  filter: BasketFilter
  /** Bumped after each of your actions so lists refresh at once, between throttled ticks. */
  nonce: number
  introDismissed: boolean
  drafts: Record<Id, Draft>
  go: (page: Page) => void
  openItem: (tokenId: Id | null) => void
  openRequest: (objectId: Id | null) => void
  setSort: (sort: BasketSort) => void
  setFilter: (patch: Partial<BasketFilter>) => void
  bump: () => void
  dismissIntro: () => void
  setDraft: (tokenId: Id, patch: Partial<Draft>) => void
  clearDraft: (tokenId: Id) => void
}

export const useWorkspace = create<WorkspaceStore>()(
  persist(
    (set) => ({
      page: 'home',
      tokenId: null,
      requestId: null,
      sort: 'priority',
      filter: NO_FILTER,
      nonce: 0,
      introDismissed: false,
      drafts: {},
      go: (page) => set({ page }),
      openItem: (tokenId) => set(tokenId ? { tokenId, page: 'work' } : { tokenId }),
      openRequest: (requestId) => set(requestId ? { requestId, page: 'requests' } : { requestId }),
      setSort: (sort) => set({ sort }),
      setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
      bump: () => set((s) => ({ nonce: s.nonce + 1 })),
      dismissIntro: () => set({ introDismissed: true }),
      setDraft: (tokenId, patch) =>
        set((s) => {
          const cur = s.drafts[tokenId] ?? { values: {}, comment: '' }
          return { drafts: { ...s.drafts, [tokenId]: { ...cur, ...patch } } }
        }),
      clearDraft: (tokenId) =>
        set((s) => {
          const drafts = { ...s.drafts }
          delete drafts[tokenId]
          return { drafts }
        }),
    }),
    {
      name: 'throughline-workspace',
      version: 1,
      partialize: (s) => ({ page: s.page, sort: s.sort, introDismissed: s.introDismissed }),
    },
  ),
)

// A different person or app starts with nothing open.
useUi.subscribe((s, prev) => {
  if (s.actingAs !== prev.actingAs || s.appId !== prev.appId) useWorkspace.setState({ tokenId: null, requestId: null, filter: NO_FILTER })
})

// A reset (or imported) simulation reuses token ids; drop drafts so they can't land on a different item.
useSim.subscribe((s, prev) => {
  if (s.sims !== prev.sims) useWorkspace.setState({ drafts: {}, tokenId: null, requestId: null })
})
