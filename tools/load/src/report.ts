// The run's report: a pure function from what k6, the observer and the servers left to
// summary.json (numbers for load:compare) and summary.md (for people). Anything missing
// (k6 crashed, observer down) shows as "not measured", never as a zero.
import type { Workflow } from '@modus-bpm/core'

// ----- Inputs -----

/** k6's `--summary-export`: trends carry avg/med/p(95)…, counters count/rate, rates value. */
export interface K6Summary {
  metrics: Record<string, Record<string, unknown>>
}

export interface LagSummary {
  count: number
  p50: number | null
  p95: number | null
  p99: number | null
  max: number | null
}

/** The observer's `/stats`. */
export interface ObserverStats {
  webhooks: { received: number; duplicates: number; badSignatures: number; badBodies: number; negative: number; lag: LagSummary }
  streams: { open: number; servers: number; reconnects: number; events: number; crossServerLag: LagSummary | null; incomplete: number; unmatched: number }
  observer: { eventLoopDelayP99Ms: number | null }
}

export interface Outbox {
  pending: number
  failed: number
  /** The admin list stops at 500 per status: the counts are at least these. */
  capped: boolean
}

/** Where a step's waiting items come from: people the script plays, steps nobody plays, service jobs. */
export type StepRole = 'played' | 'unplayed' | 'jobs' | 'other'

export interface Backlog {
  active: number
  completed: number
  rejected: number
  steps: { id: string; label: string; count: number; role: StepRole }[]
  /** Service calls in flight or queued: jobs the workers haven't answered. */
  jobs: number
  outbox?: Outbox
}

export interface Settings {
  profile: string
  servers: number
  clerks: number
  streams: number
  startedAt: string
  finishedAt: string
  commit?: string
  timeScale: number
}

export interface ReportInput {
  k6?: K6Summary
  observer?: ObserverStats
  backlog?: Backlog
  settings: Settings
}

// ----- Backlog from the server's overview -----

/** The steps k6's people play (main.js `people`): only the clerk review. */
const PLAYED = new Set(['n_clerk'])

interface Overview {
  active: number
  completed: number
  rejected: number
  steps: Record<string, { total: number }>
  services: Record<string, { inFlight: number; queued: number }>
}

/** The overview's counts per step, labelled from the design and sorted by role then size. */
export function backlogFrom(overview: Overview, workflows: Workflow[], outbox?: Outbox): Backlog {
  const order: StepRole[] = ['played', 'unplayed', 'jobs', 'other']
  const steps: Backlog['steps'] = []
  // Subflow steps' items are already counted on the step that runs the subflow.
  for (const wf of workflows.filter((w) => w.kind !== 'subflow')) {
    for (const n of wf.nodes) {
      const count = overview.steps[n.id]?.total ?? 0
      if (!count) continue
      const role: StepRole = n.type === 'user' ? (PLAYED.has(n.id) ? 'played' : 'unplayed') : n.type === 'subflow' ? 'unplayed' : n.type === 'auto' ? 'jobs' : 'other'
      steps.push({ id: n.id, label: String(n.data.label ?? n.id), count, role })
    }
  }
  steps.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || b.count - a.count)
  const jobs = Object.values(overview.services).reduce((n, s) => n + s.inFlight + s.queued, 0)
  return { active: overview.active, completed: overview.completed, rejected: overview.rejected, steps, jobs, outbox }
}

// ----- Reading k6 -----

export const KINDS = ['create', 'basket', 'queues', 'next', 'open', 'save', 'release', 'poll', 'complete', 'fail'] as const
export const COUNTERS = {
  items_created: 'items created (201)',
  releases: 'work released with an outcome',
  jobs_completed: 'service jobs completed',
  jobs_failed: 'service jobs failed on purpose (~5%)',
  next_empty: '`my/next` found nothing to take (409): a quiet queue',
  busy: 'answers 503: the server shedding load',
  races: 'save or release refused (409): the item moved on meanwhile',
  jobs_gone: 'job finished, cancelled or re-leased before its worker answered (410)',
  dropped_iterations: 'item arrivals k6 could not start (every VU busy): the offered rate was not reached',
} as const

/** Fewer races than this never warn, whatever their share. */
const MIN_RACES = 5

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

class K6 {
  constructor(private s?: K6Summary) {}
  private m(name: string) {
    return this.s?.metrics[name]
  }
  /** A counter's count; zero when k6 ran but never added to it (k6 leaves such metrics out). */
  count(name: string) {
    if (!this.s) return null
    return num(this.m(name)?.count) ?? 0
  }
  rate(name: string) {
    return this.s ? num(this.m(name)?.rate) : null
  }
  /** A Rate metric's fraction of true values. */
  ratio(name: string) {
    return this.s ? num(this.m(name)?.value) : null
  }
  trend(name: string, stat: 'avg' | 'med' | 'p(95)' | 'p(99)' | 'max') {
    return this.s ? num(this.m(name)?.[stat]) : null
  }
}

// ----- Soft limits -----

export interface Limit {
  name: string
  value: number | null
  /** How the value prints. */
  shown: string
  ok: boolean | null
  /** What to do about a ⚠, or why it wasn't measured. */
  note?: string
}

const limit = (name: string, value: number | null, max: number, shown: (v: number) => string, notes: { warn?: string; missing?: string } = {}): Limit => {
  const ok = value === null ? null : value < max
  const note = ok === false ? notes.warn : ok === null ? notes.missing : undefined
  return { name, value, shown: value === null ? 'not measured' : shown(value), ok, ...(note ? { note } : {}) }
}

// ----- Formatting -----

const ms = (v: number | null) => (v === null ? '—' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`)
const pct = (v: number | null, digits = 2) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`)
const int = (v: number | null) => (v === null ? '—' : Math.round(v).toLocaleString('en-US'))
const per = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}/s`)
const mark = (ok: boolean | null) => (ok === null ? '–' : ok ? '✓' : '⚠')
const NM = 'not measured'

// ----- The report -----

export function buildReport(input: ReportInput) {
  const { settings: st, observer: ob, backlog: bl } = input
  const k = new K6(input.k6)
  const requests = k.count('http_reqs')
  const busy = k.count('busy')
  const releases = k.count('releases')
  const races = k.count('races')
  const busyRate = requests && busy !== null ? busy / requests : null
  // A high share of races means the script works on stale data, not that the server is slow.
  const raceRate = releases === null || races === null ? null : releases ? races / releases : races ? 1 : 0
  const hookP95 = ob ? ob.webhooks.lag.p95 : null
  const crossP95 = ob?.streams.crossServerLag ? ob.streams.crossServerLag.p95 : null

  const limits: Limit[] = [
    limit('Reads p95 < 300 ms', k.trend('http_req_duration{op:read}', 'p(95)'), 300, ms),
    limit('Changes p95 < 500 ms', k.trend('http_req_duration{op:change}', 'p(95)'), 500, ms),
    limit('Errors < 1%', k.ratio('http_req_failed'), 0.01, (v) => pct(v)),
    limit('Busy (503) < 2%', busyRate, 0.02, (v) => pct(v)),
    limit('Webhooks p95 within 5 s', hookP95, 5000, ms),
    limit('Cross-server updates p95 within 2 s', crossP95, 2000, ms, { missing: ob && !ob.streams.crossServerLag ? 'one server: nothing to compare' : undefined }),
    limit('Races < 2% of releases', raceRate, 0.02, (v) => pct(v), { warn: "check the script's save/release data" }),
  ]
  // A race or two in a short run is chance, not a pattern.
  const raceLimit = limits[6]
  if (raceLimit.ok === false && races !== null && races < MIN_RACES) Object.assign(raceLimit, { ok: true, note: `only ${races}: too few to judge` })

  const kinds = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      {
        count: k.count(`http_reqs{kind:${kind}}`),
        rate: k.rate(`http_reqs{kind:${kind}}`),
        p50: k.trend(`http_req_duration{kind:${kind}}`, 'med'),
        p95: k.trend(`http_req_duration{kind:${kind}}`, 'p(95)'),
        p99: k.trend(`http_req_duration{kind:${kind}}`, 'p(99)'),
        max: k.trend(`http_req_duration{kind:${kind}}`, 'max'),
        errors: k.ratio(`http_req_failed{kind:${kind}}`),
        busy: k.count(`busy{kind:${kind}}`),
      },
    ]),
  )
  const counters = Object.fromEntries(Object.keys(COUNTERS).map((c) => [c, k.count(c)])) as Record<keyof typeof COUNTERS, number | null>

  const backlogBy = (role: StepRole) => (bl ? bl.steps.filter((s) => s.role === role).reduce((n, s) => n + s.count, 0) : null)

  /** The headline numbers, flat, for load:compare. */
  const numbers = {
    requests,
    requests_per_s: k.rate('http_reqs'),
    reads_p95_ms: limits[0].value,
    changes_p95_ms: limits[1].value,
    error_rate: limits[2].value,
    busy_rate: busyRate,
    ...counters,
    race_rate: raceRate,
    webhooks_received: ob ? ob.webhooks.received : null,
    webhook_lag_p95_ms: hookP95,
    cross_server_lag_p95_ms: crossP95,
    stream_reconnects: ob ? ob.streams.reconnects : null,
    backlog_active: bl ? bl.active : null,
    backlog_played: backlogBy('played'),
    backlog_unplayed: backlogBy('unplayed'),
    backlog_jobs: bl ? bl.jobs : null,
    outbox_pending: bl?.outbox ? bl.outbox.pending : null,
  }

  const json = { settings: st, numbers, limits, kinds, webhooks: ob?.webhooks ?? null, streams: ob?.streams ?? null, observer: ob?.observer ?? null, backlog: bl ?? null }

  // ----- Markdown -----
  const L: string[] = []
  const minutes = (Date.parse(st.finishedAt) - Date.parse(st.startedAt)) / 60_000
  L.push(`# Load test: ${st.profile}, ${st.servers} server${st.servers === 1 ? '' : 's'}`, '')
  L.push(
    `${st.startedAt.slice(0, 16).replace('T', ' ')} UTC · ${Number.isFinite(minutes) ? `${minutes.toFixed(1)} min wall clock` : ''} · commit ${st.commit ?? 'unknown'} · ${st.clerks.toLocaleString('en-US')} clerks · ${st.streams} live screens · TIME_SCALE ${st.timeScale}`,
    '',
  )

  L.push('## Soft limits', '', 'Never fail a run; ⚠ marks what to look at.', '', '| Limit | Value | |', '| --- | --- | --- |')
  for (const l of limits) L.push(`| ${l.name} | ${l.shown} | ${mark(l.ok)}${l.note ? ` ${l.note}` : ''} |`)
  L.push('')

  L.push('## Throughput', '')
  if (!input.k6) L.push(`k6: ${NM}.`, '')
  else {
    L.push(`${int(requests)} requests, ${per(k.rate('http_reqs'))}; errors ${pct(k.ratio('http_req_failed'))}.`, '')
    L.push('| Kind | Requests | Rate | p50 | p95 | p99 | max | Errors | Busy |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const [kind, v] of Object.entries(kinds)) {
      if (!v.count) continue
      L.push(`| ${kind} | ${int(v.count)} | ${per(v.rate)} | ${ms(v.p50)} | ${ms(v.p95)} | ${ms(v.p99)} | ${ms(v.max)} | ${pct(v.errors)} | ${int(v.busy)} |`)
    }
    L.push('', 'Errors exclude the answers the script expects: 409 from `my/next`, save and release, 410 from job answers.', '')
  }

  L.push('## Script counters', '')
  if (!input.k6) L.push(`${NM}.`, '')
  else {
    L.push('| Counter | Count | Meaning |', '| --- | ---: | --- |')
    for (const [c, meaning] of Object.entries(COUNTERS)) {
      const v = counters[c as keyof typeof COUNTERS]
      const flag = c === 'dropped_iterations' && v ? ' ⚠' : c === 'races' && limits[6].ok === false ? ' ⚠' : ''
      L.push(`| ${c} | ${int(v)}${flag} | ${meaning} |`)
    }
    L.push('')
  }

  L.push('## Webhooks', '')
  if (!ob) L.push(`Observer: ${NM}.`)
  else {
    const w = ob.webhooks
    L.push(
      `${int(w.received)} received, ${int(w.duplicates)} duplicates, ${int(w.badSignatures)} bad signatures, ${int(w.badBodies)} bad bodies, ${int(w.negative)} stamped before their event (clock skew).`,
      '',
      `Delivery lag (event created → received): p50 ${ms(w.lag.p50)}, p95 ${ms(w.lag.p95)}, p99 ${ms(w.lag.p99)}, max ${ms(w.lag.max)}.`,
    )
  }
  if (bl?.outbox) L.push('', `Outbox at the end: ${int(bl.outbox.pending)}${bl.outbox.capped ? '+' : ''} pending, ${int(bl.outbox.failed)}${bl.outbox.capped ? '+' : ''} failed.`)
  else L.push('', `Outbox at the end: ${NM}.`)
  L.push('')

  L.push('## Live screens', '')
  if (!ob) L.push(`Observer: ${NM}.`)
  else {
    const s = ob.streams
    L.push(`${int(s.open)} streams open over ${s.servers} server${s.servers === 1 ? '' : 's'}; ${int(s.events)} events, ${int(s.reconnects)} reconnects.`, '')
    if (s.crossServerLag) {
      const c = s.crossServerLag
      L.push(`Same update across servers (first → last server): p50 ${ms(c.p50)}, p95 ${ms(c.p95)}, p99 ${ms(c.p99)}, max ${ms(c.max)} over ${int(c.count)} items; ${int(s.incomplete)} seen on some servers only, ${int(s.unmatched)} on one only.`)
    } else L.push(`Cross-server lag: ${NM} (one server).`)
    if (ob.observer.eventLoopDelayP99Ms !== null && ob.observer.eventLoopDelayP99Ms > 50)
      L.push('', `⚠ The observer's event loop lagged (p99 ${ob.observer.eventLoopDelayP99Ms} ms): its lag numbers include that.`)
  }
  L.push('')

  L.push('## Backlog at the end', '')
  if (!bl) L.push(`${NM}.`)
  else {
    L.push(`${int(bl.active)} items active, ${int(bl.completed)} completed, ${int(bl.rejected)} rejected; ${int(bl.jobs)} service jobs waiting.`, '')
    if (bl.steps.length) {
      const why: Record<StepRole, string> = { played: 'clerks (the script plays them)', unplayed: 'nobody plays it: waits by design', jobs: 'service jobs', other: '' }
      L.push('| Step | Items | Who works it |', '| --- | ---: | --- |')
      for (const s of bl.steps) L.push(`| ${s.label} | ${int(s.count)} | ${why[s.role]} |`)
      L.push('')
    }
    L.push(
      'The script plays only the clerk review. Nobody plays the exception subflow (unmatched POs: about 30% of items have none) or the manager and Controller approvals (invoices over 1,000), so items pile up there by design. Only a backlog at the clerk step or in waiting service jobs means the load outran the people or the workers.',
    )
  }
  L.push('')

  return { json, markdown: L.join('\n') }
}
