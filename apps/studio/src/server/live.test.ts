import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExplorerRow, SimView } from '@modus-bpm/core'
import type { MonitorSnapshot, ServerDesign } from './client'
import { fakeStream, json } from './fakes'
import { createLiveStore } from './live'

const design = {
  apps: [],
  users: [
    { id: 'u_ann', name: 'Ann', title: '', color: '', speed: 1, available: true },
    { id: 'u_boss', name: 'Boss', title: '', color: '', speed: 1, available: true, roles: ['admin'] },
    { id: 'u_root', name: 'Root', title: '', color: '', speed: 1, available: true, roles: ['admin'] },
  ],
  groups: [],
  services: [],
  templates: [],
} as unknown as ServerDesign

const snapshot = (clock: number, total = 1): MonitorSnapshot => ({
  clock,
  view: { clock, nodes: { s1: { total }, s2: { total: 0 } }, active: total } as unknown as SimView,
  expeditedByStep: {},
  working: {},
})

const row = (id: string) => ({ id, number: id }) as unknown as ExplorerRow

/** A fake Modus server: routes by path, records every request, and hands out SSE streams the test drives. */
function fakeServer() {
  const calls: Array<{ path: string; user: string | null }> = []
  const streams: Array<ReturnType<typeof fakeStream>> = []
  const s = {
    calls,
    streams,
    clock: 10,
    admins: new Set(['u_boss', 'u_root']),
    paths: (prefix: string) => calls.filter((c) => c.path.startsWith(prefix)).map((c) => c.path),
    stream: () => streams[streams.length - 1]!,
    fetch: vi.fn(async (path: string, init?: RequestInit) => {
      const user = new Headers(init?.headers).get('x-user-id')
      calls.push({ path, user })
      const url = new URL(path, 'http://x')
      if (path === '/api/health') return json({ ok: true, apps: 1 })
      if (path === '/api/design') return json(design)
      if (url.pathname.endsWith('/stream')) {
        streams.push(fakeStream())
        return s.stream().response()
      }
      if (!s.admins.has(user ?? '')) return json({ ok: false, error: 'Only an administrator can see the Monitor.' }, 403)
      if (url.pathname.endsWith('/monitor')) return json(snapshot(s.clock))
      if (url.pathname.endsWith('/monitor/series')) {
        const since = url.searchParams.get('since')
        const all = [0, 5, 10].concat(s.clock > 10 ? [s.clock] : []).map((t) => ({ t, wip: t, done: 0 }))
        return json({ points: since === null ? all : all.filter((p) => p.t > Number(since)) })
      }
      if (url.pathname.endsWith('/monitor/feed')) return json({ entries: [{ at: s.clock, objectId: 'o1', number: 'INV-1', kind: 'created', text: 'Created' }] })
      if (url.pathname.endsWith('/monitor/items')) {
        const cursor = url.searchParams.get('cursor')
        return json(cursor ? { items: [row('o3')], total: 3 } : { items: [row('o1'), row('o2')], total: 3, next: 'c1' })
      }
      return json({ ok: false, error: 'not found' }, 404)
    }),
  }
  return s
}

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('live store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = async (storage = memory()) => {
    const server = fakeServer()
    const store = createLiveStore({ fetch: server.fetch, storage })
    await store.getState().detect()
    return { server, store, storage }
  }

  it('detects a server, or stays off and never sends a request without one', async () => {
    const { store } = await setup()
    expect(store.getState()).toMatchObject({ available: true, mode: 'live' })

    const f = vi.fn(async () => new Response('<!doctype html>'))
    const off = createLiveStore({ fetch: f, storage: null })
    expect(await off.getState().detect()).toBe(false)
    expect(off.getState().available).toBe(false)
    f.mockClear()
    await off.getState().connect('app_invoice')
    off.getState().setFilters({ q: 'x' })
    await off.getState().loadMore()
    off.getState().refresh()
    await vi.advanceTimersByTimeAsync(5000)
    expect(f).not.toHaveBeenCalled()
    expect(off.getState().status).toBe('idle')
  })

  it('connect loads the design, monitor, series, feed and items as the first administrator, then goes live', async () => {
    const { server, store, storage } = await setup()
    await store.getState().connect('app_invoice')
    await flush()
    const s = store.getState()
    expect(s.actingAdmin).toBe('u_boss')
    expect(storage.m.get('modus-live-admin')).toBe('u_boss')
    expect(s.design).toEqual(design)
    expect(s.monitor?.clock).toBe(10)
    expect(s.series.map((p) => p.t)).toEqual([0, 5, 10])
    expect(s.feed).toHaveLength(1)
    expect(s.explorer).toMatchObject({ rows: [row('o1'), row('o2')], total: 3, next: 'c1' })
    expect(s.status).toBe('live')
    expect(s.lastUpdate).toBeTypeOf('number')
    expect(server.paths('/api/apps/app_invoice/stream')).toHaveLength(1)
    expect(server.calls.filter((c) => c.path.startsWith('/api/apps')).every((c) => c.user === 'u_boss')).toBe(true)
  })

  it('keeps a remembered administrator', async () => {
    const storage = memory()
    storage.setItem('modus-live-admin', 'u_root')
    const { store } = await setup(storage)
    await store.getState().connect('app_invoice')
    expect(store.getState().actingAdmin).toBe('u_root')
  })

  it('applies counts at once and refetches once per second for a burst, series incrementally', async () => {
    const { server, store } = await setup()
    await store.getState().connect('app_invoice')
    await flush()
    const before = server.calls.length
    server.clock = 20
    for (let i = 0; i < 5; i++) server.stream().change({ clock: 20, items: ['o1'], counts: { s1: 7, s2: 2 }, active: 9 })
    await flush()
    const view = store.getState().monitor!.view
    expect(view.nodes.s1!.total).toBe(7)
    expect(view.nodes.s2!.total).toBe(2)
    expect(view.active).toBe(9)
    expect(server.calls.length).toBe(before)

    await vi.advanceTimersByTimeAsync(1000)
    const after = server.calls.slice(before).map((c) => c.path)
    expect(after.filter((p) => p.endsWith('/monitor'))).toHaveLength(1)
    expect(after.filter((p) => p.includes('/monitor/feed'))).toHaveLength(1)
    expect(after.filter((p) => p.includes('/monitor/series'))).toEqual(['/api/apps/app_invoice/monitor/series?since=10'])
    expect(store.getState().series.map((p) => p.t)).toEqual([0, 5, 10, 20])
    expect(store.getState().monitor!.clock).toBe(20)

    // Another event right after waits for the next second.
    server.stream().change({ clock: 21, items: ['o2'], counts: { s1: 7 }, active: 9 })
    await vi.advanceTimersByTimeAsync(500)
    expect(server.calls.slice(before).filter((c) => c.path.endsWith('/monitor'))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(server.calls.slice(before).filter((c) => c.path.endsWith('/monitor'))).toHaveLength(2)
  })

  it('items: null refetches everything', async () => {
    const { server, store } = await setup()
    await store.getState().connect('app_invoice')
    await flush()
    const before = server.calls.length
    server.stream().change({ clock: 30, items: null, counts: {}, active: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    const after = server.calls.slice(before).map((c) => c.path)
    expect(after).toContain('/api/apps/app_invoice/monitor/series')
    expect(after.some((p) => p.includes('/monitor/items'))).toBe(true)
    expect(after.some((p) => p.endsWith('/monitor'))).toBe(true)
    expect(after.some((p) => p.includes('/monitor/feed'))).toBe(true)
  })

  it('a dropped stream shows reconnecting, keeps the data, then goes live and refreshes', async () => {
    const { server, store } = await setup()
    await store.getState().connect('app_invoice')
    await flush()
    server.stream().fail()
    await flush()
    expect(store.getState().status).toBe('reconnecting')
    expect(store.getState().monitor?.clock).toBe(10)

    const before = server.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(server.paths('/api/apps/app_invoice/stream')).toHaveLength(2)
    expect(store.getState().status).toBe('live')
    await vi.advanceTimersByTimeAsync(1000)
    expect(server.calls.slice(before).map((c) => c.path)).toContain('/api/apps/app_invoice/monitor/series')
  })

  it('retries the connect when the design cannot be loaded', async () => {
    const { server, store } = await setup()
    const real = server.fetch.getMockImplementation()!
    server.fetch.mockImplementationOnce(async () => Promise.reject(new TypeError('offline')))
    await store.getState().connect('app_invoice')
    expect(store.getState().status).toBe('reconnecting')
    expect(server.paths('/api/apps/app_invoice/stream')).toHaveLength(0)
    server.fetch.mockImplementation(real)
    await vi.advanceTimersByTimeAsync(3000)
    expect(store.getState()).toMatchObject({ status: 'live', actingAdmin: 'u_boss' })
    expect(server.paths('/api/apps/app_invoice/stream')).toHaveLength(1)
  })

  it('a 403 sets the error and stops', async () => {
    const storage = memory()
    storage.setItem('modus-live-admin', 'u_ann')
    const { server, store } = await setup(storage)
    await store.getState().connect('app_invoice')
    await flush()
    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toMatch(/not an administrator/)
    expect(server.paths('/api/apps/app_invoice/stream')).toHaveLength(0)

    // Choosing an administrator connects again.
    store.getState().setActingAdmin('u_boss')
    await flush()
    expect(store.getState()).toMatchObject({ status: 'live', error: undefined, actingAdmin: 'u_boss' })
    expect(storage.m.get('modus-live-admin')).toBe('u_boss')
  })

  it('explorer: loadMore pages with the cursor, filter changes start over', async () => {
    const { server, store } = await setup()
    await store.getState().connect('app_invoice')
    await flush()
    await store.getState().loadMore()
    expect(server.paths('/api/apps/app_invoice/monitor/items').at(-1)).toContain('cursor=c1')
    expect(store.getState().explorer).toMatchObject({ rows: [row('o1'), row('o2'), row('o3')], next: undefined })
    await store.getState().loadMore() // nothing more
    expect(server.paths('/api/apps/app_invoice/monitor/items')).toHaveLength(2)

    store.getState().setFilters({ status: 'active', q: 'acme' })
    expect(store.getState().explorer).toMatchObject({ rows: [], loading: true, filters: { status: 'active', q: 'acme' } })
    await flush()
    const last = server.paths('/api/apps/app_invoice/monitor/items').at(-1)!
    expect(last).toContain('status=active')
    expect(last).toContain('q=acme')
    expect(last).not.toContain('cursor')
    expect(store.getState().explorer).toMatchObject({ rows: [row('o1'), row('o2')], next: 'c1', loading: false })
  })

  it('simulation mode closes the stream; live connects again', async () => {
    const { server, store } = await setup()
    await store.getState().connect('app_invoice')
    await flush()
    store.getState().setMode('simulation')
    await flush()
    expect(server.streams[0]!.cancelled()).toBe(true)
    expect(store.getState().status).toBe('idle')
    store.getState().setMode('live')
    await flush()
    expect(server.paths('/api/apps/app_invoice/stream')).toHaveLength(2)
    expect(store.getState().status).toBe('live')
  })
})
