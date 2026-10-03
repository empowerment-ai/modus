// Bring a saved design up to date with newer sample data, without losing edits.
// Designs live in the browser; when the sample applications gain features (line
// items, supervisors, an expedite policy…), a design saved earlier would never see
// them. upgradeDesign adds what is missing — fields, columns, lists, steps, paths,
// people, settings — and never changes or removes anything the saved design has.
// Run it once per sample revision, so things a person deleted later stay deleted.

import type { Design } from './types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasIds = (a: unknown[]): a is Obj[] => a.length > 0 && a.every((x) => isObj(x) && typeof x.id === 'string')
const clone = <T>(v: T): T => structuredClone(v)

/** Add to `saved` (in place) everything `seed` has that `saved` lacks. */
function addMissing(saved: Obj, seed: Obj) {
  for (const [key, want] of Object.entries(seed)) {
    const have = saved[key]
    if (have === undefined) saved[key] = clone(want)
    else if (isObj(have) && isObj(want)) addMissing(have, want)
    else if (Array.isArray(have) && Array.isArray(want) && hasIds(want) && (have.length === 0 || hasIds(have))) mergeById(have as Obj[], want)
  }
}

/** Match list entries by id: recurse into matches, insert new ones after their seed neighbour. */
function mergeById(have: Obj[], want: Obj[]) {
  want.forEach((w, i) => {
    const match = have.find((h) => h.id === w.id)
    if (match) return addMissing(match, w)
    const prev = i > 0 ? have.findIndex((h) => h.id === want[i - 1]!.id) : -1
    have.splice(prev >= 0 ? prev + 1 : have.length, 0, clone(w))
  })
}

/**
 * The saved design with whatever newer sample data adds. Sample applications the
 * person deleted are not brought back, and nothing they changed is overwritten.
 */
export function upgradeDesign(saved: Design, seed: Design): Design {
  const out = clone(saved) as unknown as Obj
  const { apps, ...rest } = seed
  addMissing(out, rest as unknown as Obj)
  const outApps = (out.apps as Obj[] | undefined) ?? []
  for (const app of apps) {
    const match = outApps.find((a) => a.id === app.id)
    if (match) addMissing(match, app as unknown as Obj)
  }
  return out as unknown as Design
}
