import { useEffect } from 'react'
import { Shell } from './components/Shell'
import { Toaster } from './components/Toaster'
import { ListsView } from './features/lists/ListsView'
import { MonitorView } from './features/monitor/MonitorView'
import { CreateObjectModal } from './features/objects/CreateObjectModal'
import { ObjectDrawer } from './features/objects/ObjectDrawer'
import { OrgView } from './features/org/OrgView'
import { TypesView } from './features/types/TypesView'
import { WorkflowView } from './features/workflow/WorkflowView'
import { useDesign } from './store/design'
import { useSim } from './store/sim'
import { useUi } from './store/ui'

export function App() {
  const view = useUi((s) => s.view)
  const appId = useUi((s) => s.appId)
  const apps = useDesign((s) => s.design.apps)

  // Recover if the remembered app was deleted (or storage came from an older version).
  useEffect(() => {
    if (!apps.some((a) => a.id === appId) && apps[0]) useUi.getState().setApp(apps[0].id)
  }, [apps, appId])

  useEffect(() => {
    useSim.getState().refresh()
  }, [appId])

  if (!apps.some((a) => a.id === appId)) return null

  return (
    <Shell>
      {view === 'workflow' && <WorkflowView />}
      {view === 'types' && <TypesView />}
      {view === 'lists' && <ListsView />}
      {view === 'org' && <OrgView />}
      {view === 'monitor' && <MonitorView />}
      <ObjectDrawer />
      <CreateObjectModal />
      <Toaster />
    </Shell>
  )
}
