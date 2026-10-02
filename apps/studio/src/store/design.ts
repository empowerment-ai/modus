import { produce } from 'immer'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedDesign } from '@throughline/core/model/seed'
import type { App, Design, Id, ObjectType, ServiceDef, Template, Workflow } from '@throughline/core/model/types'

interface DesignStore {
  design: Design
  /** Mutate the whole design (org, users, groups, apps, services, templates) with an immer recipe. */
  update: (fn: (d: Design) => void) => void
  updateApp: (appId: Id, fn: (app: App) => void) => void
  updateWorkflow: (appId: Id, workflowId: Id, fn: (wf: Workflow) => void) => void
  updateType: (appId: Id, typeId: Id, fn: (t: ObjectType) => void) => void
  updateService: (serviceId: Id, fn: (s: ServiceDef) => void) => void
  updateTemplate: (templateId: Id, fn: (t: Template) => void) => void
  replace: (d: Design) => void
  reset: () => void
}

/** Older saved designs may predate the service registry or the template library. */
export function normalizeDesign(d: Design): Design {
  const seed = seedDesign()
  return {
    ...d,
    services: Array.isArray(d.services) ? d.services : seed.services,
    templates: Array.isArray(d.templates) ? d.templates : seed.templates,
  }
}

export const useDesign = create<DesignStore>()(
  persist(
    (set) => ({
      design: seedDesign(),
      update: (fn) => set((s) => ({ design: produce(s.design, fn) })),
      updateApp: (appId, fn) =>
        set((s) => ({
          design: produce(s.design, (d) => {
            const app = d.apps.find((a) => a.id === appId)
            if (app) fn(app)
          }),
        })),
      updateWorkflow: (appId, workflowId, fn) =>
        set((s) => ({
          design: produce(s.design, (d) => {
            const wf = d.apps.find((a) => a.id === appId)?.workflows.find((w) => w.id === workflowId)
            if (wf) fn(wf)
          }),
        })),
      updateType: (appId, typeId, fn) =>
        set((s) => ({
          design: produce(s.design, (d) => {
            const t = d.apps.find((a) => a.id === appId)?.objectTypes.find((x) => x.id === typeId)
            if (t) fn(t)
          }),
        })),
      updateService: (serviceId, fn) =>
        set((s) => ({
          design: produce(s.design, (d) => {
            const svc = d.services.find((x) => x.id === serviceId)
            if (svc) fn(svc)
          }),
        })),
      updateTemplate: (templateId, fn) =>
        set((s) => ({
          design: produce(s.design, (d) => {
            const t = d.templates.find((x) => x.id === templateId)
            if (t) fn(t)
          }),
        })),
      replace: (design) => set({ design: normalizeDesign(design) }),
      reset: () => set({ design: seedDesign() }),
    }),
    {
      name: 'throughline-design',
      version: 1,
      merge: (persisted, current) => {
        const p = persisted as { design?: Design } | undefined
        return p?.design ? { ...current, design: normalizeDesign(p.design) } : current
      },
    },
  ),
)

export function useApp(appId: Id): App | undefined {
  return useDesign((s) => s.design.apps.find((a) => a.id === appId))
}
