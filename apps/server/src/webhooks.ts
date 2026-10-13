import { createHmac, timingSafeEqual } from 'node:crypto'

/** Webhook endpoints, request signing, the retry schedule and response classification. Pure: no storage, no clock. */

export type Kind = 'job.ready' | 'notify'
const KINDS: readonly Kind[] = ['job.ready', 'notify']

export interface Endpoint {
  name: string
  url: string
  secret: string
  /** Only these applications / kinds; absent: all. */
  apps?: string[]
  kinds?: Kind[]
}

const NAME = /^[a-z0-9_-]{1,40}$/
const MIN_SECRET = 16
const FILE_KEYS = new Set(['name', 'url', 'secret', 'secretEnv', 'apps', 'kinds'])

/** Read endpoints from settings: WEBHOOK_URL + WEBHOOK_SECRET (name "default"), and/or WEBHOOKS_FILE (JSON array). Throws Error with every problem listed. */
export function loadEndpoints(env: Record<string, string | undefined>, readFile: (path: string) => string): Endpoint[] {
  // Empty settings count as unset, like the rest of the config (Helm renders absent values as '').
  const get = (k: string) => env[k] || undefined
  const allowHttp = get('WEBHOOKS_ALLOW_HTTP') === 'true'
  const problems: string[] = []
  const endpoints: Endpoint[] = []

  // Messages never quote a secret, nor a URL (it may carry a token in its query).
  const checkUrl = (where: string, url: unknown) => {
    if (url === undefined) return problems.push(`${where}: url is required`)
    let parsed: URL
    try {
      if (typeof url !== 'string') throw new Error()
      parsed = new URL(url)
    } catch {
      return problems.push(`${where}: url is not a valid URL`)
    }
    // fetch refuses credentials in a URL, and its error would then carry them into stored errors.
    if (parsed.username || parsed.password) problems.push(`${where}: url must not contain a username or password`)
    if (parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:')) return
    problems.push(`${where}: url must be https://${allowHttp ? ' or http://' : ' (WEBHOOKS_ALLOW_HTTP=true allows http://)'}`)
  }
  const checkSecret = (where: string, label: string, secret: string) => {
    if (secret.length < MIN_SECRET) problems.push(`${where}: ${label} must be at least ${MIN_SECRET} characters`)
  }

  const url = get('WEBHOOK_URL')
  const secret = get('WEBHOOK_SECRET')
  if (url !== undefined || secret !== undefined) {
    const before = problems.length
    if (url === undefined) problems.push('WEBHOOK_URL is required with WEBHOOK_SECRET')
    else checkUrl('WEBHOOK_URL', url)
    if (secret === undefined) problems.push('WEBHOOK_SECRET is required with WEBHOOK_URL')
    else checkSecret('WEBHOOK_SECRET', 'WEBHOOK_SECRET', secret)
    if (problems.length === before) endpoints.push({ name: 'default', url: url!, secret: secret! })
  }
  const names = new Set(endpoints.map(e => e.name))

  const path = get('WEBHOOKS_FILE')
  if (path !== undefined) {
    let text: string | undefined
    let entries: unknown
    try {
      text = readFile(path)
    } catch {
      problems.push(`WEBHOOKS_FILE: cannot read ${path}`)
    }
    if (text !== undefined) {
      try {
        entries = JSON.parse(text)
      } catch {
        // JSON.parse's message quotes the text around the fault, which may be a secret.
        problems.push(`WEBHOOKS_FILE: ${path} is not valid JSON`)
      }
    }
    if (entries !== undefined && !Array.isArray(entries)) problems.push(`WEBHOOKS_FILE: ${path} must hold a JSON array of endpoints`)
    if (Array.isArray(entries)) {
      entries.forEach((raw, i) => {
        const before = problems.length
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return problems.push(`WEBHOOKS_FILE[${i}]: must be an object`)
        const o = raw as Record<string, unknown>
        const name = typeof o.name === 'string' ? o.name : undefined
        // Echo the name only when it is well formed: anything else could be a pasted secret or URL.
        const where = `WEBHOOKS_FILE[${i}]${name !== undefined && NAME.test(name) ? ` (${name})` : ''}`

        for (const k of Object.keys(o)) if (!FILE_KEYS.has(k)) problems.push(`${where}: unknown key "${k}"`)
        if (o.name === undefined) problems.push(`${where}: name is required`)
        else if (name === undefined || !NAME.test(name)) problems.push(`${where}: name must match ${NAME.source}`)
        else if (names.has(name)) problems.push(`${where}: name "${name}" is used twice`)
        else names.add(name)

        checkUrl(where, o.url)

        let secret: string | undefined
        if (o.secret !== undefined && o.secretEnv !== undefined) problems.push(`${where}: give secret or secretEnv, not both`)
        else if (o.secret !== undefined) {
          if (typeof o.secret !== 'string') problems.push(`${where}: secret must be a string`)
          else checkSecret(where, 'secret', (secret = o.secret))
        } else if (o.secretEnv !== undefined) {
          if (typeof o.secretEnv !== 'string' || !o.secretEnv) problems.push(`${where}: secretEnv must name an environment variable`)
          else if ((secret = get(o.secretEnv)) === undefined) problems.push(`${where}: ${o.secretEnv} is not set`)
          else checkSecret(where, o.secretEnv, secret)
        } else problems.push(`${where}: secret or secretEnv is required`)

        const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0)
        if (o.apps !== undefined) {
          if (!isList(o.apps)) problems.push(`${where}: apps must be a list of application ids`)
          // An empty filter would match nothing; almost certainly a mistake.
          else if (!o.apps.length) problems.push(`${where}: apps must not be empty (leave it out for all)`)
        }
        if (o.kinds !== undefined) {
          if (!isList(o.kinds)) problems.push(`${where}: kinds must be a list of ${KINDS.join(', ')}`)
          else if (!o.kinds.length) problems.push(`${where}: kinds must not be empty (leave it out for all)`)
          else {
            const bad = o.kinds.filter(k => !KINDS.includes(k as Kind))
            if (bad.length) problems.push(`${where}: kinds must be ${KINDS.join(', ')}, not ${bad.join(', ')}`)
          }
        }

        if (problems.length > before) return
        const e: Endpoint = { name: name!, url: o.url as string, secret: secret! }
        if (o.apps !== undefined) e.apps = [...(o.apps as string[])]
        if (o.kinds !== undefined) e.kinds = [...(o.kinds as Kind[])]
        endpoints.push(e)
      })
    }
  }

  if (problems.length) throw new Error(problems.join('\n'))
  return endpoints
}

export function matches(e: Endpoint, m: { appId: string; kind: string }): boolean {
  return (!e.apps || e.apps.includes(m.appId)) && (!e.kinds || e.kinds.includes(m.kind as Kind))
}

const hmac = (secret: string, t: number, body: string) => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>` */
export function sign(secret: string, body: string, now: number): string {
  const t = Math.floor(now / 1000)
  return `t=${t},v1=${hmac(secret, t, body)}`
}

/** For receivers and tests: true when the header is valid and at most `toleranceMs` old. */
export function verify(secret: string, body: string, header: string, now: number, toleranceMs = 5 * 60_000): boolean {
  // Receivers pass whatever arrived, which may be a missing header or an array of them.
  if (typeof header !== 'string') return false
  const parts = header.split(',').map(p => p.trim().split('='))
  const ts = parts.find(([k]) => k === 't')?.[1]
  if (!ts || !/^[1-9]\d*$/.test(ts)) return false
  const t = Number(ts)
  // Either direction: a receiver's clock may run ahead of or behind ours.
  if (Math.abs(now - t * 1000) > toleranceMs) return false
  const expected = Buffer.from(hmac(secret, t, body), 'hex')
  // Several v1 values let a sender sign with old and new secrets while rotating.
  return parts.some(([k, v]) => {
    if (k !== 'v1' || !v || !/^[0-9a-f]{64}$/.test(v)) return false
    return timingSafeEqual(Buffer.from(v, 'hex'), expected)
  })
}

const SCHEDULE = [10_000, 30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000]

/** Delay before the next attempt after a failure, given the attempts made before that failure: 0 → 10 s, 1 → 30 s, 2 → 2 min, 3 → 10 min, 4+ → 1 h. */
export function retryDelay(attempts: number): number {
  return SCHEDULE[Math.min(Math.max(0, attempts), SCHEDULE.length - 1)]!
}
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000

export type Outcome = { ok: true } | { ok: false; retry: boolean; retryAfterMs?: number; status?: number; error: string }

const MAX_ERROR = 500
/** Errors are stored and shown in admin screens: one line, at most MAX_ERROR code points (never a split surrogate pair). */
// eslint-disable-next-line no-control-regex
const trim = (s: string) => Array.from(s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()).slice(0, MAX_ERROR).join('')

/** Retry-After: whole seconds, or an HTTP date (which always contains letters); anything else is ignored. Capped at GIVE_UP_AFTER_MS, beyond which we stop anyway. */
function retryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^\d+$/.test(v)) return Math.min(Number(v) * 1000, GIVE_UP_AFTER_MS)
  // Date.parse reads bare numbers like '1.5' or '-5' as years; only text with letters can be a date.
  if (!/[a-z]/i.test(v)) return undefined
  const at = Date.parse(v)
  return Number.isNaN(at) ? undefined : Math.min(Math.max(0, at - now), GIVE_UP_AFTER_MS)
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return stripUrls(String(err))
  // undici hides the useful part (ECONNREFUSED, ENOTFOUND, …) in `cause` behind "fetch failed".
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : ''
  return stripUrls(`${err.name}: ${err.message}${cause}`)
}

/** Defense in depth: a URL in an error may carry credentials or a token, so it never reaches storage. */
const stripUrls = (s: string) => s.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, '<url>')

/**
 * Classify a response (or a thrown network/timeout error): 2xx ok; 408/429/5xx and errors retry; other 4xx (and 3xx: redirects aren't followed) fail.
 * `now` only turns a Retry-After date into a delay.
 */
export function classify(res: { status: number; headers: Headers; text?: string } | { error: unknown }, now: number): Outcome {
  if ('error' in res) return { ok: false, retry: true, error: trim(describe(res.error)) }
  const { status } = res
  if (status >= 200 && status < 300) return { ok: true }
  const text = res.text?.trim()
  const error = trim(`HTTP ${status}${status >= 300 && status < 400 ? ' (redirects are not followed)' : ''}${text ? `: ${text}` : ''}`)
  const retry = status === 408 || status === 429 || status >= 500
  if (!retry) return { ok: false, retry, status, error }
  const after = retryAfter(res.headers.get('retry-after'), now)
  return after === undefined ? { ok: false, retry, status, error } : { ok: false, retry, retryAfterMs: after, status, error }
}
