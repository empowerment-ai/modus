// `pnpm load:compare <dirA> <dirB>`: the headline numbers of two runs side by side.
// The folders are results folders (holding summary.json), relative to where you run the command or
// absolute, e.g. from the repo root:
// `pnpm load:compare tools/load/results/20261013-140000-baseline-1srv tools/load/results/20261013-143000-baseline-2srv`.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type Numbers = Record<string, number | null>
export interface Summary {
  settings: { profile: string; servers: number; startedAt: string; commit?: string }
  numbers: Numbers
}

/**
 * Which way is better per number; unlisted numbers show without a verdict. Not `requests`: a total
 * that follows the run's length and the offered load, not how well the servers coped.
 */
const BETTER: Record<string, 'higher' | 'lower'> = {
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

/** Changes smaller than this (relative to A) are run-to-run noise: no verdict. */
export const NOISE = 0.05

/** 'better', 'worse', or '' when the number has no direction or the change is within the noise. */
export function verdict(key: string, a: number, b: number): '' | 'better' | 'worse' {
  const way = BETTER[key]
  const d = b - a
  if (!way || d === 0) return ''
  // From zero any change counts: there is no base to be noisy against.
  if (a !== 0 && Math.abs(d / a) < NOISE) return ''
  return (d < 0) === (way === 'lower') ? 'better' : 'worse'
}

const show = (key: string, v: number | null) => {
  if (v === null || v === undefined) return 'not measured'
  if (RATES.has(key)) return `${(v * 100).toFixed(2)}%`
  if (key.endsWith('_ms')) return `${Math.round(v)} ms`
  if (key.endsWith('_per_s')) return v.toFixed(1)
  return Math.round(v).toLocaleString('en-US')
}

const label = (s: Summary) => `${s.settings.profile}, ${s.settings.servers} srv, ${s.settings.startedAt.slice(0, 16).replace('T', ' ')}`

/** A markdown table: A, B, the change (absolute and %) and whether B is better or worse (beyond ±5%). */
export function compare(a: Summary, b: Summary): string {
  const keys = [...new Set([...Object.keys(a.numbers), ...Object.keys(b.numbers)])]
  const rows = keys.map((key) => {
    const x = a.numbers[key] ?? null
    const y = b.numbers[key] ?? null
    let change = '—'
    let judged = ''
    if (x !== null && y !== null) {
      const d = y - x
      const rel = x === 0 ? (d === 0 ? '0%' : 'new') : `${d > 0 ? '+' : ''}${((d / Math.abs(x)) * 100).toFixed(1)}%`
      const abs = RATES.has(key) ? `${d > 0 ? '+' : ''}${(d * 100).toFixed(2)} pts` : `${d > 0 ? '+' : ''}${show(key, d)}`
      change = d === 0 ? '0' : `${abs} (${rel})`
      judged = verdict(key, x, y)
    }
    return `| ${key} | ${show(key, x)} | ${show(key, y)} | ${change} | ${judged} |`
  })
  return [`A: ${label(a)}`, `B: ${label(b)}`, `Changes within ±${NOISE * 100}% get no verdict: run-to-run noise.`, '', '| Number | A | B | Change | B is |', '| --- | ---: | ---: | ---: | --- |', ...rows, ''].join('\n')
}

/** Where relative folders start: where the command was typed (pnpm sets INIT_CWD when it runs a script elsewhere). */
const base = () => process.env.INIT_CWD ?? process.cwd()

/** A results folder, relative to where the command was typed, or absolute. */
export function load(dir: string, from = base()): Summary {
  const path = join(resolve(from, dir), 'summary.json')
  if (!existsSync(path)) throw new Error(`No summary.json in ${resolve(from, dir)} (folders are relative to where you run the command, or absolute)`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2).filter((a) => a !== '--')
  if (dirs.length !== 2) {
    console.error('Usage: pnpm load:compare <dirA> <dirB>   (results folders, relative to here or absolute)')
    process.exit(2)
  }
  try {
    console.log(compare(load(dirs[0]), load(dirs[1])))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
