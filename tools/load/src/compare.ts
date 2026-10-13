// `pnpm load:compare <dirA> <dirB>`: the headline numbers of two runs side by side.
// The folders are results folders (holding summary.json), relative to the repo root or absolute,
// e.g. `pnpm load:compare tools/load/results/20261013-1400-baseline-1srv tools/load/results/20261013-1430-baseline-2srv`.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Numbers = Record<string, number | null>
export interface Summary {
  settings: { profile: string; servers: number; startedAt: string; commit?: string }
  numbers: Numbers
}

/** Which way is better per number; unlisted numbers show without a verdict. */
const BETTER: Record<string, 'higher' | 'lower'> = {
  requests: 'higher',
  requests_per_s: 'higher',
  reads_p95_ms: 'lower',
  changes_p95_ms: 'lower',
  error_rate: 'lower',
  busy_rate: 'lower',
  items_created: 'higher',
  releases: 'higher',
  jobs_completed: 'higher',
  busy: 'lower',
  races: 'lower',
  race_rate: 'lower',
  jobs_gone: 'lower',
  dropped_iterations: 'lower',
  webhook_lag_p95_ms: 'lower',
  cross_server_lag_p95_ms: 'lower',
  stream_reconnects: 'lower',
  backlog_played: 'lower',
  backlog_jobs: 'lower',
  outbox_pending: 'lower',
}

const RATES = new Set(['error_rate', 'busy_rate', 'race_rate'])

const show = (key: string, v: number | null) => {
  if (v === null || v === undefined) return 'not measured'
  if (RATES.has(key)) return `${(v * 100).toFixed(2)}%`
  if (key.endsWith('_ms')) return `${Math.round(v)} ms`
  if (key.endsWith('_per_s')) return v.toFixed(1)
  return Math.round(v).toLocaleString('en-US')
}

const label = (s: Summary) => `${s.settings.profile}, ${s.settings.servers} srv, ${s.settings.startedAt.slice(0, 16).replace('T', ' ')}`

/** A markdown table: A, B, the change (absolute and %) and whether B is better or worse. */
export function compare(a: Summary, b: Summary): string {
  const keys = [...new Set([...Object.keys(a.numbers), ...Object.keys(b.numbers)])]
  const rows = keys.map((key) => {
    const x = a.numbers[key] ?? null
    const y = b.numbers[key] ?? null
    let change = '—'
    let verdict = ''
    if (x !== null && y !== null) {
      const d = y - x
      const rel = x === 0 ? (d === 0 ? '0%' : 'new') : `${d > 0 ? '+' : ''}${((d / Math.abs(x)) * 100).toFixed(1)}%`
      const abs = RATES.has(key) ? `${d > 0 ? '+' : ''}${(d * 100).toFixed(2)} pts` : `${d > 0 ? '+' : ''}${show(key, d)}`
      change = d === 0 ? '0' : `${abs} (${rel})`
      const way = BETTER[key]
      if (way && d !== 0) verdict = (d < 0) === (way === 'lower') ? 'better' : 'worse'
    }
    return `| ${key} | ${show(key, x)} | ${show(key, y)} | ${change} | ${verdict} |`
  })
  return [`A: ${label(a)}`, `B: ${label(b)}`, '', '| Number | A | B | Change | B is |', '| --- | ---: | ---: | ---: | --- |', ...rows, ''].join('\n')
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** A results folder, relative to the repo root (pnpm runs us from tools/load) or absolute. */
export function load(dir: string): Summary {
  const path = join(isAbsolute(dir) ? dir : resolve(ROOT, dir), 'summary.json')
  if (!existsSync(path)) throw new Error(`No summary.json in ${dir} (folders are relative to the repo root, or absolute)`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2).filter((a) => a !== '--')
  if (dirs.length !== 2) {
    console.error('Usage: pnpm load:compare <dirA> <dirB>   (results folders, relative to the repo root or absolute)')
    process.exit(2)
  }
  try {
    console.log(compare(load(dirs[0]), load(dirs[1])))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
