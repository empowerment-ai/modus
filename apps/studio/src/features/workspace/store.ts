import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AssistantReply } from '@modus-bpm/core'
import type { Id, Priority } from '@modus-bpm/core/model/types'
import { useSim } from '../../store/sim'
import { useUi } from '../../store/ui'

// Workspace-only UI state: which page is open, the open work item, basket
// filters, unsaved form drafts, searches and the Ask Modus conversation.
// The simulation itself lives in store/sim.

export type Page = 'home' | 'work' | 'queues' | 'distribute' | 'supervise' | 'search' | 'requests' | 'new'

export type BasketSort = 'priority' | 'due' | 'age'

export type SearchSort = 'relevance' | 'newest' | 'due' | 'priority'

export interface BasketFilter {
  stepId: Id | ''
  priority: Priority | ''
  overdueOnly: boolean
  expeditedOnly: boolean
  query: string
}

/** What you typed into a work item but haven't saved or released yet. */
export interface Draft {
  values: Record<string, unknown>
  comment: string
}

/** One turn in the Ask Modus conversation. */
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  reply?: AssistantReply
}

export const NO_FILTER: BasketFilter = { stepId: '', priority: '', overdueOnly: false, expeditedOnly: false, query: '' }

const RECENT_MAX = 8

interface WorkspaceStore {
  page: Page
  /** Work item open in My work (token id). */
  tokenId: Id | null
  /** Request open in My requests (object id). */
  requestId: Id | null
  /** Item open read-only from Search or Supervise (object id). */
  viewId: Id | null
  sort: BasketSort
  filter: BasketFilter
  /** Bumped after each of your actions so lists refresh at once, between throttled ticks. */
  nonce: number
  introDismissed: boolean
  drafts: Record<Id, Draft>
  searchQuery: string
  searchSort: SearchSort
  /** Recent searches per application, newest first. */
  recent: Record<Id, string[]>
  quickOpen: boolean
  askOpen: boolean
  /** A question waiting for the Ask Modus panel to send it. */
  askQuestion: string | null
  /** Ask Modus conversations, per application and person ("appId:userId"). */
  chats: Record<string, ChatMessage[]>
  /** Step drilled into on the Supervise page. */
  superviseStep: Id | null
  go: (page: Page) => void
  openItem: (tokenId: Id | null) => void
  openRequest: (objectId: Id | null) => void
  /** Show an item read-only: on Supervise when you are there, otherwise on Search. */
  view: (objectId: Id | null) => void
  setSort: (sort: BasketSort) => void
  setFilter: (patch: Partial<BasketFilter>) => void
  bump: () => void
  dismissIntro: () => void
  setDraft: (tokenId: Id, patch: Partial<Draft>) => void
  clearDraft: (tokenId: Id) => void
  setSearchQuery: (query: string) => void
  setSearchSort: (sort: SearchSort) => void
  /** Open the Search page on a query. */
  search: (query: string) => void
  remember: (appId: Id, query: string) => void
  forget: (appId: Id, query?: string) => void
  setQuickOpen: (open: boolean) => void
  setAskOpen: (open: boolean) => void
  /** Open Ask Modus, optionally asking a question straight away. */
  openAsk: (question?: string) => void
  addMessage: (key: string, msg: Omit<ChatMessage, 'id'>) => void
  clearChat: (key: string) => void
  superviseAt: (nodeId: Id | null) => void
}

let messageSeq = 0

export const useWorkspace = create<WorkspaceStore>()(
  persist(
    (set) => ({
      page: 'home',
      tokenId: null,
      requestId: null,
      viewId: null,
      sort: 'priority',
      filter: NO_FILTER,
      nonce: 0,
      introDismissed: false,
      drafts: {},
      searchQuery: '',
      searchSort: 'relevance',
      recent: {},
      quickOpen: false,
      askOpen: false,
      askQuestion: null,
      chats: {},
      superviseStep: null,
      // A nav click lands on the top of the page, not on whatever was open there before.
      go: (page) => set({ page, viewId: null, superviseStep: null }),
      openItem: (tokenId) => set(tokenId ? { tokenId, page: 'work' } : { tokenId }),
      openRequest: (requestId) => set(requestId ? { requestId, page: 'requests' } : { requestId }),
      view: (viewId) => set((s) => (viewId ? { viewId, page: s.page === 'supervise' ? 'supervise' : 'search' } : { viewId })),
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
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSearchSort: (searchSort) => set({ searchSort }),
      search: (searchQuery) => set({ searchQuery, page: 'search', viewId: null }),
      remember: (appId, query) =>
        set((s) => {
          const q = query.trim()
          if (!q) return {}
          const list = [q, ...(s.recent[appId] ?? []).filter((x) => x !== q)].slice(0, RECENT_MAX)
          return { recent: { ...s.recent, [appId]: list } }
        }),
      forget: (appId, query) => set((s) => ({ recent: { ...s.recent, [appId]: query === undefined ? [] : (s.recent[appId] ?? []).filter((x) => x !== query) } })),
      setQuickOpen: (quickOpen) => set({ quickOpen }),
      setAskOpen: (askOpen) => set({ askOpen }),
      openAsk: (question) => set({ askOpen: true, askQuestion: question?.trim() || null }),
      addMessage: (key, msg) => set((s) => ({ chats: { ...s.chats, [key]: [...(s.chats[key] ?? []), { ...msg, id: ++messageSeq }] } })),
      clearChat: (key) => set((s) => ({ chats: { ...s.chats, [key]: [] } })),
      superviseAt: (superviseStep) => set({ superviseStep, viewId: null }),
    }),
    {
      name: 'modus-workspace',
      version: 1,
      partialize: (s) => ({ page: s.page, sort: s.sort, introDismissed: s.introDismissed, searchSort: s.searchSort, recent: s.recent }),
    },
  ),
)

// A different person or app starts with nothing open.
useUi.subscribe((s, prev) => {
  if (s.actingAs !== prev.actingAs || s.appId !== prev.appId) useWorkspace.setState({ tokenId: null, requestId: null, viewId: null, superviseStep: null, filter: NO_FILTER })
})

// A reset (or imported) simulation reuses token ids; drop drafts so they can't land on a different item,
// and answers that point at items that no longer exist.
useSim.subscribe((s, prev) => {
  if (s.sims === prev.sims) return
  const replaced = Object.keys(prev.sims).filter((id) => s.sims[id] !== prev.sims[id])
  const chats = Object.fromEntries(Object.entries(useWorkspace.getState().chats).filter(([key]) => !replaced.some((id) => key.startsWith(`${id}:`))))
  useWorkspace.setState({ drafts: {}, tokenId: null, requestId: null, viewId: null, chats })
})
