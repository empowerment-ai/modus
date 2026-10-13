import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './fonts'
import { App } from './App'
import { liveStore } from './server/live'

// Served by a Modus server, the Monitor can show it live. The standalone file has no server to ask
// (and opens from disk), so it never looks; elsewhere a static host simply doesn't answer as one.
if (import.meta.env.MODE !== 'standalone') void liveStore.getState().detect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
