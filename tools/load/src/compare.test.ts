import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compare, load, verdict, type Summary } from './compare'

const a: Summary = {
  settings: { profile: 'baseline', servers: 1, startedAt: '2026-10-13T14:00:00.000Z', commit: 'aaa1111' },
  numbers: { requests: 10_000, requests_per_s: 200, changes_p95_ms: 200, reads_p95_ms: 100, error_rate: 0.01, races: 0, webhook_lag_p95_ms: null, backlog_active: 50 },
}
const b: Summary = {
  settings: { profile: 'baseline', servers: 2, startedAt: '2026-10-13T14:30:00.000Z', commit: 'aaa1111' },
  numbers: { requests: 20_000, requests_per_s: 250, changes_p95_ms: 209, reads_p95_ms: 150, error_rate: 0.005, races: 3, webhook_lag_p95_ms: 40, backlog_active: 50 },
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

  it('gives no verdict within the noise floor, nor for the request total', () => {
    expect(table).toContain('| changes_p95_ms | 200 ms | 209 ms | +9 ms (+4.5%) |  |')
    expect(table).toContain('| requests | 10,000 | 20,000 | +10,000 (+100.0%) |  |')
    expect(verdict('reads_p95_ms', 100, 104.9)).toBe('')
    expect(verdict('reads_p95_ms', 100, 95.1)).toBe('')
    expect(verdict('reads_p95_ms', 100, 105)).toBe('worse')
    expect(verdict('reads_p95_ms', 100, 95)).toBe('better')
    expect(verdict('races', 0, 1)).toBe('worse')
    expect(verdict('requests', 100, 1000)).toBe('')
  })

  it('loads a results folder by absolute path, or relative to where the command ran', () => {
    const dir = mkdtempSync(join(tmpdir(), 'load-compare-'))
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(a))
    expect(load(dir).numbers.requests_per_s).toBe(200)
    expect(load(basename(dir), dirname(dir)).numbers.requests_per_s).toBe(200)
    expect(() => load('nope', dir)).toThrow(/relative to where you run the command/)
  })

  it('takes relative folders from INIT_CWD, which pnpm sets to where it was typed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'load-compare-'))
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(b))
    const was = process.env.INIT_CWD
    process.env.INIT_CWD = dirname(dir)
    try {
      expect(load(basename(dir)).settings.servers).toBe(2)
    } finally {
      if (was === undefined) delete process.env.INIT_CWD
      else process.env.INIT_CWD = was
    }
  })
})
