import { readFileSync } from 'node:fs'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { describe, expect, it } from 'vitest'
import { backlogFrom, buildReport, type K6Summary, type ObserverStats, type Settings } from './report'

// A real `--summary-export` from a smoke run, trimmed to the metrics the report reads.
const k6: K6Summary = JSON.parse(readFileSync(new URL('./fixtures/k6-smoke.json', import.meta.url), 'utf8'))

const settings: Settings = {
  profile: 'smoke',
  servers: 2,
  clerks: 10,
  streams: 10,
  startedAt: '2026-10-13T19:22:00.000Z',
  finishedAt: '2026-10-13T19:23:30.000Z',
  commit: 'abc1234',
  timeScale: 60,
}

const lag = (p95: number) => ({ count: 100, p50: p95 / 2, p95, p99: p95 * 1.2, max: p95 * 2 })
const observer: ObserverStats = {
  webhooks: { received: 292, duplicates: 0, badSignatures: 0, badBodies: 0, negative: 0, lag: lag(28) },
  streams: { open: 10, servers: 2, reconnects: 0, events: 4510, crossServerLag: lag(120), incomplete: 1, unmatched: 0 },
  observer: { eventLoopDelayP99Ms: 2 },
}

const app = seedDesign().apps.find((a) => a.id === 'app_invoice')!
const overview = {
  active: 81,
  completed: 37,
  rejected: 2,
  steps: { n_clerk: { total: 15 }, n_exception: { total: 37 }, n_manager: { total: 20 }, n_controller: { total: 9 }, n_post: { total: 3 }, x_triage: { total: 30 } },
  services: { svc_erp: { inFlight: 2, queued: 1 }, svc_mail: { inFlight: 0, queued: 0 } },
}
const backlog = backlogFrom(overview, app.workflows, { pending: 4, failed: 0, capped: false })

describe('backlogFrom', () => {
  it('labels steps, says who works them, and leaves subflow steps to the step that runs them', () => {
    expect(backlog.steps).toEqual([
      { id: 'n_clerk', label: 'AP clerk review', count: 15, role: 'played' },
      { id: 'n_exception', label: 'Resolve exception', count: 37, role: 'unplayed' },
      { id: 'n_manager', label: 'Manager approval', count: 20, role: 'unplayed' },
      { id: 'n_controller', label: 'Controller approval', count: 9, role: 'unplayed' },
      { id: 'n_post', label: 'Post to ERP', count: 3, role: 'jobs' },
    ])
    expect(backlog.jobs).toBe(3)
  })
})

describe('buildReport', () => {
  const { json, markdown } = buildReport({ k6, observer, backlog, settings })

  it('reads k6 numbers from a real summary export', () => {
    expect(json.numbers.requests).toBe(1582)
    expect(json.numbers.items_created).toBe(120)
    expect(json.numbers.releases).toBe(39)
    expect(json.numbers.error_rate).toBe(0)
    expect(json.numbers.reads_p95_ms).toBeCloseTo(11.65, 1)
    expect(json.kinds.create.count).toBe(120)
    expect(json.kinds.create.p95).toBeGreaterThan(0)
    // Counters k6 never added to are left out of its export: zero, not missing.
    expect(json.numbers.races).toBe(0)
    expect(json.numbers.dropped_iterations).toBe(0)
  })

  it('judges the soft limits', () => {
    expect(json.limits.every((l) => l.ok === true)).toBe(true)
    expect(markdown).toContain('| Reads p95 < 300 ms | 12 ms | ✓ |')
    expect(markdown).toContain('| Cross-server updates p95 within 2 s | 120 ms | ✓ |')
    expect(markdown).not.toMatch(/\| ⚠|\d ⚠/)
  })

  it('surfaces the script counters and dropped iterations', () => {
    for (const c of ['busy', 'races', 'jobs_gone', 'next_empty', 'items_created', 'releases', 'jobs_completed', 'jobs_failed', 'dropped_iterations'])
      expect(markdown).toMatch(new RegExp(`\\| ${c} \\| [\\d,]+`))
  })

  it('explains the expected backlog', () => {
    expect(markdown).toContain('| AP clerk review | 15 | clerks (the script plays them) |')
    expect(markdown).toContain('| Manager approval | 20 | nobody plays it: waits by design |')
    expect(markdown).toContain('Only a backlog at the clerk step or in waiting service jobs')
    expect(json.numbers.backlog_played).toBe(15)
    expect(json.numbers.backlog_unplayed).toBe(66)
    expect(markdown).toContain('Outbox at the end: 4 pending, 0 failed.')
  })

  it('flags slow requests, busy answers, races and dropped arrivals', () => {
    const bad: K6Summary = {
      metrics: {
        ...k6.metrics,
        'http_req_duration{op:read}': { ...k6.metrics['http_req_duration{op:read}'], 'p(95)': 450 },
        busy: { count: 100, rate: 1 },
        races: { count: 5, rate: 0.1 },
        releases: { count: 95, rate: 1 },
        dropped_iterations: { count: 12, rate: 0.2 },
      },
    }
    const r = buildReport({ k6: bad, observer, backlog, settings })
    expect(r.markdown).toContain('| Reads p95 < 300 ms | 450 ms | ⚠ |')
    expect(r.markdown).toMatch(/\| Busy \(503\) < 2% \| 6\.32% \| ⚠ \|/)
    expect(r.markdown).toContain("| Races < 2% of releases | 5.26% | ⚠ check the script's save/release data |")
    expect(r.markdown).toContain('| dropped_iterations | 12 ⚠ |')
    expect(r.markdown).toContain('| races | 5 ⚠ |')
  })

  it('does not warn about a race or two in a short run', () => {
    const r = buildReport({ k6: { metrics: { ...k6.metrics, races: { count: 1, rate: 0 }, releases: { count: 46, rate: 1 } } }, observer, backlog, settings })
    expect(r.markdown).toContain('| Races < 2% of releases | 2.17% | ✓ only 1: too few to judge |')
    expect(r.markdown).toContain('| races | 1 |')
  })

  it('says "not measured" for what is missing, never zero', () => {
    const r = buildReport({ settings: { ...settings, servers: 1 } })
    expect(r.json.numbers.requests).toBeNull()
    expect(r.json.numbers.webhook_lag_p95_ms).toBeNull()
    expect(r.json.numbers.backlog_active).toBeNull()
    expect(r.json.limits.every((l) => l.ok === null)).toBe(true)
    expect(r.markdown).toContain('| Errors < 1% | not measured | – |')
    expect(r.markdown).toContain('| Races < 2% of releases | not measured | – |')
    expect(r.markdown).toContain('k6: not measured.')
    expect(r.markdown).toContain('Observer: not measured.')
    expect(r.markdown).toContain('Outbox at the end: not measured.')
  })

  it('with one server, cross-server lag is not measured and says why', () => {
    const one = { ...observer, streams: { ...observer.streams, servers: 1, crossServerLag: null } }
    const r = buildReport({ k6, observer: one, backlog, settings: { ...settings, servers: 1 } })
    expect(r.markdown).toContain('| Cross-server updates p95 within 2 s | not measured | – one server: nothing to compare |')
    expect(r.markdown).toContain('Cross-server lag: not measured (one server).')
  })
})
