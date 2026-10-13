// Test helpers: a fake JSON response and an SSE stream the test writes to.

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function fakeStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      ctrl = c
    },
    cancel: () => {
      cancelled = true
    },
  })
  const enc = new TextEncoder()
  return {
    response: () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (text: string) => ctrl.enqueue(enc.encode(text)),
    change: (data: unknown) => ctrl.enqueue(enc.encode(`event: change\ndata: ${JSON.stringify(data)}\n\n`)),
    close: () => ctrl.close(),
    fail: () => ctrl.error(new TypeError('network')),
    cancelled: () => cancelled,
  }
}
