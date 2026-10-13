import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, detectServer, getOcel, openStream, sseParser, type StreamState } from './client'
import { fakeStream, json } from './fakes'

describe('sseParser', () => {
  const parse = (...chunks: string[]) => {
    const out: Array<{ event: string; data: string }> = []
    const push = sseParser((e) => out.push(e))
    for (const c of chunks) push(c)
    return out
  }

  it('ignores comments and ends events on a blank line', () => {
    expect(parse(': connected\n\n: ping\n\nevent: change\ndata: {"a":1}\n\n')).toEqual([{ event: 'change', data: '{"a":1}' }])
  })

  it('joins multi-line data and defaults the event name', () => {
    expect(parse('data: one\ndata: two\n\n')).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })

  it('handles CRLF and lone CR, even split across chunks', () => {
    expect(parse('event: change\r', '\ndata: x\r\n\r', '\n', 'data: y\r\r', ': next')).toEqual([
      { event: 'change', data: 'x' },
      { event: 'message', data: 'y' },
    ])
  })

  it('waits for the rest of a line split across chunks', () => {
    expect(parse('event: cha', 'nge\nda', 'ta: {"b"', ':2}\n', '\n')).toEqual([{ event: 'change', data: '{"b":2}' }])
  })

  it('skips a blank line with no data and keeps a value without a space', () => {
    expect(parse('\n\nevent: x\n\ndata:raw\n\n')).toEqual([{ event: 'message', data: 'raw' }])
  })
})

describe('detectServer', () => {
  it('is true when /api/health answers ok', async () => {
    const f = vi.fn(async (_path: string, _init?: RequestInit) => json({ ok: true, apps: 1 }))
    expect(await detectServer(f)).toBe(true)
    expect(f.mock.calls[0]![0]).toBe('/api/health')
  })

  it('is false for HTML (a static host), an error status, a network failure or a timeout', async () => {
    expect(await detectServer(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))).toBe(false)
    expect(await detectServer(async () => json({ ok: false }, 503))).toBe(false)
    expect(await detectServer(async () => Promise.reject(new TypeError('offline')))).toBe(false)
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    expect(await detectServer(hang, 20)).toBe(false)
  })
})

describe('api', () => {
  it('sends x-user-id and parses JSON', async () => {
    const f = vi.fn(async () => json({ points: [] }))
    expect(await api('/api/apps/a/monitor/series?since=5', { user: 'u_admin', fetch: f })).toEqual({ points: [] })
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/apps/a/monitor/series?since=5')
    expect(new Headers(init.headers).get('x-user-id')).toBe('u_admin')
  })

  it('throws ApiError with the status and the server message', async () => {
    const err = (await api('/api/apps/a/monitor', { user: 'u', fetch: async () => json({ ok: false, error: 'Only an administrator can see the Monitor.' }, 403) }).catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(403)
    expect(err.message).toBe('Only an administrator can see the Monitor.')
  })

  it('downloads the OCEL log as a blob, as the given user', async () => {
    const f = vi.fn(async () => json({ objects: [], events: [] }))
    const blob = await getOcel('a b', { user: 'u_admin', fetch: f })
    expect(JSON.parse(await blob.text())).toEqual({ objects: [], events: [] })
    const [path, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/apps/a%20b/export/ocel')
    expect(new Headers(init.headers).get('x-user-id')).toBe('u_admin')
    await expect(getOcel('a', { user: 'u', fetch: async () => json({ error: 'nope' }, 404) })).rejects.toThrow('nope')
  })
})

describe('openStream', () => {
  afterEach(() => vi.useRealTimers())

  it('delivers change events, then reconnects with backoff after a drop', async () => {
    vi.useFakeTimers()
    const streams = [fakeStream(), fakeStream()]
    let n = 0
    const f = vi.fn(async (_: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-user-id')).toBe('u_admin')
      return streams[n++]!.response()
    })
    const events: unknown[] = []
    const states: StreamState[] = []
    const close = openStream('app_invoice', (e) => events.push(e), (s) => states.push(s), { user: 'u_admin', fetch: f })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.mock.calls[0]![0]).toBe('/api/apps/app_invoice/stream')
    expect(states).toEqual(['live'])

    streams[0]!.push(': connected\n\nevent: change\ndata: {"clock":3,"items":["o1"],"counts":{"s1":2},"active":2}\n\n')
    await vi.advanceTimersByTimeAsync(0)
    expect(events).toEqual([{ clock: 3, items: ['o1'], counts: { s1: 2 }, active: 2 }])

    streams[0]!.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual(['live', 'reconnecting'])
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f).toHaveBeenCalledTimes(2)
    expect(states).toEqual(['live', 'reconnecting', 'live'])

    close()
    await vi.advanceTimersByTimeAsync(0)
    expect(streams[1]!.cancelled()).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('reports every chunk to onActivity, keep-alive comments included', async () => {
    vi.useFakeTimers()
    const stream = fakeStream()
    const events: unknown[] = []
    const onActivity = vi.fn()
    const close = openStream('a', (e) => events.push(e), () => {}, { user: 'u', fetch: async () => stream.response(), onActivity })
    await vi.advanceTimersByTimeAsync(0)
    expect(onActivity).not.toHaveBeenCalled()
    stream.push(': connected\n\n')
    await vi.advanceTimersByTimeAsync(0)
    stream.push(': ping\n\n')
    await vi.advanceTimersByTimeAsync(0)
    expect(onActivity).toHaveBeenCalledTimes(2)
    expect(events).toEqual([])
    stream.change({ clock: 1, items: [], counts: {}, active: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(onActivity).toHaveBeenCalledTimes(3)
    close()
    await vi.advanceTimersByTimeAsync(0)
    expect(onActivity).toHaveBeenCalledTimes(3)
  })

  it('a stream silent for silentMs is dropped and retried; pings keep it open', async () => {
    vi.useFakeTimers()
    const streams = [fakeStream(), fakeStream()]
    let n = 0
    const f = vi.fn(async () => streams[n++]!.response())
    const states: StreamState[] = []
    const close = openStream('a', () => {}, (s) => states.push(s), { user: 'u', fetch: f, silentMs: 60_000 })
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(25_000)
      streams[0]!.push(': ping\n\n')
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual(['live'])
    expect(streams[0]!.cancelled()).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(streams[0]!.cancelled()).toBe(true)
    expect(states).toEqual(['live', 'reconnecting'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(f).toHaveBeenCalledTimes(2)
    expect(states).toEqual(['live', 'reconnecting', 'live'])
    close()
  })

  it('aborts a request that hangs before answering, and keeps backing off while the server stays silent', async () => {
    vi.useFakeTimers()
    const at: number[] = []
    // Never answers; only the abort ends it.
    const f = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          at.push(Date.now())
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const states: StreamState[] = []
    const start = Date.now()
    const close = openStream('a', () => {}, (s) => states.push(s), { user: 'u', fetch: f, silentMs: 10_000, backoffMs: 1000, maxBackoffMs: 8000 })
    await vi.advanceTimersByTimeAsync(10_000 + 1000 + 10_000 + 2000 + 10_000 + 4000 + 10_000 + 8000 + 10_000 + 8000)
    expect(states).toEqual(['reconnecting'])
    // Each attempt waits silentMs, then the delay doubles: 1, 2, 4, 8, 8 s. Never back to 1 s.
    expect(at.map((t) => t - start)).toEqual([0, 11_000, 23_000, 37_000, 55_000, 73_000])
    close()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(6)
  })

  it('decodes a multi-byte character split across chunks', async () => {
    vi.useFakeTimers()
    const stream = fakeStream()
    const events: Array<{ items: string[] | null }> = []
    const close = openStream('a', (e) => events.push(e), () => {}, { user: 'u', fetch: async () => stream.response() })
    await vi.advanceTimersByTimeAsync(0)
    const bytes = new TextEncoder().encode('event: change\ndata: {"clock":1,"items":["café"],"counts":{},"active":0}\n\n')
    const cut = bytes.indexOf(0xc3) + 1 // inside the two bytes of é
    stream.bytes(bytes.slice(0, cut))
    await vi.advanceTimersByTimeAsync(0)
    stream.bytes(bytes.slice(cut))
    await vi.advanceTimersByTimeAsync(0)
    expect(events.map((e) => e.items)).toEqual([['café']])
    close()
  })

  it('keeps reading when the consumer throws', async () => {
    vi.useFakeTimers()
    const stream = fakeStream()
    const seen: number[] = []
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const close = openStream(
      'a',
      (e) => {
        seen.push(e.clock)
        if (e.clock === 1) throw new Error('consumer bug')
      },
      () => {},
      { user: 'u', fetch: async () => stream.response() },
    )
    await vi.advanceTimersByTimeAsync(0)
    stream.change({ clock: 1, items: [], counts: {}, active: 0 })
    stream.change({ clock: 2, items: [], counts: {}, active: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([1, 2])
    expect(error).toHaveBeenCalledTimes(1)
    expect(stream.cancelled()).toBe(false)
    error.mockRestore()
    close()
  })

  it('stops for good on 403, cancelling the body, and reports it', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const body = new ReadableStream({ cancel: () => void (cancelled = true) })
    const f = vi.fn(async () => new Response(body, { status: 403 }))
    const states: StreamState[] = []
    const denied: number[] = []
    openStream('a', () => {}, (s) => states.push(s), { user: 'u', fetch: f, onDenied: (s) => denied.push(s) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(1)
    expect(denied).toEqual([403])
    expect(states).toEqual([])
    expect(cancelled).toBe(true)
  })

  it('stops for good on 404: the server doesn’t run the app', async () => {
    vi.useFakeTimers()
    const f = vi.fn(async () => json({ error: 'Unknown app' }, 404))
    const states: StreamState[] = []
    const gone = vi.fn()
    const denied = vi.fn()
    openStream('a', () => {}, (s) => states.push(s), { user: 'u', fetch: f, onNotFound: gone, onDenied: denied })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(1)
    expect(gone).toHaveBeenCalledTimes(1)
    expect(denied).not.toHaveBeenCalled()
    expect(states).toEqual([])
  })

  it('cancels the body of a failed response before retrying', async () => {
    vi.useFakeTimers()
    let cancelled = false
    const body = new ReadableStream({ cancel: () => void (cancelled = true) })
    const f = vi.fn(async () => new Response(body, { status: 502 }))
    const close = openStream('a', () => {}, () => {}, { user: 'u', fetch: f })
    await vi.advanceTimersByTimeAsync(0)
    expect(cancelled).toBe(true)
    close()
  })

  it('backs off further while the server stays down', async () => {
    vi.useFakeTimers()
    const f = vi.fn(async () => Promise.reject(new TypeError('offline')))
    const states: StreamState[] = []
    const close = openStream('a', () => {}, (s) => states.push(s), { user: 'u', fetch: f })
    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual(['reconnecting'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(f).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f).toHaveBeenCalledTimes(3)
    // Reported once, not on every failed attempt.
    expect(states).toEqual(['reconnecting'])
    close()
  })
})
