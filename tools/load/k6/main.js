// Mixed load on the invoice app: new items, clerks working their queues, service workers.
// `PROFILE` (smoke|baseline|full) picks the rates from profiles.js; `BASE_URL` is nginx in front
// of the servers; `CLERKS` is how many load clerks setup.ts made. Live screens are the observer's.
import http from 'k6/http'
import { sleep } from 'k6'
import exec from 'k6/execution'
import { Counter } from 'k6/metrics'
import { APP, WORKFLOW, REQUESTER, SERVICES, between, clerk, invoice, pick } from './data.js'
import { scenarios } from './profiles.js'

const BASE = (__ENV.BASE_URL || 'http://nginx').replace(/\/$/, '')
const CLERKS = Number(__ENV.CLERKS || 20)
// Invoice numbers stay unique across runs on the same database.
const RUN = Date.now().toString(36)

const KINDS = ['create', 'basket', 'queues', 'next', 'open', 'save', 'release', 'poll', 'complete', 'fail']

// Always-true thresholds: they only make k6 keep per-kind numbers in its summary for the report.
// The soft limits are the report's to judge; nothing here fails or stops a run.
const perKind = {}
for (const k of KINDS) {
  perKind[`http_req_duration{kind:${k}}`] = ['max>=0']
  perKind[`http_req_failed{kind:${k}}`] = ['rate>=0']
}

export const options = {
  scenarios: scenarios(__ENV.PROFILE || 'smoke'),
  thresholds: perKind,
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

const app = `/api/apps/${APP}`

function call(method, path, kind, { user, body, ok } = {}) {
  const headers = {}
  if (user) headers['x-user-id'] = user
  // No content type without a body: Fastify refuses an empty JSON body.
  if (body !== undefined) headers['content-type'] = 'application/json'
  // `name` too, so URLs with ids don't each become their own series.
  const params = { headers, tags: { kind, name: kind } }
  // Only when given: an undefined callback switches off http_req_failed for the request.
  if (ok) params.responseCallback = ok
  const res = http.request(method, BASE + path, body === undefined ? null : JSON.stringify(body), params)
  if (res.status === 503) busy.add(1, { kind })
  return res
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

export function people() {
  const user = clerk(exec.vu.idInTest, CLERKS)
  const basket = () => {
    const r = call('GET', `${app}/my/basket`, 'basket', { user })
    return (r.status === 200 && json(r)) || []
  }
  // Auto-distribution puts work straight into baskets; the queue is for what's left.
  let work = basket().find((w) => w.outcomes && w.outcomes.length)
  call('GET', `${app}/my/queues`, 'queues', { user })
  if (!work) {
    const r = call('POST', `${app}/my/next`, 'next', { user, ok: nextOk })
    if (r.status !== 200) {
      if (r.status === 409) nothingNext.add(1)
      return think()
    }
    // `my/next` answers with the work item id only; the basket has its item and outcomes.
    const id = (json(r) || {}).value
    work = basket().find((w) => w.id === id)
    if (!work) return think()
  }

  const item = json(call('GET', `${app}/items/${work.itemId}`, 'open', { user })) || {}
  const note = (item.fields || []).find((f) => f.access === 'edit' && f.type === 'textarea')
  if (note) call('POST', `${app}/work/${work.id}/save`, 'save', { user, body: { patch: { [note.id]: `Checked by ${user}` } } })

  // Mostly the first (happy) outcome, as the seed's weights have it; the comment covers outcomes that need one.
  const outcome = Math.random() < 0.9 ? work.outcomes[0] : pick(work.outcomes)
  const r = call('POST', `${app}/work/${work.id}/release`, 'release', { user, body: { outcomeId: outcome.id, comment: 'Load test review' } })
  if (r.status === 200) releases.add(1)
  think()
}

const jobOk = http.expectedStatuses(200, 410)

export function workers() {
  const workerId = `k6-worker-${exec.vu.idInTest}`
  let any = false
  for (const serviceId of SERVICES) {
    // The lease is on the application's clock, which runs TIME_SCALE times faster: 600 s there is
    // seconds here, still well past the few hundred ms a job takes.
    const r = call('POST', '/api/jobs/poll', 'poll', { body: { serviceId, workerId, max: 3, leaseSeconds: 600 } })
    const jobs = (r.status === 200 && (json(r) || {}).jobs) || []
    for (const job of jobs) {
      any = true
      // As if calling the service.
      sleep(between(0.05, 0.3))
      const id = encodeURIComponent(job.id)
      const ok = Math.random() < 0.95
      const res = ok
        ? call('POST', `/api/jobs/${id}/complete`, 'complete', { body: { outputs: { matched: Boolean(job.inputs && job.inputs.po) } }, ok: jobOk })
        : call('POST', `/api/jobs/${id}/fail`, 'fail', { body: { error: 'load test: simulated failure' }, ok: jobOk })
      if (res.status === 410) gone.add(1, { kind: ok ? 'complete' : 'fail' })
      else if (res.status === 200) (ok ? completed : failed).add(1, { service: serviceId })
    }
  }
  if (!any) sleep(between(0.5, 1))
}
