import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Id } from '@modus-bpm/core/model/types'

/** Studio is for designers and administrators; Workspace is what the people doing the work see. */
export type Mode = 'studio' | 'workspace'

export type View = 'workflow' | 'types' | 'lists' | 'org' | 'integrations' | 'templates' | 'monitor' | 'scenarios'

export type Selection = { kind: 'node'; id: Id } | { kind: 'edge'; id: Id } | null

interface Toast {
  id: number
  text: string
  tone: 'info' | 'success' | 'warn'
}

interface UiStore {
  mode: Mode
  appId: Id
  view: View
  workflowId?: Id
  /** Workflows the designer drilled down from to reach `workflowId` (subflow breadcrumbs). */
  trail: Id[]
  typeId?: Id
  listId?: Id
  selection: Selection
  /** Open object detail drawer. */
  objectId: Id | null
  /** Open "create object" modal for this workflow. */
  createFor: Id | null
  /** Workspace: the person you are working as (no sign-in in the prototype). */
  actingAs: Id
  toasts: Toast[]
  setMode: (mode: Mode) => void
  setApp: (appId: Id) => void
  setView: (view: View) => void
  /** Open a workflow from its tab (clears the subflow trail). */
  setWorkflow: (id?: Id) => void
  /** Open a subflow from the step that runs it, remembering where you came from. */
  drillInto: (subflowId: Id) => void
  /** Go back up the trail to the workflow at `index`. */
  drillTo: (index: number) => void
  setType: (id?: Id) => void
  setList: (id?: Id) => void
  select: (sel: Selection) => void
  openObject: (id: Id | null) => void
  openCreate: (workflowId: Id | null) => void
  setActingAs: (userId: Id) => void
  toast: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

let toastSeq = 0

export const useUi = create<UiStore>()(
  persist(
    (set) => ({
      mode: 'studio',
      appId: 'app_invoice',
      view: 'workflow',
      trail: [],
      selection: null,
      objectId: null,
      createFor: null,
      actingAs: 'u_maya',
      toasts: [],
      setMode: (mode) => set({ mode, selection: null, objectId: null }),
      setApp: (appId) => set({ appId, workflowId: undefined, trail: [], typeId: undefined, listId: undefined, selection: null, objectId: null }),
      setView: (view) => set({ view, selection: null }),
      setWorkflow: (workflowId) => set({ workflowId, trail: [], selection: null }),
      drillInto: (subflowId) =>
        set((s) => ({
          trail: s.workflowId && s.workflowId !== subflowId ? [...s.trail, s.workflowId] : s.trail,
          workflowId: subflowId,
          selection: null,
          view: 'workflow',
        })),
      drillTo: (index) =>
        set((s) => {
          const target = s.trail[index]
          return target ? { workflowId: target, trail: s.trail.slice(0, index), selection: null } : {}
        }),
      setType: (typeId) => set({ typeId }),
      setList: (listId) => set({ listId }),
      select: (selection) => set({ selection }),
      openObject: (objectId) => set({ objectId }),
      openCreate: (createFor) => set({ createFor }),
      setActingAs: (actingAs) => set({ actingAs, objectId: null }),
      toast: (text, tone = 'info') => {
        const id = ++toastSeq
        set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800)
      },
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'modus-ui',
      version: 1,
      partialize: (s) => ({ mode: s.mode, appId: s.appId, view: s.view, workflowId: s.workflowId, trail: s.trail, typeId: s.typeId, listId: s.listId, actingAs: s.actingAs }),
    },
  ),
)
