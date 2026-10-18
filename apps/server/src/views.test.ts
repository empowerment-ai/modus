import * as core from '@modus-bpm/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { memoryStorage } from './adapters/memory'
import { buildServer } from './http'
import { Runtime } from './runtime'

// The real computeView, counted: open streams, the overview and the Monitor share one per change.
vi.mock('@modus-bpm/core', async (original) => {
  const real = await original<typeof core>()
  return { ...real, computeView: vi.fn(real.computeView) }
})

let rt: Runtime
let api: FastifyInstance
let base: string

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  rt = await Runtime.create({ storage: memoryStorage() })
  api = buildServer(rt, { streamPingMs: 60_000 })
  base = await api.listen({ port: 0, host: '127.0.0.1' })
})

afterAll(async () => {
  await api.close()
  await rt.stop()
})

const as = (user: string) => ({ 'x-user-id': user })

/** An open stream, and a way to wait for its next change event. */
async function openStream(signal: AbortSignal) {
  const res = await fetch(`${base}/api/apps/app_invoice/stream`, { signal, headers: as('u_avery') })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  return {
    async nextChange() {
      while (!text.includes('event: change')) {
        const { value, done } = await reader.read()
        if (done) throw new Error('stream ended')
        text += decoder.decode(value, { stream: true })
      }
      const event = text.slice(text.indexOf('event: change'))
      text = ''
      return JSON.parse(event.split('\ndata: ')[1]!.split('\n')[0]!) as { counts: Record<string, number> }
    },
  }
}

describe('the view of a committed state', () => {
  it('is computed once per change, however many streams and Monitors read it', async () => {
    const abort = new AbortController()
    try {
      const streams = await Promise.all([1, 2, 3].map(() => openStream(abort.signal)))
      vi.mocked(core.computeView).mockClear()
      const created = await api.inject({
        method: 'POST',
        url: '/api/apps/app_invoice/items',
        headers: as('u_maya'),
        payload: { workflowId: 'w_invoice', data: { f_invno: 'INV-VIEW-1', f_vendor: 'l_vendors_0', f_lines: [{ id: 'row_1', c_desc: 'Toner', c_qty: 1, c_price: 10 }], f_dept: 'l_org_0', f_cc: 'l_org_1', f_invdate: '2026-09-28' } },
      })
      expect(created.statusCode).toBe(201)
      const events = await Promise.all(streams.map((s) => s.nextChange()))
      const monitor = await api.inject({ method: 'GET', url: '/api/apps/app_invoice/monitor', headers: as('u_avery') })
      const overview = await api.inject({ method: 'GET', url: '/api/apps/app_invoice/overview', headers: as('u_avery') })
      expect(core.computeView).toHaveBeenCalledTimes(1)
      // Everyone saw the same numbers.
      const counts = (monitor.json() as { view: { nodes: Record<string, { total: number }> } }).view.nodes
      for (const e of events) for (const [id, n] of Object.entries(e.counts)) expect(n).toBe(counts[id]!.total)
      expect(overview.statusCode).toBe(200)
    } finally {
      abort.abort()
    }
  })
})
