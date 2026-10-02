// The HTTP edge: REST for people and administrators, the job protocol for
// workers, and a live event stream. Every request is validated with zod and
// turned into one engine operation inside Runtime.run, so the rules (field
// security, who may claim or distribute, comments required…) are the engine's,
// exactly as in the studio.
//
// Identity is a prototype stand-in: the caller names themselves in the
// `x-user-id` header. Production replaces it with OIDC (bearer tokens) and maps
// directory groups onto Modus groups via SCIM; see docs/ARCHITECTURE.md.

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  accessFor,
  adminAssign,
  adminMove,
  adminRetry,
  basketOf,
  canCreate,
  completeJob,
  computeView,
  createObject,
  type Ctx,
  distributionFor,
  exportOcel,
  failJob,
  fieldVerdicts,
  type Id,
  pollJobs,
  queuesFor,
  requestsBy,
  type Result,
  type SimObject,
  workClaim,
  workDelegate,
  workDistribute,
  type WorkItem,
  workNext,
  workRelease,
  workReturn,
  workSave,
  workStart,
} from '@modus-bpm/core'
import { objectTitle } from '@modus-bpm/core/model/format'
import { NotFound, type Runtime } from './runtime'

// ---------- DTOs: what goes over the wire ----------

function workItemDto(i: WorkItem, ctx: Ctx) {
  const type = ctx.app.objectTypes.find((t) => t.id === i.obj.typeId)
  return {
    id: i.token.id,
    itemId: i.obj.id,
    number: i.obj.number,
    title: objectTitle(type, i.obj.data, ctx.app.lists, ctx.users),
    step: { id: i.node.id, label: i.node.data.label, instructions: i.node.type === 'user' ? i.node.data.description : undefined },
    workflow: i.wf.name,
    path: i.path,
    state: i.token.state,
    assignee: i.token.userId,
    priority: i.priority,
    due: i.due,
    overdue: i.overdue,
    ageMinutes: Math.round(i.age),
    outcomes: i.step.outcomes.map((o) => ({ id: o.id, label: o.label, requireComment: !!o.requireComment })),
  }
}

/** An item as a given person may see it: hidden fields are left out, the rest marked editable or not. */
function itemDto(obj: SimObject, ctx: Ctx, userId: Id | undefined, sim: Parameters<typeof accessFor>[0]) {
  const type = ctx.app.objectTypes.find((t) => t.id === obj.typeId)!
  const held = userId ? obj.tokens.find((t) => t.userId === userId) : undefined
  const verdicts = held && userId ? accessFor(sim, ctx, held.id, userId)! : fieldVerdicts({ type, wf: ctx.app.workflows.find((w) => w.id === obj.workflowId), passed: obj.passed, userId, groups: ctx.groups })
  const data: Record<string, unknown> = {}
  const access: Record<string, string> = {}
  for (const f of type.fields) {
    const v = verdicts[f.id]
    if (v?.access === 'hidden') continue
    data[f.id] = obj.data[f.id]
    access[f.id] = v?.access ?? 'read'
  }
  return {
    id: obj.id,
    number: obj.number,
    type: type.name,
    title: objectTitle(type, obj.data, ctx.app.lists, ctx.users),
    status: obj.status,
    priority: obj.priority,
    dueBy: obj.dueBy,
    createdAt: obj.createdAt,
    createdBy: obj.createdBy,
    branches: obj.tokens.map((t) => ({ workItemId: t.id, stepId: t.nodeId, state: t.state, assignee: t.userId })),
    fields: type.fields.filter((f) => f.id in data).map((f) => ({ id: f.id, label: f.label, type: f.type, access: access[f.id] })),
    data,
    history: obj.history,
  }
}

// ---------- Request helpers ----------

const userHeader = z.object({ 'x-user-id': z.string().min(1) })

function who(req: FastifyRequest): Id {
  const parsed = userHeader.safeParse(req.headers)
  if (!parsed.success) throw new Unauthorized('Name yourself in the x-user-id header (OIDC replaces this in production).')
  return parsed.data['x-user-id']
}

class Unauthorized extends Error {}

function send<T>(reply: FastifyReply, r: Result<T>) {
  return r.ok ? reply.send({ ok: true, value: r.value }) : reply.code(409).send({ ok: false, error: r.error })
}

const appParams = z.object({ app: z.string() })
const workParams = z.object({ app: z.string(), workItemId: z.string() })

// ---------- Routes ----------

export function buildServer(rt: Runtime): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' ? { level: 'info' } : false })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NotFound) return reply.code(404).send({ ok: false, error: err.message })
    if (err instanceof Unauthorized) return reply.code(401).send({ ok: false, error: err.message })
    if (err instanceof z.ZodError) return reply.code(400).send({ ok: false, error: 'Invalid request', issues: err.issues })
    reply.log.error(err)
    return reply.code(500).send({ ok: false, error: 'Unexpected error' })
  })

  app.get('/api/health', async () => ({ ok: true, apps: rt.design.apps.length }))

  app.get('/api', async () => ({
    name: 'Modus API (prototype)',
    identity: 'x-user-id header (prototype); OIDC bearer tokens in production',
    routes: app.printRoutes({ commonPrefix: false }).split('\n').filter(Boolean),
  }))

  app.get('/api/apps', async () => rt.design.apps.map((a) => ({ id: a.id, name: a.name, description: a.description, workflows: a.workflows.map((w) => ({ id: w.id, name: w.name, kind: w.kind ?? 'process' })) })))

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

  app.get('/api/apps/:app/items/:itemId', async (req, reply) => {
    const { app: appId, itemId } = z.object({ app: z.string(), itemId: z.string() }).parse(req.params)
    const user = typeof req.headers['x-user-id'] === 'string' ? req.headers['x-user-id'] : undefined
    return rt.read(appId, (sim, ctx) => {
      const obj = sim.objects[itemId] ?? Object.values(sim.objects).find((o) => o.number === itemId)
      return obj ? itemDto(obj, ctx, user, sim) : reply.code(404).send({ ok: false, error: 'No such item.' })
    })
  })

  // ----- My work (the workbasket) -----

  app.get('/api/apps/:app/my/basket', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => basketOf(sim, ctx, user).map((i) => workItemDto(i, ctx)))
  })

  app.get('/api/apps/:app/my/queues', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => queuesFor(sim, ctx, user).map((q) => ({ stepId: q.nodeId, label: q.label, group: q.groupName, waiting: q.items.map((i) => workItemDto(i, ctx)) })))
  })

  app.get('/api/apps/:app/my/distribution', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) =>
      distributionFor(sim, ctx, user).map((d) => ({ stepId: d.nodeId, label: d.label, group: d.groupName, waiting: d.waiting.map((i) => workItemDto(i, ctx)), assigned: d.assigned.map((i) => workItemDto(i, ctx)) })),
    )
  })

  app.get('/api/apps/:app/my/requests', async (req) => {
    const { app: appId } = appParams.parse(req.params)
    const user = who(req)
    return rt.read(appId, (sim, ctx) => requestsBy(sim, ctx, user).map((r) => ({ itemId: r.obj.id, number: r.obj.number, status: r.obj.status, where: r.where, due: r.due, overdue: r.overdue })))
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

  // ----- Administrator (authorization by role comes with OIDC; see docs) -----

  app.post('/api/apps/:app/admin/work/:workItemId/assign', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const actor = who(req)
    const b = z.object({ to: z.string(), sameGroupOnly: z.boolean().default(true) }).parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => adminAssign(sim, ctx, workItemId, b.to, ctx.users.find((u) => u.id === actor)?.name ?? actor, { sameGroupOnly: b.sameGroupOnly })))
  })

  app.post('/api/apps/:app/admin/work/:workItemId/move', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const actor = who(req)
    const b = z.object({ stepId: z.string() }).parse(req.body)
    return send(reply, await rt.run(appId, (sim, ctx) => adminMove(sim, ctx, workItemId, b.stepId, ctx.users.find((u) => u.id === actor)?.name ?? actor)))
  })

  app.post('/api/apps/:app/admin/work/:workItemId/retry', async (req, reply) => {
    const { app: appId, workItemId } = workParams.parse(req.params)
    const actor = who(req)
    return send(reply, await rt.run(appId, (sim, ctx) => adminRetry(sim, ctx, workItemId, ctx.users.find((u) => u.id === actor)?.name ?? actor)))
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

  app.get('/api/apps/:app/stream', async (req, reply) => {
    const { app: appId } = appParams.parse(req.params)
    rt.ctx(appId)
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
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
    req.raw.on('close', unsubscribe)
    return reply
  })

  return app
}
