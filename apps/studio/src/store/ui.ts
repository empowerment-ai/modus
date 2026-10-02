import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Id } from '@throughline/core/model/types'

export type View = 'workflow' | 'types' | 'lists' | 'org' | 'monitor'

export type Selection = { kind: 'node'; id: Id } | { kind: 'edge'; id: Id } | null

interface Toast {
  id: number
  text: string
  tone: 'info' | 'success' | 'warn'
}

interface UiStore {
  appId: Id
  view: View
  workflowId?: Id
  typeId?: Id
  listId?: Id
  selection: Selection
  /** Open object detail drawer. */
  objectId: Id | null
  /** Open "create object" modal for this workflow. */
  createFor: Id | null
  toasts: Toast[]
  setApp: (appId: Id) => void
  setView: (view: View) => void
  setWorkflow: (id?: Id) => void
  setType: (id?: Id) => void
  setList: (id?: Id) => void
  select: (sel: Selection) => void
  openObject: (id: Id | null) => void
  openCreate: (workflowId: Id | null) => void
  toast: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let toastSeq = 0

export const useUi = create<UiStore>()(
  persist(
    (set) => ({
      appId: 'app_invoice',
      view: 'workflow',
      selection: null,
      objectId: null,
      createFor: null,
      toasts: [],
      setApp: (appId) => set({ appId, workflowId: undefined, typeId: undefined, listId: undefined, selection: null, objectId: null }),
      setView: (view) => set({ view, selection: null }),
      setWorkflow: (workflowId) => set({ workflowId, selection: null }),
      setType: (typeId) => set({ typeId }),
      setList: (listId) => set({ listId }),
      select: (selection) => set({ selection }),
      openObject: (objectId) => set({ objectId }),
      openCreate: (createFor) => set({ createFor }),
      toast: (text, tone = 'info') => {
        const id = ++toastSeq
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800)
      },
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'bpm-prototype-ui',
      version: 1,
      partialize: (s) => ({ appId: s.appId, view: s.view, workflowId: s.workflowId, typeId: s.typeId, listId: s.listId }),
    },
  ),
)
