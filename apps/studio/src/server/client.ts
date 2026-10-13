// The Studio's client for a Modus server: detection, the Monitor's read endpoints and the live stream.
// Browser-only APIs (fetch, ReadableStream, TextDecoder): the same file runs in Vitest on Node.
// Identity is the prototype's `x-user-id` header until OIDC lands.

import type { Design, ExplorerRow, FeedEntry, Id, ServiceDef, SimState, SimView, WorkingOn } from '@modus-bpm/core'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ApiOptions {
  user: Id
  fetch?: Fetch
  signal?: AbortSignal
}

/** The published design as the server sends it: services without their connection details. */
export type ServerDesign = Omit<Design, 'services'> & { services: Array<Omit<ServiceDef, 'endpoint' | 'secretRef' | 'auth' | 'owner'>> }

export interface MonitorSnapshot {
  clock: number
  view: SimView
  expeditedByStep: Record<Id, number>
  working: Record<Id, WorkingOn>
}

export type SeriesPoint = SimState['series'][number]

export type ItemStatus = 'all' | 'active' | 'completed' | 'rejected'

export interface ItemFilters {
  status: ItemStatus
  type?: Id
  step?: Id
  assignee?: Id
  q: string
}

export interface ItemsPage {
  items: ExplorerRow[]
  total: number
  /** Present when there are more rows after these. */
  next?: string
}

/** One `change` event of the stream. `items: null` means "too much changed: refetch everything". */
export interface ChangeEvent {
  clock: number
  items: Id[] | null
  counts: Record<Id, number>
  active: number
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Is the Studio served by a Modus server? One GET /api/health: a static host (Pages, `vite dev`) answers
 * with HTML or 404, and an unreachable one times out. Never throws.
 */
export async function detectServer(f: Fetch = fetch, timeoutMs = 1500): Promise<boolean> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await f('/api/health', { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return false
    const body: unknown = await res.json()
    return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** A GET as `o.user`; an error answer throws an ApiError with the server's message. */
async function request(path: string, o: ApiOptions): Promise<Response> {
  const res = await (o.fetch ?? fetch)(path, { signal: o.signal, headers: { accept: 'application/json', 'x-user-id': o.user } })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim()
    try {
      const body = (await res.json()) as { error?: unknown; message?: unknown }
      if (typeof body.error === 'string') message = body.error
      else if (typeof body.message === 'string') message = body.message
    } catch {}
    throw new ApiError(res.status, message)
  }
  return res
}

export async function api<T>(path: string, o: ApiOptions): Promise<T> {
  return (await (await request(path, o)).json()) as T
}

const appPath = (appId: Id) => `/api/apps/${encodeURIComponent(appId)}`

export const getDesign = (o: ApiOptions) => api<ServerDesign>('/api/design', o)

export const getMonitor = (appId: Id, o: ApiOptions) => api<MonitorSnapshot>(`${appPath(appId)}/monitor`, o)

/** Points after `since` only, when given. */
export const getSeries = (appId: Id, since: number | undefined, o: ApiOptions) =>
  api<{ points: SeriesPoint[] }>(`${appPath(appId)}/monitor/series${since === undefined ? '' : `?since=${since}`}`, o)

/** Newest first. */
export const getFeed = (appId: Id, limit: number, o: ApiOptions) => api<{ entries: FeedEntry[] }>(`${appPath(appId)}/monitor/feed?limit=${limit}`, o)

/** The event log as OCEL 2.0 JSON, as a file to save (a plain link can't send `x-user-id`). */
export const getOcel = async (appId: Id, o: ApiOptions) => (await request(`${appPath(appId)}/export/ocel`, o)).blob()

export function getItems(appId: Id, f: ItemFilters, page: { limit: number; cursor?: string }, o: ApiOptions) {
  const q = new URLSearchParams({ status: f.status, limit: String(page.limit) })
  if (f.type) q.set('type', f.type)
  if (f.step) q.set('step', f.step)
  if (f.assignee) q.set('assignee', f.assignee)
  if (f.q) q.set('q', f.q)
  if (page.cursor) q.set('cursor', page.cursor)
  return api<ItemsPage>(`${appPath(appId)}/monitor/items?${q}`, o)
}

// ---------- The live stream ----------

export interface SseEvent {
  event: string
  data: string
}

/**
 * A Server-Sent Events parser: feed it decoded text in any chunks. Comment lines (`:`) are skipped,
 * an event ends at a blank line, `data` lines join with newlines, and CRLF, LF or CR all end a line.
 */
export function sseParser(onEvent: (e: SseEvent) => void): (chunk: string) => void {
  let buffer = ''
  let event = ''
  let data: string[] = []
  const line = (l: string) => {
    if (l === '') {
      if (data.length) onEvent({ event: event || 'message', data: data.join('\n') })
      event = ''
      data = []
      return
    }
    if (l.startsWith(':')) return
    const colon = l.indexOf(':')
    const field = colon < 0 ? l : l.slice(0, colon)
    let value = colon < 0 ? '' : l.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return (chunk) => {
    buffer += chunk
    // A CR at the very end may be the first half of a CRLF: wait for the next chunk to tell.
    const end = buffer.endsWith('\r') ? buffer.length - 1 : buffer.length
    const re = /\r\n|\r|\n/g
    let start = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(buffer)) && m.index < end) {
      line(buffer.slice(start, m.index))
      start = m.index + m[0].length
    }
    buffer = buffer.slice(start)
  }
}

export type StreamState = 'live' | 'reconnecting'

export interface StreamOptions extends Omit<ApiOptions, 'signal'> {
  /** First retry delay; doubles per failed attempt up to `maxBackoffMs`. */
  backoffMs?: number
  maxBackoffMs?: number
  /** The server refused who we are (401/403): retrying won't help, so the stream stops for good. */
  onDenied?: (status: number) => void
  /** The server doesn't run this app (404): the stream stops for good too. */
  onNotFound?: () => void
}

/**
 * Follows `/api/apps/:app/stream` and reconnects with backoff when it drops. Uses fetch and a reader rather
 * than EventSource, which can't send the `x-user-id` header. `onState` reports 'live' on each (re)connect
 * and 'reconnecting' once per outage; a 401 or 403 ends it through `onDenied`, a 404 through `onNotFound`. Returns a function that closes the stream for good.
 */
export function openStream(appId: Id, onEvent: (e: ChangeEvent) => void, onState: (s: StreamState) => void, o: StreamOptions): () => void {
  const f = o.fetch ?? fetch
  const first = o.backoffMs ?? 1000
  const max = o.maxBackoffMs ?? 15_000
  let closed = false
  let delay = first
  let state: StreamState | undefined
  let ctl: AbortController | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const report = (s: StreamState) => {
    if (closed || s === state) return
    state = s
    onState(s)
  }

  const run = async () => {
    ctl = new AbortController()
    try {
      const res = await f(`${appPath(appId)}/stream`, { signal: ctl.signal, headers: { accept: 'text/event-stream', 'x-user-id': o.user } })
      if (!res.ok || !res.body) {
        res.body?.cancel().catch(() => {})
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          if (!closed) {
            closed = true
            if (res.status === 404) o.onNotFound?.()
            else o.onDenied?.(res.status)
          }
          return
        }
        throw new ApiError(res.status, `stream: ${res.status}`)
      }
      if (closed) return void res.body.cancel().catch(() => {})
      reader = res.body.getReader()
      delay = first
      report('live')
      const decoder = new TextDecoder()
      const push = sseParser((e) => {
        if (e.event !== 'change') return
        let parsed: ChangeEvent
        try {
          parsed = JSON.parse(e.data) as ChangeEvent
        } catch {
          return // a malformed event: the next one or the throttled refetch catches up
        }
        try {
          onEvent(parsed)
        } catch (err) {
          // The consumer's bug, not the stream's: keep reading.
          console.error(err)
        }
      })
      for (;;) {
        const { done, value } = await reader.read()
        if (done || closed) break
        push(decoder.decode(value, { stream: true }))
      }
    } catch {
      // dropped, refused or unreachable: retry below
    }
    reader = undefined
    if (closed) return
    report('reconnecting')
    timer = setTimeout(run, delay)
    delay = Math.min(delay * 2, max)
  }

  void run()
  return () => {
    closed = true
    clearTimeout(timer)
    ctl?.abort()
    reader?.cancel().catch(() => {})
  }
}
