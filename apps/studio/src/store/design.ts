import { produce } from 'immer'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { upgradeDesign } from '@modus-bpm/core/model/upgrade'
import { ensureVersions } from '@modus-bpm/core/model/versions'
import type { App, Design, Id, ObjectType, ServiceDef, Template, Workflow } from '@modus-bpm/core/model/types'

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
function withRegistries(d: Design): Design {
  const seed = seedDesign()
  return {
    ...d,
    services: Array.isArray(d.services) ? d.services : seed.services,
    templates: Array.isArray(d.templates) ? d.templates : seed.templates,
  }
}

/** Fill in what older saved designs lack; every workflow starts at version 1, published, from its map. */
export function normalizeDesign(d: Design): Design {
  return versioned(withRegistries(d))
}

// When a workflow first gets its version 1 (on load, or when one is created), in simulation minutes.
let clock = () => 0
export function setPublishClock(fn: () => number) {
  clock = fn
}

/** Workflows created from now on (blank, from a template, blown out of a step) start at version 1, published. */
const versioned = (d: Design) => ensureVersions(d, clock())

export const useDesign = create<DesignStore>()(
  persist(
    (set) => ({
      design: versioned(seedDesign()),
      update: (fn) => set((s) => ({ design: versioned(produce(s.design, fn)) })),
      updateApp: (appId, fn) =>
        set((s) => ({
          design: versioned(
            produce(s.design, (d) => {
              const app = d.apps.find((a) => a.id === appId)
              if (app) fn(app)
            }),
          ),
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
      reset: () => set({ design: versioned(seedDesign()) }),
    }),
    {
      name: 'modus-design',
      // Bump when saved designs need something added once
      // (version 2: line items, roles, supervisors, expedite from the sample data;
      // version 3: workflow versions, made from each saved map as it stands).
      version: 3,
      migrate: (persisted, from) => {
        const p = persisted as { design?: Design } | undefined
        if (!p?.design) return p
        // The sample-data upgrade runs once, so things deleted after it stay deleted.
        const design = from < 2 ? upgradeDesign(withRegistries(p.design), seedDesign()) : withRegistries(p.design)
        return { ...p, design: versioned(design) }
      },
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
