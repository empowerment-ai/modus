import { describe, expect, it } from 'vitest'
import { GIVE_UP_AFTER_MS, classify, loadEndpoints, matches, retryDelay, sign, verify } from './webhooks'

const SECRET = 'whsec-0123456789abcdef'
const OTHER = 'whsec-fedcba9876543210'
const noFile = (path: string): string => { throw new Error(`unexpected read of ${path}`) }
const file = (entries: unknown) => (path: string) => {
  expect(path).toBe('/etc/modus/hooks.json')
  return JSON.stringify(entries)
}
const FILE = { WEBHOOKS_FILE: '/etc/modus/hooks.json' }

/** The thrown message, for checking every problem is listed and no secret leaks. */
function problems(env: Record<string, string | undefined>, readFile = noFile): string {
  try {
    loadEndpoints(env, readFile)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected loadEndpoints to throw')
}

describe('loadEndpoints', () => {
  it('returns none when nothing is set, treating empty settings as unset', () => {
    expect(loadEndpoints({}, noFile)).toEqual([])
    expect(loadEndpoints({ WEBHOOK_URL: '', WEBHOOK_SECRET: '', WEBHOOKS_FILE: '' }, noFile)).toEqual([])
  })

  it('reads WEBHOOK_URL + WEBHOOK_SECRET as the endpoint "default"', () => {
    expect(loadEndpoints({ WEBHOOK_URL: 'https://hooks.example.com/modus', WEBHOOK_SECRET: SECRET }, noFile))
      .toEqual([{ name: 'default', url: 'https://hooks.example.com/modus', secret: SECRET }])
  })

  it('requires WEBHOOK_URL and WEBHOOK_SECRET together', () => {
    expect(problems({ WEBHOOK_URL: 'https://hooks.example.com/modus' })).toMatch(/WEBHOOK_SECRET is required/)
    const msg = problems({ WEBHOOK_SECRET: SECRET })
    expect(msg).toMatch(/WEBHOOK_URL is required/)
    expect(msg).not.toContain(SECRET)
  })

  it('reads a file of endpoints, with secretEnv and filters, alongside the env endpoint', () => {
    const env = {
      ...FILE,
      WEBHOOK_URL: 'https://hooks.example.com/all',
      WEBHOOK_SECRET: SECRET,
      OPS_HOOK_SECRET: OTHER,
    }
    const endpoints = loadEndpoints(env, file([
      { name: 'ops', url: 'https://ops.example.com/in', secretEnv: 'OPS_HOOK_SECRET', apps: ['app_invoice'], kinds: ['notify'] },
      { name: 'audit_log-2', url: 'https://audit.example.com/in', secret: SECRET },
    ]))
    expect(endpoints).toEqual([
      { name: 'default', url: 'https://hooks.example.com/all', secret: SECRET },
      { name: 'ops', url: 'https://ops.example.com/in', secret: OTHER, apps: ['app_invoice'], kinds: ['notify'] },
      { name: 'audit_log-2', url: 'https://audit.example.com/in', secret: SECRET },
    ])
  })

  it('checks names: required, the right shape, unique (including "default")', () => {
    const msg = problems({ ...FILE, WEBHOOK_URL: 'https://a.example.com', WEBHOOK_SECRET: SECRET }, file([
      { url: 'https://a.example.com', secret: SECRET },
      { name: 'Ops Team', url: 'https://a.example.com', secret: SECRET },
      { name: 'x'.repeat(41), url: 'https://a.example.com', secret: SECRET },
      { name: 'ops', url: 'https://a.example.com', secret: SECRET },
      { name: 'ops', url: 'https://b.example.com', secret: SECRET },
      { name: 'default', url: 'https://c.example.com', secret: SECRET },
    ]))
    expect(msg).toMatch(/\[0\].*name is required/)
    expect(msg).toMatch(/\[1\].*name must match/)
    expect(msg).toMatch(/\[2\].*name must match/)
    expect(msg).toMatch(/\[4\].*name "ops" is used twice/)
    expect(msg).toMatch(/\[5\].*name "default" is used twice/)
    expect(msg).not.toMatch(/\[3\]/)
    expect(msg).not.toContain(SECRET)
  })

  it('requires https URLs unless WEBHOOKS_ALLOW_HTTP is true', () => {
    const entries = [
      { name: 'plain', url: 'http://localhost:9000/in', secret: SECRET },
      { name: 'garbage', url: 'not a url', secret: SECRET },
      { name: 'ftp', url: 'ftp://files.example.com', secret: SECRET },
      { name: 'none', secret: SECRET },
    ]
    const msg = problems(FILE, file(entries))
    expect(msg).toMatch(/plain.*https/)
    expect(msg).toMatch(/garbage.*not a valid URL/)
    expect(msg).toMatch(/ftp.*https/)
    expect(msg).toMatch(/none.*url is required/)
    expect(problems({ WEBHOOK_URL: 'http://localhost:9000', WEBHOOK_SECRET: SECRET })).toMatch(/WEBHOOK_URL.*https/)

    const allowed = problems({ ...FILE, WEBHOOKS_ALLOW_HTTP: 'true' }, file(entries))
    expect(allowed).not.toMatch(/plain/)
    expect(allowed).toMatch(/ftp.*http/)
    expect(loadEndpoints({ WEBHOOK_URL: 'http://localhost:9000', WEBHOOK_SECRET: SECRET, WEBHOOKS_ALLOW_HTTP: 'true' }, noFile))
      .toEqual([{ name: 'default', url: 'http://localhost:9000', secret: SECRET }])
    expect(problems({ WEBHOOK_URL: 'http://localhost:9000', WEBHOOK_SECRET: SECRET, WEBHOOKS_ALLOW_HTTP: 'yes' })).toMatch(/https/)
  })

  it('never echoes a URL, which may carry a token', () => {
    const msg = problems({ WEBHOOK_URL: 'http://hooks.example.com/?token=abc123def456', WEBHOOK_SECRET: SECRET })
    expect(msg).not.toContain('abc123def456')
  })

  it('rejects credentials in a URL without echoing them', () => {
    const env = problems({ WEBHOOK_URL: 'https://hookuser:pa55word-xyz@hooks.example.com/in', WEBHOOK_SECRET: SECRET })
    expect(env).toMatch(/WEBHOOK_URL: url must not contain a username or password/)
    expect(env).not.toMatch(/pa55word-xyz|hookuser/)
    const msg = problems(FILE, file([{ name: 'a', url: 'https://hookuser@hooks.example.com/in', secret: SECRET }]))
    expect(msg).toMatch(/\(a\).*username or password/)
    expect(msg).not.toContain('hookuser')
  })

  it('echoes an entry name only when it is well formed', () => {
    const msg = problems(FILE, file([{ name: 'https://x.example.com/?k=leaky-value', url: 'https://a.example.com', secret: 'short' }]))
    expect(msg).toMatch(/WEBHOOKS_FILE\[0\]: name must match/)
    expect(msg).toMatch(/WEBHOOKS_FILE\[0\]: secret must be/)
    expect(msg).not.toContain('leaky-value')
  })

  it('requires a secret of at least 16 characters, from secret or secretEnv, without leaking it', () => {
    const short = 'tooshort-123'
    const msg = problems({ ...FILE, SHORT_ENV: short, WEBHOOK_URL: 'https://a.example.com', WEBHOOK_SECRET: short }, file([
      { name: 'a', url: 'https://a.example.com' },
      { name: 'b', url: 'https://a.example.com', secret: short },
      { name: 'c', url: 'https://a.example.com', secretEnv: 'MISSING_ENV' },
      { name: 'd', url: 'https://a.example.com', secretEnv: 'SHORT_ENV' },
      { name: 'e', url: 'https://a.example.com', secret: SECRET, secretEnv: 'SHORT_ENV' },
    ]))
    expect(msg).toMatch(/WEBHOOK_SECRET must be at least 16 characters/)
    expect(msg).toMatch(/\(a\).*secret or secretEnv is required/)
    expect(msg).toMatch(/\(b\).*secret must be at least 16 characters/)
    expect(msg).toMatch(/\(c\).*MISSING_ENV is not set/)
    expect(msg).toMatch(/\(d\).*SHORT_ENV must be at least 16 characters/)
    expect(msg).toMatch(/\(e\).*not both/)
    expect(msg).not.toContain(short)
    expect(msg).not.toContain(SECRET)
  })

  it('checks the apps and kinds filters', () => {
    const msg = problems(FILE, file([
      { name: 'a', url: 'https://a.example.com', secret: SECRET, apps: 'app_invoice' },
      { name: 'b', url: 'https://a.example.com', secret: SECRET, apps: [''] },
      { name: 'c', url: 'https://a.example.com', secret: SECRET, kinds: ['job.ready', 'email'] },
      { name: 'd', url: 'https://a.example.com', secret: SECRET, kinds: [] },
    ]))
    expect(msg).toMatch(/\(a\).*apps must be a list/)
    expect(msg).toMatch(/\(b\).*apps must be a list/)
    expect(msg).toMatch(/\(c\).*kinds.*email/)
    expect(msg).toMatch(/\(d\).*kinds must not be empty/)
  })

  it('rejects unknown keys, so a typo never silently widens a filter', () => {
    expect(problems(FILE, file([{ name: 'a', url: 'https://a.example.com', secret: SECRET, kind: ['notify'] }])))
      .toMatch(/\(a\).*unknown key "kind"/)
  })

  it('reports a file it cannot read or parse, without echoing its contents', () => {
    expect(problems(FILE, () => { throw new Error('ENOENT') })).toMatch(/WEBHOOKS_FILE.*cannot read \/etc\/modus\/hooks.json/)
    const msg = problems(FILE, () => `[{"name":"a","secret":"${SECRET}",}]`)
    expect(msg).toMatch(/WEBHOOKS_FILE.*not valid JSON/)
    expect(msg).not.toContain(SECRET)
    expect(problems(FILE, file({ name: 'a' }))).toMatch(/WEBHOOKS_FILE.*JSON array/)
    expect(problems(FILE, file(['ops']))).toMatch(/\[0\].*must be an object/)
  })

  it('lists every problem at once, env and file together', () => {
    const msg = problems({ ...FILE, WEBHOOK_URL: 'https://a.example.com' }, file([
      { name: 'a', url: 'http://a.example.com', secret: SECRET },
      { name: 'b', url: 'https://b.example.com', secret: 'short' },
    ]))
    expect(msg.split('\n').length).toBeGreaterThanOrEqual(3)
    expect(msg).toMatch(/WEBHOOK_SECRET/)
    expect(msg).toMatch(/\(a\)/)
    expect(msg).toMatch(/\(b\)/)
  })
})

describe('matches', () => {
  const e = { name: 'x', url: 'https://x.example.com', secret: SECRET }
  it('matches everything without filters', () => {
    expect(matches(e, { appId: 'app_a', kind: 'job.ready' })).toBe(true)
    expect(matches(e, { appId: 'app_b', kind: 'notify' })).toBe(true)
  })
  it('applies apps and kinds filters together', () => {
    const f = { ...e, apps: ['app_a'], kinds: ['notify' as const] }
    expect(matches(f, { appId: 'app_a', kind: 'notify' })).toBe(true)
    expect(matches(f, { appId: 'app_a', kind: 'job.ready' })).toBe(false)
    expect(matches(f, { appId: 'app_b', kind: 'notify' })).toBe(false)
  })
})

describe('sign and verify', () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0, 345)
  const body = JSON.stringify({ id: 1, kind: 'notify' })

  it('signs in the t=<seconds>,v1=<hex> form and verifies the round trip', () => {
    const header = sign(SECRET, body, now)
    expect(header).toMatch(/^t=1791892800,v1=[0-9a-f]{64}$/)
    expect(verify(SECRET, body, header, now)).toBe(true)
    expect(verify(SECRET, body, header, now + 5 * 60_000 - 1000)).toBe(true)
  })

  it('rejects a tampered body, another secret, a stale or malformed header', () => {
    const header = sign(SECRET, body, now)
    expect(verify(SECRET, body + ' ', header, now)).toBe(false)
    expect(verify(OTHER, body, header, now)).toBe(false)
    expect(verify(SECRET, body, header, now + 5 * 60_000 + 1000)).toBe(false)
    expect(verify(SECRET, body, header, now + 60_000, 30_000)).toBe(false)
    expect(verify(SECRET, body, header.replace(/t=\d+/, 't=1791892801'), now)).toBe(false)
    expect(verify(SECRET, body, header.slice(0, -2), now)).toBe(false)
    expect(verify(SECRET, body, 'garbage', now)).toBe(false)
    expect(verify(SECRET, body, '', now)).toBe(false)
    expect(verify(SECRET, body, undefined as unknown as string, now)).toBe(false)
    expect(verify(SECRET, body, [header] as unknown as string, now)).toBe(false)
    expect(verify(SECRET, body, header.replace(/t=(\d+)/, 't=0$1'), now)).toBe(false)
    const zero = sign(SECRET, body, 0) // t=0 is never a real send time
    expect(verify(SECRET, body, zero, 0)).toBe(false)
  })
})

describe('retryDelay', () => {
  it('backs off 10 s, 30 s, 2 min, 10 min, 1 h, then hourly, by attempts made before the failure', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(retryDelay)).toEqual([
      10_000, 30_000, 120_000, 600_000, 3_600_000, 3_600_000, 3_600_000, 3_600_000,
    ])
    expect(GIVE_UP_AFTER_MS).toBe(86_400_000)
  })
})

describe('classify', () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0)
  const res = (status: number, headers: Record<string, string> = {}, text?: string) =>
    classify({ status, headers: new Headers(headers), text }, now)

  it('treats 2xx as delivered', () => {
    expect(res(200)).toEqual({ ok: true })
    expect(res(204)).toEqual({ ok: true })
  })

  it('fails redirects and other 4xx at once', () => {
    expect(res(301, { location: 'https://elsewhere.example.com' })).toMatchObject({ ok: false, retry: false, status: 301, error: expect.stringMatching(/redirect/) })
    expect(res(400, {}, 'bad payload')).toEqual({ ok: false, retry: false, status: 400, error: 'HTTP 400: bad payload' })
    expect(res(404)).toEqual({ ok: false, retry: false, status: 404, error: 'HTTP 404' })
  })

  it('retries 408, 429, 5xx, honoring Retry-After in seconds or as a date', () => {
    expect(res(408)).toMatchObject({ ok: false, retry: true, status: 408 })
    expect(res(429, { 'retry-after': '120' })).toEqual({ ok: false, retry: true, retryAfterMs: 120_000, status: 429, error: 'HTTP 429' })
    expect(res(500, {}, 'oops')).toEqual({ ok: false, retry: true, status: 500, error: 'HTTP 500: oops' })
    expect(res(503, { 'retry-after': new Date(now + 90_000).toUTCString() })).toMatchObject({ retry: true, retryAfterMs: 90_000, status: 503 })
    expect(res(503, { 'retry-after': new Date(now - 90_000).toUTCString() })).toMatchObject({ retry: true, retryAfterMs: 0 })
    expect(res(503, { 'retry-after': 'soon' })).not.toHaveProperty('retryAfterMs')
    // Bare numbers that aren't whole seconds are not dates (Date.parse would read them as years).
    expect(res(503, { 'retry-after': '1.5' })).not.toHaveProperty('retryAfterMs')
    expect(res(503, { 'retry-after': '-5' })).not.toHaveProperty('retryAfterMs')
  })

  it('caps Retry-After at GIVE_UP_AFTER_MS', () => {
    expect(res(429, { 'retry-after': '999999999999' })).toMatchObject({ retryAfterMs: GIVE_UP_AFTER_MS })
    expect(res(503, { 'retry-after': new Date(now + 400 * 86_400_000).toUTCString() })).toMatchObject({ retryAfterMs: GIVE_UP_AFTER_MS })
  })

  it('trims errors to 500 code points, on one line', () => {
    const out = res(500, {}, 'x'.repeat(2000))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toHaveLength(500)
    const emoji = res(500, {}, '\u{1F600}'.repeat(600))
    if (!emoji.ok) {
      expect(Array.from(emoji.error)).toHaveLength(500)
      expect(emoji.error).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    }
    expect(res(500, {}, 'line one\nline\ttwo\u0000')).toMatchObject({ error: 'HTTP 500: line one line two' })
  })

  it('retries thrown network errors and timeouts', () => {
    const net = classify({ error: new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:9') }) }, now)
    expect(net).toEqual({ ok: false, retry: true, error: 'TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:9)' })
    const abort = classify({ error: new DOMException('This operation was aborted', 'AbortError') }, now)
    expect(abort).toMatchObject({ ok: false, retry: true, error: expect.stringMatching(/AbortError/) })
    expect(abort).not.toHaveProperty('status')
    expect(classify({ error: 'weird' }, now)).toEqual({ ok: false, retry: true, error: 'weird' })
  })

  it('strips URLs from thrown errors, which may carry credentials', () => {
    const out = classify({ error: new TypeError('Request cannot be constructed from a URL that includes credentials: https://u:s3cr3t-pw@hooks.example.com/in') }, now)
    expect(out).toEqual({ ok: false, retry: true, error: 'TypeError: Request cannot be constructed from a URL that includes credentials: <url>' })
    expect(classify({ error: 'failed on http://u:s3cr3t-pw@x.example.com' }, now)).toEqual({ ok: false, retry: true, error: 'failed on <url>' })
  })
})
