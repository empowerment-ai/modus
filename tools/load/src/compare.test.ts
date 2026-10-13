import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compare, load, type Summary } from './compare'

const a: Summary = {
  settings: { profile: 'baseline', servers: 1, startedAt: '2026-10-13T14:00:00.000Z', commit: 'aaa1111' },
  numbers: { requests_per_s: 200, reads_p95_ms: 100, error_rate: 0.01, races: 0, webhook_lag_p95_ms: null, backlog_active: 50 },
}
const b: Summary = {
  settings: { profile: 'baseline', servers: 2, startedAt: '2026-10-13T14:30:00.000Z', commit: 'aaa1111' },
  numbers: { requests_per_s: 250, reads_p95_ms: 150, error_rate: 0.005, races: 3, webhook_lag_p95_ms: 40, backlog_active: 50 },
}

describe('compare', () => {
  const table = compare(a, b)

  it('names both runs', () => {
    expect(table).toContain('A: baseline, 1 srv, 2026-10-13 14:00')
    expect(table).toContain('B: baseline, 2 srv, 2026-10-13 14:30')
  })

  it('shows absolute and % change, and which way is better', () => {
    expect(table).toContain('| requests_per_s | 200.0 | 250.0 | +50.0 (+25.0%) | better |')
    expect(table).toContain('| reads_p95_ms | 100 ms | 150 ms | +50 ms (+50.0%) | worse |')
    expect(table).toContain('| error_rate | 1.00% | 0.50% | -0.50 pts (-50.0%) | better |')
  })

  it('handles zero, missing and unjudged numbers', () => {
    expect(table).toContain('| races | 0 | 3 | +3 (new) | worse |')
    expect(table).toContain('| webhook_lag_p95_ms | not measured | 40 ms | — |  |')
    expect(table).toContain('| backlog_active | 50 | 50 | 0 |  |')
  })

  it('loads a results folder by absolute path, and says where relative ones resolve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'load-compare-'))
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(a))
    expect(load(dir).numbers.requests_per_s).toBe(200)
    expect(() => load('tools/load/results/nope')).toThrow(/relative to the repo root/)
  })
})
