// An example registered worker: the "device" pattern. It polls the server for
// jobs of one service, does the work, and completes (or fails) each job. Any
// language can do this; it is three HTTP calls.
//
//   pnpm --filter @modus-bpm/server dev                      # in one terminal
//   SERVICE=svc_vision pnpm --filter @modus-bpm/server worker # in another
//
// Then create a camera event (see apps/server/README.md) and watch it move.

const base = process.env.MODUS_URL ?? 'http://127.0.0.1:8787'
const serviceId = process.env.SERVICE ?? 'svc_vision'
const workerId = `${serviceId}-${process.pid}`

interface Job {
  id: string
  itemNumber: string
  operation: string
  attempt: number
  inputs: Record<string, unknown>
}

/** The actual work. Replace with a call to your model, robot, legacy system… */
async function handle(job: Job): Promise<Record<string, unknown>> {
  // job.inputs holds the step's request parameters, e.g. { po: 'PO-9' } for the ERP match.
  await new Promise((r) => setTimeout(r, 300 + 100 * Object.keys(job.inputs).length))
  if (serviceId === 'svc_vision') return { confidence: Math.round(40 + Math.random() * 59), label: Math.random() < 0.7 ? 'Person' : 'Vehicle' }
  if (serviceId === 'svc_erp') return { matched: Math.random() < 0.85 }
  return {}
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return (await r.json()) as T
}

console.log(`${workerId} polling ${base} for ${serviceId} jobs`)
for (;;) {
  try {
    const { jobs } = await post<{ jobs: Job[] }>('/api/jobs/poll', { serviceId, workerId, max: 5, leaseSeconds: 60 })
    if (!jobs.length) {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
    for (const job of jobs) {
      try {
        const outputs = await handle(job)
        await post(`/api/jobs/${encodeURIComponent(job.id)}/complete`, { outputs })
        console.log(`done ${job.itemNumber} ${job.operation}`, outputs)
      } catch (err) {
        await post(`/api/jobs/${encodeURIComponent(job.id)}/fail`, { error: String(err) })
        console.log(`failed ${job.itemNumber}: ${String(err)}`)
      }
    }
  } catch {
    // Server not up yet, or restarting.
    await new Promise((r) => setTimeout(r, 2000))
  }
}
