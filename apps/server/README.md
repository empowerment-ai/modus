# @throughline/server (skeleton)

The core engine running **live**: the same code the studio simulates with, behind a REST API.
No simulated people or arrivals here — people act through the API, and automated steps
become jobs that registered workers poll and complete.

```bash
pnpm --filter @throughline/server dev            # http://127.0.0.1:8787/api
PORT=8787 DATA_DIR=./data TIME_SCALE=1 pnpm --filter @throughline/server start
pnpm --filter @throughline/server test           # one invoice, end to end through the API
```

| Concern | Where |
| --- | --- |
| HTTP edge (Fastify + zod) | `src/http.ts` |
| Engine runtime: clock, command serialization, event flushing | `src/runtime.ts` |
| Storage ports (design, live state, event log) | `src/ports.ts` |
| In-memory / JSON-file adapter | `src/adapters/memory.ts` |
| Example registered worker ("device") | `examples/worker.ts` |

Identity is a stand-in (`x-user-id` header). The call stack, the database strategy
(Postgres first, then SQL Server and Oracle behind the same ports) and the milestones to
production are in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Try it

```bash
# A person creates an item
curl -X POST localhost:8787/api/apps/app_invoice/items -H 'x-user-id: u_maya' \
  -H 'content-type: application/json' \
  -d '{"workflowId":"w_invoice","data":{"f_invno":"A-1","f_amount":420,"f_dept":"l_org_0","f_cc":"l_org_1"}}'

# A worker for the ERP service picks up the job and completes it
curl -X POST localhost:8787/api/jobs/poll -H 'content-type: application/json' \
  -d '{"serviceId":"svc_erp","workerId":"erp-1"}'
curl -X POST 'localhost:8787/api/jobs/app_invoice:o1~1/complete' -H 'content-type: application/json' \
  -d '{"outputs":{"matched":true}}'

# Or run the example worker, which polls, works and completes jobs for one service
SERVICE=svc_erp pnpm --filter @throughline/server worker

# The clerk it was load balanced to sees it, and releases it
curl localhost:8787/api/apps/app_invoice/my/basket -H 'x-user-id: u_jordan'
curl -N localhost:8787/api/apps/app_invoice/stream     # live counts per step (SSE)
```
