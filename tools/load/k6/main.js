// Mixed load on the invoice app: new items, clerks working their queues, service workers.
// `PROFILE` (smoke|baseline|full) picks the rates from profiles.js; `BASE_URL` is nginx in front
// of the servers; `CLERKS` (default: the profile's peak of people) is how many load clerks
// setup.ts made. Live screens are the observer's.
import http from 'k6/http'
import { sleep } from 'k6'
import exec from 'k6/execution'
import { Counter } from 'k6/metrics'
import { APP, WORKFLOW, REQUESTER, SERVICES, between, clerk, invoice, pick } from './data.js'
import { CLERKS as CLERKS_BY_PROFILE, scenarios } from './profiles.js'

const PROFILE = __ENV.PROFILE || 'smoke'
const BASE = (__ENV.BASE_URL || 'http://nginx').replace(/\/$/, '')
const CLERKS = Number(__ENV.CLERKS || CLERKS_BY_PROFILE[PROFILE])
// Invoice numbers stay unique across runs on the same database.
const RUN = Date.now().toString(36)

const KINDS = ['create', 'basket', 'queues', 'next', 'open', 'save', 'release', 'poll', 'complete', 'fail']
// The design's soft limits are per class (reads p95 < 300 ms, changes < 500 ms); percentiles don't
// add up across kinds, so k6 keeps the classes' own. `my/next` and a poll take work: changes.
const READS = ['basket', 'queues', 'open']
const op = (kind) => (READS.includes(kind) ? 'read' : 'change')

// Always-true thresholds: they only make k6 keep per-kind numbers in its summary for the report.
// The soft limits are the report's to judge; nothing here fails or stops a run.
const perKind = {}
for (const k of KINDS) {
  perKind[`http_req_duration{kind:${k}}`] = ['max>=0']
  perKind[`http_req_failed{kind:${k}}`] = ['rate>=0']
  perKind[`http_reqs{kind:${k}}`] = ['count>=0']
  perKind[`busy{kind:${k}}`] = ['count>=0']
}
for (const o of ['read', 'change']) perKind[`http_req_duration{op:${o}}`] = ['max>=0']

export const options = {
  scenarios: scenarios(PROFILE),
  thresholds: perKind,
  // Bodies are kept only where the script reads them (`read` below): less memory and CPU per VU.
  discardResponseBodies: true,
  // A worker completes a whole poll's jobs at once (see workers()).
  batch: 75,
  batchPerHost: 75,
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

/** 503s: the server shedding load (storage busy or shutting down), counted apart from other errors. */
const busy = new Counter('busy')
// Progress, so a run that "passes" without doing anything shows it.
const created = new Counter('items_created')
const releases = new Counter('releases')
const nothingNext = new Counter('next_empty')
const completed = new Counter('jobs_completed')
const failed = new Counter('jobs_failed')
// A job finished, cancelled or re-leased by the time its worker answered: a race, not an error.
const gone = new Counter('jobs_gone')
// A clerk's save or release refused with 409: the item moved on (escalated, redistributed) meanwhile.
const races = new Counter('races')

const app = `/api/apps/${APP}`

/** Request params for one kind; `read` keeps the body, `ok` lists the statuses that aren't failures. */
function params(kind, { user, body, ok, read } = {}) {
  const headers = {}
  if (user) headers['x-user-id'] = user
  // No content type without a body: Fastify refuses an empty JSON body.
  if (body !== undefined) headers['content-type'] = 'application/json'
  // `name` too, so URLs with ids don't each become their own series.
  const p = { headers, tags: { kind, name: kind, op: op(kind) } }
  // Only when given: an undefined callback switches off http_req_failed for the request.
  if (ok) p.responseCallback = ok
  if (read) p.responseType = 'text'
  return p
}

const counted = (res, kind) => {
  if (res.status === 503) busy.add(1, { kind })
  return res
}

function call(method, path, kind, opts = {}) {
  const body = opts.body === undefined ? null : JSON.stringify(opts.body)
  return counted(http.request(method, BASE + path, body, params(kind, opts)), kind)
}

function json(res) {
  try {
    return res.json()
  } catch {
    return undefined
  }
}

const think = () => sleep(between(2, 8))

export function items() {
  const res = call('POST', `${app}/items`, 'create', {
    user: REQUESTER,
    body: { workflowId: WORKFLOW, data: invoice(`L${RUN}-${exec.scenario.iterationInTest}`) },
  })
  if (res.status === 201) created.add(1)
}

// An empty queue answers 409; for `my/next` that's a quiet moment, not a failure.
const nextOk = http.expectedStatuses(200, 409)
// For save and release, 409 is a race (see `races`), counted apart.
const workOk = http.expectedStatuses(200, 409)

/** The happy outcome by its label, else the step's first. */
const happy = (outcomes) => outcomes.find((o) => /approve/i.test(o.label)) || outcomes[0]

export function people() {
  const user = clerk(exec.vu.idInTest, CLERKS)
  const basket = () => {
    const r = call('GET', `${app}/my/basket`, 'basket', { user, read: true })
    return ((r.status === 200 && json(r)) || []).filter((w) => w.outcomes && w.outcomes.length)
  }
  // Auto-distribution puts work straight into baskets; the queue is for what's left.
  const mine = basket()
  let work = mine.length ? pick(mine) : undefined
  call('GET', `${app}/my/queues`, 'queues', { user })
  if (!work) {
    const r = call('POST', `${app}/my/next`, 'next', { user, ok: nextOk, read: true })
    if (r.status !== 200) {
      if (r.status === 409) nothingNext.add(1)
      return think()
    }
    // `my/next` answers with the work item id only; the basket has its item and outcomes.
    const id = (json(r) || {}).value
    work = basket().find((w) => w.id === id)
    if (!work) return think()
  }

  const item = json(call('GET', `${app}/items/${work.itemId}`, 'open', { user, read: true })) || {}
  const note = (item.fields || []).find((f) => f.access === 'edit' && f.type === 'textarea')
  if (note) {
    const s = call('POST', `${app}/work/${work.id}/save`, 'save', { user, ok: workOk, body: { patch: { [note.id]: `Checked by ${user}` } } })
    if (s.status === 409) {
      races.add(1, { kind: 'save' })
      return think()
    }
  }

  // Mostly the happy outcome, as the seed's weights have it; the comment covers outcomes that need one.
  const outcome = Math.random() < 0.9 ? happy(work.outcomes) : pick(work.outcomes)
  const r = call('POST', `${app}/work/${work.id}/release`, 'release', { user, ok: workOk, body: { outcomeId: outcome.id, comment: 'Load test review' } })
  if (r.status === 200) releases.add(1)
  else if (r.status === 409) races.add(1, { kind: 'release' })
  think()
}

const jobOk = http.expectedStatuses(200, 410)

// A few VUs per profile (the design's 2/4/8) must keep up with every job the items make: about
// 2.8 jobs per item, so ~28/s at baseline and ~280/s at full. Each VU takes a batch per service,
// "calls" them all at once (one wait), then answers them in one parallel http.batch, so its
// throughput grows with the batch, not with its count.
export function workers() {
  const workerId = `k6-worker-${exec.vu.idInTest}`
  const jobs = []
  for (const serviceId of SERVICES) {
    // Real seconds: far longer than a batch takes, short enough that a stopped worker's jobs come back soon.
    const r = call('POST', '/api/jobs/poll', 'poll', { body: { serviceId, workerId, max: 25, leaseSeconds: 60 }, read: true })
    for (const job of (r.status === 200 && (json(r) || {}).jobs) || []) jobs.push({ ...job, serviceId })
  }
  if (!jobs.length) return sleep(between(0.5, 1))
  // As if calling the services.
  sleep(between(0.05, 0.3))
  const answers = jobs.map((job) => {
    const id = encodeURIComponent(job.id)
    const ok = Math.random() < 0.95
    const kind = ok ? 'complete' : 'fail'
    const body = ok ? { outputs: { matched: Boolean(job.inputs && job.inputs.po) } } : { error: 'load test: simulated failure' }
    return { ok, kind, serviceId: job.serviceId, req: ['POST', `${BASE}/api/jobs/${id}/${kind}`, JSON.stringify(body), params(kind, { body, ok: jobOk })] }
  })
  const responses = http.batch(answers.map((a) => a.req))
  answers.forEach((a, i) => {
    const res = counted(responses[i], a.kind)
    if (res.status === 410) gone.add(1, { kind: a.kind })
    else if (res.status === 200) (a.ok ? completed : failed).add(1, { service: a.serviceId })
  })
}
