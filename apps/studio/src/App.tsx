import { useEffect, useRef } from 'react'
import { Shell } from './components/Shell'
import { Toaster } from './components/Toaster'
import { IntegrationsView } from './features/integrations/IntegrationsView'
import { ListsView } from './features/lists/ListsView'
import { MonitorView } from './features/monitor/MonitorView'
import { CreateObjectModal } from './features/objects/CreateObjectModal'
import { ObjectDrawer } from './features/objects/ObjectDrawer'
import { OrgView } from './features/org/OrgView'
import { ScenariosView } from './features/scenarios/ScenariosView'
import { TemplatesView } from './features/templates/TemplatesView'
import { TypesView } from './features/types/TypesView'
import { WorkflowView } from './features/workflow/WorkflowView'
import { WorkspaceView } from './features/workspace/WorkspaceView'
import { LandingPage } from './features/home/LandingPage'
import { useDesign } from './store/design'
import { useRoute } from './store/route'
import { useSim } from './store/sim'
import { useUi } from './store/ui'

export function App() {
  const view = useUi((s) => s.view)
  const mode = useUi((s) => s.mode)
  const appId = useUi((s) => s.appId)
  const apps = useDesign((s) => s.design.apps)
  const route = useRoute()

  // The URL decides the mode when it names one (#/studio, #/workspace)…
  useEffect(() => {
    if (route && route !== useUi.getState().mode) useUi.getState().setMode(route)
  }, [route])
  // …and switching between Studio and Workspace inside the app updates the URL.
  const lastMode = useRef(mode)
  useEffect(() => {
    if (lastMode.current === mode) return
    lastMode.current = mode
    if (route && route !== mode) window.location.hash = `/${mode}`
  }, [mode, route])

  // Recover if the remembered app was deleted (or storage came from an older version).
  useEffect(() => {
    if (!apps.some((a) => a.id === appId) && apps[0]) useUi.getState().setApp(apps[0].id)
  }, [apps, appId])

  useEffect(() => {
    useSim.getState().refresh()
  }, [appId])

  if (!route) return <LandingPage />
  if (!apps.some((a) => a.id === appId)) return null

  return (
    <Shell>
      {mode === 'workspace' ? (
        <WorkspaceView />
      ) : (
        <>
          {view === 'workflow' && <WorkflowView />}
          {view === 'types' && <TypesView />}
          {view === 'lists' && <ListsView />}
          {view === 'org' && <OrgView />}
          {view === 'integrations' && <IntegrationsView />}
          {view === 'templates' && <TemplatesView />}
          {view === 'monitor' && <MonitorView />}
          {view === 'scenarios' && <ScenariosView />}
        </>
      )}
      <ObjectDrawer />
      <CreateObjectModal />
      <Toaster />
    </Shell>
  )
}
