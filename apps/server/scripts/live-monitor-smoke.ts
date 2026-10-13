// End-to-end smoke check for the live Monitor: a real server, serving the built Studio, answers the
// Monitor endpoints and streams a change when an invoice is created through the API.
//
//   pnpm --filter @modus-bpm/studio build
//   pnpm --filter @modus-bpm/server smoke:live
//
// It builds nothing itself. The server runs as a child process (in memory, nothing written) on a free
// port, or on SMOKE_PORT if set, and is always stopped. Exits non-zero with the failed check on any problem.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = resolve(here, '..')
const studioDist = resolve(serverDir, '../studio/dist')
const ADMIN = 'u_avery'
const APP = 'app_invoice'

class SmokeError extends Error {}
const check = (ok: unknown, what: string): void => {
  if (!ok) throw new SmokeError(what)
}
const step = (msg: string) => console.log(`ok  ${msg}`)

/** True if something already accepts connections there (binding alone can't tell: macOS lets 127.0.0.1 share a port with a wildcard listener such as Docker's). */
function inUse(port: number): Promise<boolean> {
  return new Promise((done) => {
    const sock = connect({ port, host: '127.0.0.1' })
    sock.once('connect', () => (sock.destroy(), done(true)))
    sock.once('error', () => done(false))
  })
}

/** SMOKE_PORT if set and free, else any free port. A taken port fails: whatever holds it would answer the checks. */
async function freePort(): Promise<number> {
  if (process.env.SMOKE_PORT) {
    const want = Number(process.env.SMOKE_PORT)
    if (await inUse(want)) throw new SmokeError(`port ${want} is already in use; pick another SMOKE_PORT or leave it unset`)
    return want
  }
  return new Promise((done, fail) => {
    const s = createServer()
    s.once('error', fail)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => done(port))
    })
  })
}

if (!existsSync(join(studioDist, 'index.html'))) {
  console.error(`No built Studio at ${studioDist}. Run: pnpm --filter @modus-bpm/studio build`)
  process.exit(1)
}

let port: number
try {
  port = await freePort()
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
const base = `http://127.0.0.1:${port}`
const as = (user: string) => ({ 'x-user-id': user })

const child = spawn(join(serverDir, 'node_modules/.bin/tsx'), ['src/main.ts'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: studioDist, LOG_LEVEL: 'warn', DATA_DIR: '', DB_DIALECT: 'memory', TIME_SCALE: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
})
let exited = false
child.on('exit', () => (exited = true))

async function stopServer() {
  if (exited) return
  child.kill('SIGTERM')
  // main.ts closes cleanly on SIGTERM; don't wait forever if it doesn't.
  const gone = new Promise<void>((done) => child.once('exit', () => done()))
  const timeout = new Promise<void>((done) => setTimeout(done, 5000).unref())
  await Promise.race([gone, timeout])
  if (!exited) child.kill('SIGKILL')
}
// Ctrl-C on the smoke check still stops the server.
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    void stopServer().then(() => process.exit(130))
  })

async function waitForServer() {
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    check(!exited, 'the server exited during startup (see its output above)')
    try {
      const res = await fetch(`${base}/api/health`)
      if (res.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new SmokeError('the server did not answer /api/health within 30 s')
}

async function getJson<T>(path: string, user?: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: user ? as(user) : {} })
  check(res.ok, `GET ${path} answered ${res.status}: ${await res.clone().text()}`)
  return (await res.json()) as T
}

/** Reads the event stream in the background, keeping each `change` event's item ids. */
function openStream(abort: AbortController) {
  const changes: Array<{ items: string[] | null; active: number }> = []
  let connected = false
  const done = (async () => {
    const res = await fetch(`${base}/api/apps/${APP}/stream`, { headers: as(ADMIN), signal: abort.signal })
    check(res.ok && res.body, `GET /api/apps/${APP}/stream answered ${res.status}`)
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buf += value
      let at: number
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at)
        buf = buf.slice(at + 2)
        if (block.startsWith(': connected')) connected = true
        const event = /^event: (.+)$/m.exec(block)?.[1]
        const data = /^data: (.+)$/m.exec(block)?.[1]
        if (event === 'change' && data) changes.push(JSON.parse(data))
      }
    }
  })().catch((e) => {
    if (!abort.signal.aborted) throw e
  })
  return { changes, isConnected: () => connected, done }
}

async function waitFor(what: string, ok: () => boolean, ms = 5000) {
  const until = Date.now() + ms
  while (!ok()) {
    check(Date.now() < until, `${what} within ${ms / 1000} s`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const abort = new AbortController()
let failed = false
try {
  await waitForServer()
  step(`server up on ${base}`)

  const home = await fetch(`${base}/`)
  const html = await home.text()
  check(home.ok && (home.headers.get('content-type') ?? '').includes('text/html') && /<div id="root">/.test(html), `GET / should return the Studio's HTML (got ${home.status}, ${home.headers.get('content-type')})`)
  step('GET / returns the Studio')

  const health = await getJson<{ ok?: boolean }>('/api/health')
  check(health, 'GET /api/health returned nothing')
  step('GET /api/health')

  const design = await getJson<{ apps: Array<{ id: string }> }>('/api/design', ADMIN)
  check(design.apps.some((a) => a.id === APP), `the published design has no ${APP}`)
  step(`GET /api/design lists ${APP}`)

  const before = await getJson<{ view: { active: number } }>(`/api/apps/${APP}/monitor`, ADMIN)
  step(`GET /api/apps/${APP}/monitor: ${before.view.active} active`)

  const stream = openStream(abort)
  await waitFor('the stream should send ": connected"', stream.isConnected)
  step('stream connected')

  const created = await fetch(`${base}/api/apps/${APP}/items`, {
    method: 'POST',
    headers: { ...as('u_maya'), 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId: 'w_invoice', data: { f_invno: `SMOKE-${Date.now()}`, f_vendor: 'l_vendors_0', f_lines: [{ id: 'row_1', c_desc: 'Toner', c_qty: 2, c_price: 50 }], f_dept: 'l_org_0', f_cc: 'l_org_1' } }),
  })
  check(created.status === 201, `creating an invoice answered ${created.status}: ${await created.clone().text()}`)
  const id = ((await created.json()) as { value: { id: string } }).value.id
  step(`created invoice ${id}`)

  const after = await getJson<{ view: { active: number } }>(`/api/apps/${APP}/monitor`, ADMIN)
  check(after.view.active === before.view.active + 1, `/monitor should show one more active item (was ${before.view.active}, now ${after.view.active})`)
  step(`/monitor shows ${after.view.active} active (up by one)`)

  await waitFor(`the stream should deliver a change naming ${id}`, () => stream.changes.some((c) => c.items?.includes(id)))
  step(`stream delivered a change for ${id}`)

  console.log('\nLive Monitor smoke check passed.')
} catch (e) {
  failed = true
  console.error(`\nFAIL  ${e instanceof SmokeError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
} finally {
  abort.abort()
  await stopServer()
}
process.exit(failed ? 1 : 0)
