// The HTTP edge: REST for people, supervisors and administrators, the job
// protocol for workers, search and the assistant, a live event stream, and
// (optionally) the built studio. Every request is validated with zod and turned
// into one engine operation inside Runtime.run, so the rules (field security,
// who may claim, supervise or expedite, comments required…) are the engine's,
// exactly as in the studio.
//
// Identity is a prototype stand-in: the caller names themselves in the
// `x-user-id` header. Production replaces it with OIDC (bearer tokens) and maps
// directory groups onto Modus groups via SCIM; see docs/ARCHITECTURE.md.

import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify'
import { z } from 'zod'
import {
  adminAssign,
  adminMove,
  adminRetry,
  basketOf,
  buildIndex,
  canCreate,
  canExpedite,
  canSuperviseToken,
  completeJob,
  computeView,
  createObject,
  type Ctx,
  distributionFor,
  exportOcel,
  failJob,
  findToken,
  hasRole,
  type Id,
  pollJobs,
  queuesFor,
  requestsBy,
  type Result,
  searchItems,
  setExpedite,
  superviseAssign,
  superviseRedistribute,
  superviseRelease,
  superviseRetry,
  superviseReturn,
  supervisesStep,
  supervisionFor,
  workClaim,
  workDelegate,
  workDistribute,
  workNext,
  workRelease,
  workReturn,
  workSave,
  workStart,
} from '@modus-bpm/core'
import { answer, type ModelAssistant } from './assistant'
import { canRead, findItem, hitDto, itemDto, workItemDto } from './dto'
import { NotFound, type Runtime } from './runtime'

export interface ServerOptions {
  logger?: FastifyServerOptions['logger']
  /** A built studio to serve at `/` (SPA fallback); `/api/*` stays the API. */
  staticDir?: string
  /** The language model behind the assistant; without it the built-in assistant answers. */
  assistant?: ModelAssistant
}

// ---------- Request helpers ----------

const userHeader = z.object({ 'x-user-id': z.string().min(1) })

function who(req: FastifyRequest): Id {
  const parsed = userHeader.safeParse(req.headers)
  if (!parsed.success) throw new Unauthorized('Name yourself in the x-user-id header (OIDC replaces this in production).')
  return parsed.data['x-user-id']
}

class Unauthorized extends Error {}

/** A refusal decided at the edge, before the engine operation runs. */
interface Refusal {
  refused: 403 | 404
  error: string
}

const refuse = (refused: Refusal['refused'], error: string): Refusal => ({ refused, error })

function send<T>(reply: FastifyReply, r: Result<T> | Refusal) {
  if ('refused' in r) return reply.code(r.refused).send({ ok: false, error: r.error })
  return r.ok ? reply.send({ ok: true, value: r.value }) : reply.code(409).send({ ok: false, error: r.error })
}

const nameOf = (ctx: Ctx, userId: Id) => ctx.users.find((u) => u.id === userId)?.name ?? userId

/** Administrators and supervisors of the work may act on it; anyone else is refused. */
function supervisedBy(sim: Parameters<typeof findToken>[0], ctx: Ctx, workItemId: Id, userId: Id): Refusal | undefined {
  const found = findToken(sim, workItemId)
  if (!found || found.obj.status !== 'active') return refuse(404, 'No such active work item.')
  if (!canSuperviseToken(buildIndex(ctx), found.obj, found.tok, userId)) return refuse(403, 'Only an administrator or a supervisor of this work can do that.')
  return undefined
}

const appParams = z.object({ app: z.string() })
const workParams = z.object({ app: z.string(), workItemId: z.string() })
const itemParams = z.object({ app: z.string(), itemId: z.string() })

// ---------- Studio (static files with SPA fallback) ----------

function serveStudio(app: FastifyInstance, dir: string) {
  const root = resolve(dir)
  if (!existsSync(join(root, 'index.html'))) throw new Error(`STATIC_DIR=${dir} has no index.html. Build the studio (pnpm --filter @modus-bpm/studio build) or unset STATIC_DIR.`)
  void app.register(fastifyStatic, {
    root,
    prefix: '/',
    setHeaders(reply, path) {
      // Vite fingerprints everything under assets/; the HTML must always be revalidated.
      reply.header('cache-control', path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
      reply.header('x-content-type-options', 'nosniff')
    },
  })
}

// ---------- Routes ----------

export function buildServer(rt: Runtime, opts: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? (process.env.NODE_ENV !== 'test' ? { level: 'info' } : false) })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NotFound) return reply.code(404).send({ ok: false, error: err.message })
    if (err instanceof Unauthorized) return reply.code(401).send({ ok: false, error: err.message })
    if (err instanceof z.ZodError) return reply.code(400).send({ ok: false, error: 'Invalid request', issues: err.issues })
    reply.log.error(err)
    return reply.code(500).send({ ok: false, error: 'Unexpected error' })
  })

  if (opts.staticDir) serveStudio(app, opts.staticDir)
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]!
    const api = path === '/api' || path.startsWith('/api/')
    // Client-side routes get the studio; missing files (anything with an extension) and API paths get a 404.
    if (opts.staticDir && !api && (req.method === 'GET' || req.method === 'HEAD') && !/\.[a-z0-9]+$/i.test(path)) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html')
    }
    return reply.code(404).send({ ok: false, error: `No route ${req.method} ${path}` })
  })

  // Probes run every few seconds; log them only when something is wrong.
  const quiet = { logLevel: 'warn' as const }

  /** Liveness: the process is up and serving. */
  app.get('/api/health', quiet, async () => ({ ok: true, apps: rt.design.apps.length }))

  /** Readiness: the design and state are loaded and the server is not shutting down. */
  app.get('/api/ready', quiet, async (_req, reply) => (rt.ready ? { ok: true, apps: rt.design.apps.length, storage: 'memory' } : reply.code(503).send({ ok: false, error: 'Shutting down' })))

  app.get('/api', async () => ({
    name: 'Modus API (prototype)',
    identity: 'x-user-id header (prototype); OIDC bearer tokens in production',
    routes: app.printRoutes({ commonPrefix: false }).split('\n').filter(Boolean),
  }))

  app.get('/api/apps', async () =>
    rt.design.apps.map((a) => ({ id: a.id, name: a.name, description: a.description, workflows: a.workflows.map((w) => ({ id: w.id, name: w.name, kind: w.kind ?? 'process' })) })),
  )

  /** Live counts per step: the same numbers the studio canvas shows. */
  app.get('/api/apps/:app/overview', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    return rt.read(appId, (sim, ctx) => {
      const v = computeView(sim, ctx)
      return { clock: v.clock, active: v.active, completed: v.completed, rejected: v.rejected, stuck: v.stuck, overdue: v.overdue, bottleneckId: v.bottleneckId, steps: v.nodes, services: v.services }
    })
  })

  /** The event log as OCEL 2.0 JSON, for process-mining tools. */
  app.get('/api/apps/:app/export/ocel', async (req, reply) => {
    const { app: appId } = appParams.parse(req.params)
    const log = await rt.read(appId, (sim, ctx) => exportOcel(sim, ctx))
    return reply.header('content-disposition', `attachment; filename="${appId}-ocel2.json"`).send(log)
  })

  // ----- Items -----

  const createBody = z.object({ workflowId: z.string(), data: z.record(z.string(), z.unknown()).default({}) })
  app.post('/api/apps/:app/items', async (req, reply) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    const body = createBody.parse(req.body)
    return rt.run(appId, (sim, ctx) => {
      if (!canCreate(ctx, body.workflowId, user)) return reply.code(403).send({ ok: false, error: 'You can’t create items in that workflow.' })
      const obj = createObject(sim, ctx, body.workflowId, body.data, user)
      if (!obj) return reply.code(404).send({ ok: false, error: 'Unknown workflow.' })
      return reply.code(201).send({ ok: true, value: itemDto(obj, ctx, user, sim) })
    })
  })

  /** One item by id or number, as the caller may see it (404 when they can't see it at all). */
  app.get('/api/apps/:app/items/:itemId', async (req, reply) => {
    const { app: appId, itemId } = itemParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => {
      const obj = findItem(sim, itemId)
      return obj && canRead(sim, ctx, obj, user) ? itemDto(obj, ctx, user, sim) : reply.code(404).send({ ok: false, error: 'No such item.' })
    })
  })

  /** Expedite (or stop expediting) an item, under its workflow's policy. */
  const expediteBody = z.object({ on: z.boolean().default(true), reason: z.string().max(500).default('') })
  app.post('/api/apps/:app/items/:itemId/expedite', async (req, reply) => {
    const { app: appId, itemId } = itemParams.parse(req.params)
    const user = who(req)
    const b = expediteBody.parse(req.body ?? {})
    const r = await rt.run(appId, (sim, ctx): Result | Refusal => {
      const obj = findItem(sim, itemId)
      if (!obj || !canRead(sim, ctx, obj, user)) return refuse(404, 'No such item.')
      if (obj.status !== 'active') return { ok: false, error: `${obj.number} is already finished.` }
      const verdict = setExpedite(sim, ctx, obj.id, user, b.on, b.reason)
      // Refused by the policy (who may expedite) rather than by the state of the item.
      if (!verdict.ok && !canExpedite(sim, ctx, obj.id, user)) return refuse(403, verdict.error)
      return verdict
    })
    return send(reply, r)
  })

  // ----- Search -----

  const searchQuery = z.object({
    q: z.string().max(500).default(''),
    sort: z.enum(['relevance', 'newest', 'due', 'priority']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })

  /** Free text plus filters (see core search.ts for the language), scoped to what the caller may see. */
  app.get('/api/apps/:app/search', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    const q = searchQuery.parse(req.query)
    return rt.read(appId, (sim, ctx) => {
      const r = searchItems(sim, ctx, q.q, { userId: user, sort: q.sort, limit: q.limit })
      return { query: q.q, total: r.total, hits: r.hits.map((h) => hitDto(h, sim, ctx, user)), facets: r.facets }
    })
  })

  // ----- Assistant -----

  const askBody = z.object({
    question: z.string().trim().min(1).max(2000),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) }))
      .max(40)
      .default([]),
  })

  /** Ask Modus: Claude with read-only tools when ANTHROPIC_API_KEY is set, else the built-in interpreter. */
  app.post('/api/apps/:app/assistant', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    const b = askBody.parse(req.body)
    rt.ctx(appId) // an unknown application is a 404 before any model call
    return answer({ rt, model: opts.assistant, log: req.log }, appId, user, b.question, b.history)
  })

  // ----- My work (the workbasket) -----

  app.get('/api/apps/:app/my/basket', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => basketOf(sim, ctx, user).map((i) => workItemDto(i, ctx, user)))
  })

  app.get('/api/apps/:app/my/queues', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => queuesFor(sim, ctx, user).map((q) => ({ stepId: q.nodeId, label: q.label, group: q.groupName, waiting: q.items.map((i) => workItemDto(i, ctx, user)) })))
  })

  app.get('/api/apps/:app/my/distribution', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) =>
      distributionFor(sim, ctx, user).map((d) => ({
        stepId: d.nodeId,
        label: d.label,
        group: d.groupName,
        waiting: d.waiting.map((i) => workItemDto(i, ctx, user)),
        assigned: d.assigned.map((i) => workItemDto(i, ctx, user)),
      })),
    )
  })

  app.get('/api/apps/:app/my/requests', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => requestsBy(sim, ctx, user).map((r) => ({ itemId: r.obj.id, number: r.obj.number, status: r.obj.status, where: r.where, due: r.due, overdue: r.overdue })))
  })

  /** What the caller supervises: their processes and every people step they oversee, with the work there now. */
  app.get('/api/apps/:app/my/supervision', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => {
      const s = supervisionFor(sim, ctx, user)
      return {
        processes: s.processes,
        steps: s.steps.map((st) => ({
          stepId: st.nodeId,
          label: st.label,
          path: st.path,
          workflowId: st.workflowId,
          groupId: st.groupId,
          escalated: st.escalated.length,
          items: st.items.map((i) => workItemDto(i, ctx, user)),
        })),
      }
    })
  })

  app.post('/api/apps/:app/my/next', async (req, reply) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => workNext(sim, ctx, user)))
  })

  // ----- Acting on a work item -----

  app.post('/api/apps/:app/work/:workItemId/claim', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => workClaim(sim, ctx, workItemId, user)))
  })

  app.post('/api/apps/:app/work/:workItemId/start', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => workStart(sim, ctx, workItemId, user)))
  })

  const patchBody = z.object({ patch: z.record(z.string(), z.unknown()).default({}) })
  app.post('/api/apps/:app/work/:workItemId/save', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const { patch } = patchBody.parse(req.body ?? {})
    return send(reply, await rt.run(appId, (sim, ctx) => workSave(sim, ctx, workItemId, user, patch)))
  })

  const releaseBody = z.object({ outcomeId: z.string(), comment: z.string().default(''), patch: z.record(z.string(), z.unknown()).default({}) })
  app.post('/api/apps/:app/work/:workItemId/release', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const b = releaseBody.parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => workRelease(sim, ctx, workItemId, user, b.outcomeId, b.comment, b.patch)))
  })

  app.post('/api/apps/:app/work/:workItemId/return', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const { comment } = z.object({ comment: z.string().default('') }).parse(req.body ?? {})
    return send(reply, await rt.run(appId, (sim, ctx) => workReturn(sim, ctx, workItemId, user, comment)))
  })

  app.post('/api/apps/:app/work/:workItemId/delegate', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const b = z.object({ to: z.string(), comment: z.string().default('') }).parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => workDelegate(sim, ctx, workItemId, user, b.to, b.comment)))
  })

  app.post('/api/apps/:app/work/:workItemId/distribute', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const b = z.object({ to: z.string() }).parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => workDistribute(sim, ctx, workItemId, user, b.to)))
  })

  // ----- Supervisors: the administrator's levers, scoped to the work they supervise -----
  // 404 for no such active work item, 403 when the caller doesn't supervise it,
  // 409 when the engine refuses (for example, reassigning outside the step's group).

  const toBody = z.object({ to: z.string() })
  app.post('/api/apps/:app/supervise/:workItemId/assign', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const b = toBody.parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => supervisedBy(sim, ctx, workItemId, user) ?? superviseAssign(sim, ctx, workItemId, b.to, user)))
  })

  app.post('/api/apps/:app/supervise/:workItemId/return', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => supervisedBy(sim, ctx, workItemId, user) ?? superviseReturn(sim, ctx, workItemId, user)))
  })

  const superviseReleaseBody = z.object({ outcomeId: z.string(), comment: z.string().default('') })
  app.post('/api/apps/:app/supervise/:workItemId/release', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    const b = superviseReleaseBody.parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => supervisedBy(sim, ctx, workItemId, user) ?? superviseRelease(sim, ctx, workItemId, b.outcomeId, b.comment, user)))
  })

  app.post('/api/apps/:app/supervise/:workItemId/retry', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const user = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => supervisedBy(sim, ctx, workItemId, user) ?? superviseRetry(sim, ctx, workItemId, user)))
  })

  /** Even out everything not yet being worked at a step across its available members. */
  app.post('/api/apps/:app/supervise/steps/:stepId/redistribute', async (req, reply) => {
    const { app: appId, stepId } = z.object({ app: z.string(), stepId: z.string() }).parse(req.params)
    const user = who(req)
    const r = await rt.run(appId, (sim, ctx): Result<number> | Refusal => {
      const idx = buildIndex(ctx)
      if (idx.node.get(stepId)?.node.type !== 'user') return refuse(404, 'No such people step.')
      if (!supervisesStep(idx, stepId, user)) return refuse(403, 'Only an administrator or a supervisor of this step can redistribute it.')
      return superviseRedistribute(sim, ctx, stepId, user)
    })
    return send(reply, r)
  })

  // ----- Administration: administrators, or supervisors of that work -----

  app.post('/api/apps/:app/admin/work/:workItemId/assign', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const actor = who(req)
    const b = z.object({ to: z.string(), sameGroupOnly: z.boolean().default(true) }).parse(req.body)
    return send(
      reply,
      await rt.run(appId, (sim, ctx) => {
        const no = supervisedBy(sim, ctx, workItemId, actor)
        if (no) return no
        // Only administrators may reassign outside the step's group.
        const sameGroupOnly = hasRole(buildIndex(ctx), actor, 'admin') ? b.sameGroupOnly : true
        return adminAssign(sim, ctx, workItemId, b.to, nameOf(ctx, actor), { sameGroupOnly })
      }),
    )
  })

  app.post('/api/apps/:app/admin/work/:workItemId/move', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const actor = who(req)
    const b = z.object({ stepId: z.string() }).parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => supervisedBy(sim, ctx, workItemId, actor) ?? adminMove(sim, ctx, workItemId, b.stepId, nameOf(ctx, actor))))
  })

  app.post('/api/apps/:app/admin/work/:workItemId/retry', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const actor = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => supervisedBy(sim, ctx, workItemId, actor) ?? adminRetry(sim, ctx, workItemId, nameOf(ctx, actor))))
  })

  // ----- Workers: the job protocol for registered services ("devices") -----
  // Job ids are "<appId>:<workItemId>" because services are shared by every application.

  const pollBody = z.object({ serviceId: z.string(), workerId: z.string(), max: z.number().int().min(1).max(100).default(1), leaseSeconds: z.number().int().min(5).max(3600).default(300) })
  app.post('/api/jobs/poll', async (req) => {
    const b = pollBody.parse(req.body)
    const jobs = []
    for (const a of rt.design.apps) {
      if (jobs.length >= b.max) break
      const got = await rt.run(a.id, (sim, ctx) => pollJobs(sim, ctx, b.serviceId, b.workerId, b.max - jobs.length, b.leaseSeconds / 60))
      jobs.push(...got.map((j) => ({ ...j, id: `${a.id}:${j.id}`, appId: a.id })))
    }
    return { jobs }
  })

  function jobParams(req: FastifyRequest) {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.params)
    const at = jobId.indexOf(':')
    if (at < 1) throw new NotFound('Unknown job.')
    return { appId: jobId.slice(0, at), tokenId: jobId.slice(at + 1) }
  }

  app.post('/api/jobs/:jobId/complete', async (req, reply) => {
    const { appId, tokenId } = jobParams(req)
    const { outputs } = z.object({ outputs: z.record(z.string(), z.unknown()).default({}) }).parse(req.body ?? {})
    const done = await rt.run(appId, (sim, ctx) => completeJob(sim, ctx, tokenId, outputs))
    return done ? reply.send({ ok: true }) : reply.code(410).send({ ok: false, error: 'That job is no longer open (finished, cancelled or taken over by a person).' })
  })

  app.post('/api/jobs/:jobId/fail', async (req, reply) => {
    const { appId, tokenId } = jobParams(req)
    const { error } = z.object({ error: z.string().default('failed') }).parse(req.body ?? {})
    const done = await rt.run(appId, (sim, ctx) => failJob(sim, ctx, tokenId, error))
    return done ? reply.send({ ok: true }) : reply.code(410).send({ ok: false, error: 'That job is no longer open.' })
  })

  // ----- Live stream (Server-Sent Events): counts per step and which items changed -----

  const streams = new Set<FastifyReply>()
  // Open streams would otherwise hold a graceful shutdown until the orchestrator kills the process.
  app.addHook('preClose', async () => {
    for (const s of streams) s.raw.end()
  })

  app.get('/api/apps/:app/stream', async (req, reply) => {
    const { app: appId } = appParams.parse(req.params)
    rt.ctx(appId)
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    streams.add(reply)
    let last = 0
    const unsubscribe = rt.subscribe((c) => {
      if (c.appId !== appId) return
      const now = Date.now()
      if (!c.itemIds.length && now - last < 1000) return
      last = now
      void rt.read(appId, (sim, ctx) => {
        const v = computeView(sim, ctx)
        const counts = Object.fromEntries(Object.entries(v.nodes).map(([id, m]) => [id, m.total]))
        reply.raw.write(`event: change\ndata: ${JSON.stringify({ clock: c.clock, items: c.itemIds, counts, active: v.active })}\n\n`)
      })
    })
    req.raw.on('close', () => {
      unsubscribe()
      streams.delete(reply)
    })
    return reply
  })

  return app
}
