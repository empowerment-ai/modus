// `pnpm load [--profile smoke|baseline|full] [--servers 1|2|3] [--keep]`: build and start the load
// stack, write the test design, run k6 in Docker, collect what the observer and the servers saw,
// write the report, tear the stack down. See docs/plans/2026-10-13-load-tests-design.md.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { seedDesign } from '@modus-bpm/core/model/seed'
import { CLERKS } from '../k6/profiles.js'
import { endingNote, folderName, type Ending } from './folder'
import { backlogFrom, buildReport, type Outbox, type Settings } from './report'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(PKG, '../..')
const PROJECT = 'modus-load'
const NETWORK = `${PROJECT}_default`
const K6_IMAGE = 'grafana/k6:2.3.0'
const K6_CONTAINER = `${PROJECT}-k6`
const NGINX = 'http://127.0.0.1:8790'
const OBSERVER = 'http://127.0.0.1:8791'
// A seed administrator: the outbox list is for administrators only.
const ADMIN = 'u_avery'
const APP = 'app_invoice'
/** How long an end-of-run read waits: longer than k6's 60 s request timeout. */
const DRAIN_MS = 120_000

/** Live screens per profile: the design's traffic table. */
const STREAMS: Record<string, number> = { smoke: 10, baseline: 100, full: 300 }
const PROFILES = Object.keys(STREAMS)

// pnpm may pass a literal `--` ahead of the arguments.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    profile: { type: 'string', default: 'smoke' },
    servers: { type: 'string', default: '1' },
    keep: { type: 'boolean', default: false },
  },
})
const profile = values.profile!
const servers = Number(values.servers)
if (!PROFILES.includes(profile)) fail(`--profile must be one of ${PROFILES.join(', ')}`)
if (![1, 2, 3].includes(servers)) fail('--servers must be 1, 2 or 3')
const clerks = (CLERKS as Record<string, number>)[profile]
const streams = STREAMS[profile]

function fail(msg: string): never {
  console.error(msg)
  process.exit(2)
}

const started = new Date()
const out = join(PKG, 'results', folderName(started, profile, servers))
mkdirSync(out, { recursive: true })

/** Leaves `INTERRUPTED` or `FAILED` in the results folder: its numbers, if any, are partial. */
function markEnding(kind: Ending, why: string) {
  try {
    writeFileSync(join(out, kind), endingNote(kind, why, new Date()))
  } catch {
    // The note is a courtesy; never let it stand in the way of the teardown.
  }
}

const serverNames = ['modus1', 'modus2', 'modus3'].slice(0, servers)
const profileFlags = servers === 3 ? ['--profile', 's3'] : servers === 2 ? ['--profile', 's2'] : []
const compose = (...args: string[]) => ['compose', '-p', PROJECT, '-f', join(PKG, 'compose.yml'), ...profileFlags, ...args]

/** Commands still running: an interrupted run stops them before it goes. */
const children = new Set<ChildProcess>()

/** Runs a command with its output on the terminal (into `to`, or kept with `capture`); rejects on a non-zero exit unless `allowFail`. */
function run(cmd: string, args: string[], opts: { to?: string; capture?: boolean; allowFail?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; stdout: string }> {
  return new Promise((done, reject) => {
    const child = spawn(cmd, args, { cwd: PKG, env: { ...process.env, ...opts.env }, stdio: ['ignore', opts.capture || opts.to ? 'pipe' : 'inherit', opts.capture || opts.to ? 'pipe' : 'inherit'] })
    children.add(child)
    child.on('exit', () => children.delete(child))
    let stdout = ''
    if (opts.to) {
      const file = createWriteStream(opts.to)
      child.stdout!.pipe(file)
      child.stderr!.pipe(file)
    } else if (opts.capture) {
      child.stdout!.on('data', (c) => (stdout += c))
      // Quiet, but drained so a chatty command can't fill the pipe and stall.
      child.stderr!.resume()
    }
    child.on('error', reject)
    child.on('close', (code) => {
      const c = code ?? 1
      if (c !== 0 && !opts.allowFail) reject(new Error(`${cmd} ${args.join(' ')} exited ${c}`))
      else done({ code: c, stdout })
    })
  })
}

const docker = (args: string[], opts: Parameters<typeof run>[2] = {}) => run('docker', args, opts)

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

/** One more try after a failure: the first may have timed out behind a queue that is gone now. */
const again = <T>(f: () => Promise<T>): Promise<T> => f().catch(() => f())

/** Undefined when it can't be measured: the report says "not measured" instead of failing. */
async function maybe<T>(what: string, f: () => Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch (err) {
    console.warn(`! ${what}: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`)
}

// ----- Teardown, whatever happens -----

const quote = (a: string) => `'${a.replaceAll("'", `'\\''`)}'`
const downArgs = () => compose('down', '-v', '--remove-orphans')

let tearing: Promise<void> | undefined
/** Once, however many paths ask: main's `finally` and a failure can both get here. */
const teardown = () => (tearing ??= tearDown())
async function tearDown() {
  await docker(['rm', '-f', K6_CONTAINER], { capture: true, allowFail: true })
  if (values.keep) {
    console.log(`\n--keep: the stack is still up. Stop it with: docker compose -p ${PROJECT} down -v`)
    return
  }
  console.log('\nTearing down the load stack…')
  await docker(downArgs(), { allowFail: true })
}

/**
 * The teardown for a run that is going away now (a signal, a crash): a process of its own, in its
 * own process group, that outlives us. `pnpm load` exits on Ctrl-C and its runner goes with it,
 * long before `compose down` would finish; a detached shell is out of reach of both.
 * k6 goes first: its container sits on the stack's network, which `down` can't remove under it.
 */
let detached = false
function detachTeardown() {
  if (detached) return
  detached = true
  const script = [
    `docker rm -f ${quote(K6_CONTAINER)}`,
    `docker ${downArgs().map(quote).join(' ')}`,
  ].join(' >/dev/null 2>&1; ') + ' >/dev/null 2>&1'
  try {
    spawn('sh', ['-c', script], { cwd: PKG, detached: true, stdio: 'ignore' }).unref()
    console.error(`Tearing down the load stack in the background (about 10-30 s). Check with: docker compose -p ${PROJECT} ps -a`)
  } catch (err) {
    console.error(`! could not start the teardown (${err instanceof Error ? err.message : String(err)}). Run: docker rm -f ${K6_CONTAINER}; docker compose -p ${PROJECT} down -v`)
  }
}

/** Interrupted or crashed: note it, hand the teardown to a detached process, stop our commands, go. */
function abandon(kind: Ending, why: string, code: number): never {
  markEnding(kind, why)
  // Always down, even with --keep: an interrupted or crashed run's stack is half-made.
  detachTeardown()
  for (const c of children) c.kill('SIGTERM')
  process.exit(code)
}

let stopping = false
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    // tsx passes the terminal's Ctrl-C on as a second signal: one teardown is enough.
    if (stopping) return
    stopping = true
    console.error(`\n${sig}: stopping`)
    abandon('INTERRUPTED', sig, 130)
  })
}
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (err: unknown) => {
    console.error(`\nLoad run crashed (${event}): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    abandon('FAILED', `${event}: ${err instanceof Error ? err.message : String(err)}`, 1)
  })
}

// ----- The run -----

async function main() {
  console.log(`Load test: ${profile}, ${servers} server(s), ${clerks} clerks, ${streams} live screens\nResults: ${relative(ROOT, out)}\n`)

  await docker(compose('build'))
  await docker(compose('up', '-d', '--wait', 'postgres'))

  // The design goes in before the servers start, so they boot with the load clerks.
  await run(join(PKG, 'node_modules/.bin/tsx'), ['src/setup.ts', String(clerks)])

  // `--wait` holds until each server's healthcheck (`/api/ready`) passes.
  await docker(compose('up', '-d', '--wait', ...serverNames, 'nginx', 'observer'))
  await waitFor(`${NGINX}/api/ready`)

  await post(`${OBSERVER}/reset`)
  await post(`${OBSERVER}/streams/start`, { count: streams, servers: serverNames.map((s) => `http://${s}:8787`) })

  console.log(
    '\nWatch live:\n' +
      '  k6 dashboard  http://localhost:5665\n' +
      `  Studio        http://localhost:8790  Monitor → Live: the servers' own counts, as ${ADMIN} (the seed administrator)\n`,
  )

  const k6 = await docker(
    [
      'run', '--rm', '--name', K6_CONTAINER,
      '--network', NETWORK,
      '-p', '127.0.0.1:5665:5665',
      // The image's own user can't write to a host folder on every setup.
      '--user', 'root',
      '-v', `${join(PKG, 'k6')}:/scripts:ro`,
      '-v', `${out}:/results`,
      '-e', `PROFILE=${profile}`,
      '-e', 'BASE_URL=http://nginx',
      '-e', 'K6_WEB_DASHBOARD=true',
      '-e', 'K6_WEB_DASHBOARD_PORT=5665',
      '-e', 'K6_WEB_DASHBOARD_EXPORT=/results/dashboard.html',
      K6_IMAGE, 'run', '--summary-export', '/results/k6.json', '/scripts/main.js',
    ],
    { allowFail: true },
  )
  // Interrupted: no report from a cut-short run; the signal handler has handed off the teardown.
  if (stopping) return
  if (k6.code !== 0) console.warn(`! k6 exited ${k6.code}; the report uses what it left`)

  // ----- Collect -----
  const observer = await maybe('observer stats', () => getJson(`${OBSERVER}/stats`))
  await maybe('observer stop', () => post(`${OBSERVER}/streams/stop`))
  // An overloaded server is still working through the requests k6 left queued, so the end-of-run
  // reads wait their turn (DRAIN_MS) and try once more. On one server nginx's 90 s read timeout
  // answers 504 first. On two, nginx hands a timed-out GET to the other server (proxy_next_upstream),
  // so our own 120 s timeout fires first.
  const overview = await maybe('overview', () => again(() => getJson(`${NGINX}/api/apps/${APP}/overview`, {}, DRAIN_MS)))
  const outbox = await maybe('outbox', () => again(outboxCounts))
  for (const s of [...serverNames, 'nginx', 'observer']) await docker(compose('logs', '--no-color', s), { to: join(out, `${s}.log`), allowFail: true })

  const k6Path = join(out, 'k6.json')
  const k6Summary = existsSync(k6Path) ? JSON.parse(readFileSync(k6Path, 'utf8')) : undefined
  const app = seedDesign().apps.find((a) => a.id === APP)!
  const settings: Settings = {
    profile,
    servers,
    clerks,
    streams,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    commit: (await maybe('git', () => run('git', ['rev-parse', '--short', 'HEAD'], { capture: true })))?.stdout.trim(),
    timeScale: Number(process.env.TIME_SCALE ?? 60),
  }
  const report = buildReport({
    k6: k6Summary,
    observer: observer as never,
    backlog: overview ? backlogFrom(overview as never, app.workflows, outbox) : undefined,
    settings,
  })
  writeFileSync(join(out, 'summary.json'), JSON.stringify(report.json, null, 2) + '\n')
  writeFileSync(join(out, 'summary.md'), report.markdown)
  console.log(`\n${report.markdown}\nSummary: ${relative(ROOT, join(out, 'summary.md'))}`)
}

/** Deliveries not yet made, as an administrator sees them; the list stops at 500 per status. */
async function outboxCounts(): Promise<Outbox> {
  const count = async (status: string) => {
    const r = (await getJson(`${NGINX}/api/admin/outbox?status=${status}&limit=500`, { 'x-user-id': ADMIN }, DRAIN_MS)) as { deliveries: unknown[] }
    return r.deliveries.length
  }
  const [pending, failed] = [await count('pending'), await count('failed')]
  return { pending, failed, capped: pending >= 500 || failed >= 500 }
}

async function waitFor(url: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)
    if (ok) return
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`${url} never answered`)
}

let code = 0
try {
  await main()
} catch (err) {
  const why = err instanceof Error ? err.message : String(err)
  console.error(`\nLoad run failed: ${why}`)
  markEnding('FAILED', why)
  code = 1
} finally {
  await teardown()
}
process.exit(code)
