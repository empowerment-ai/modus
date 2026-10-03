// The browser prototype has two places: the landing page (#/ or no hash) and the
// app itself (#/studio, #/workspace). The hash keeps the place across reloads and
// works from GitHub Pages and from the single-file build opened from disk.

import { useEffect, useState } from 'react'
import type { Id } from '@modus-bpm/core/model/types'
import { useUi } from './ui'

type Mode = 'studio' | 'workspace'

function modeFromHash(): Mode | null {
  const h = window.location.hash.replace(/^#\/?/, '')
  return h === 'studio' || h === 'workspace' ? h : null
}

/** Where we are: null for the landing page, or the app mode in the URL. */
export function useRoute(): Mode | null {
  const [mode, setMode] = useState(modeFromHash)
  useEffect(() => {
    const onHash = () => setMode(modeFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return mode
}

/** Open the app, optionally on a given application, Studio view or Workspace person. */
export function enterApp(mode: Mode, opts: { appId?: Id; view?: 'workflow' | 'monitor' | 'scenarios'; actingAs?: Id } = {}) {
  const ui = useUi.getState()
  if (opts.appId && opts.appId !== ui.appId) ui.setApp(opts.appId)
  if (opts.view) ui.setView(opts.view)
  if (opts.actingAs) ui.setActingAs(opts.actingAs)
  if (ui.mode !== mode) ui.setMode(mode)
  window.location.hash = `/${mode}`
  window.scrollTo(0, 0)
}

/** Back to the landing page. */
export function goHome() {
  window.location.hash = '/'
}
