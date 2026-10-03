# @modus-bpm/server (skeleton)

The core engine running **live**: the same code the studio simulates with, behind a REST API.
No simulated people or arrivals here — people act through the API, and automated steps
become jobs that registered workers poll and complete. It can also serve the built studio.

```bash
pnpm --filter @modus-bpm/server dev            # http://127.0.0.1:8787/api
PORT=8787 DATA_DIR=./data TIME_SCALE=1 pnpm --filter @modus-bpm/server start
pnpm --filter @modus-bpm/server test           # the API end to end, the assistant with a fake model
pnpm --filter @modus-bpm/server build          # one bundled file: dist/server.mjs
```

| Concern | Where |
| --- | --- |
| HTTP edge (Fastify + zod), static studio | `src/http.ts` |
| What goes over the wire (field security on reads) | `src/dto.ts` |
| Assistant: Claude with read-only tools, built-in fallback | `src/assistant.ts` |
| Configuration (every environment variable) | `src/config.ts` |
| Engine runtime: clock, command serialization, event flushing | `src/runtime.ts` |
| Storage ports (design, live state, event log) | `src/ports.ts` |
| In-memory / JSON-file adapter | `src/adapters/memory.ts` |
| Production bundle (esbuild) | `build.mjs` |
| Example registered worker ("device") | `examples/worker.ts` |

Identity is a stand-in (`x-user-id` header). The call stack, the database strategy
(Postgres first, then SQL Server and Oracle behind the same ports) and the milestones to
production are in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md); running it in Docker,
on a VM or on Kubernetes, and every setting, are in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

## Endpoints

Routes under `/api/apps/:app` act on one application. Personal routes need `x-user-id`
(`401` without it). Refusals come back as `{ ok: false, error }`: `403` when the caller may not
do it, `404` when the thing doesn't exist (or they can't see it), `409` when the engine refuses
(a comment is required, the person isn't in the step's group, it's already expedited…).

| Area | Endpoints |
| --- | --- |
| Discovery | `GET /api` (route list), `GET /api/apps`, `GET …/overview` |
| Health | `GET /api/health` (liveness), `GET /api/ready` (readiness; `503` while shutting down) |
| Items | `POST …/items`, `GET …/items/:idOrNumber` (only what the caller may see), `POST …/items/:id/expedite` `{ on, reason }` |
| Search | `GET …/search?q=&sort=relevance\|newest\|due\|priority&limit=` → `{ total, hits, facets }` |
| Assistant | `POST …/assistant` `{ question, history?: [{ role, text }] }` → `{ text, query?, hits?, suggestions, source, notice? }` |
| My work | `GET …/my/basket · queues · distribution · requests · supervision`, `POST …/my/next` |
| Work items | `POST …/work/:id/claim · start · save · release · return · delegate · distribute` |
| Supervisors | `POST …/supervise/:id/assign` `{ to }` · `return` · `release` `{ outcomeId, comment }` · `retry`, `POST …/supervise/steps/:stepId/redistribute` |
| Administration | `POST …/admin/work/:id/assign · move · retry` (administrators, or supervisors of that work) |
| Workers | `POST /api/jobs/poll`, `POST /api/jobs/:id/complete`, `POST /api/jobs/:id/fail` |
| Process mining | `GET …/export/ocel` (OCEL 2.0 JSON of the event log) |
| Live | `GET …/stream` (Server-Sent Events) |
| Studio | Everything outside `/api` when `STATIC_DIR` is set, with single-page-app fallback |

**Search** uses the same language as the studio's search box (words, `"phrases"`, `-exclude`,
`priority:urgent`, `is:overdue`, `step:"manager approval"`, `assignee:me`, `amount>10k`,
`vendor:acme`, `created:<2d` …; see `packages/core/src/engine/search.ts`). Hits never include, or
match on, fields hidden from the caller.

**The assistant** answers with Claude (`claude-opus-5-5` unless `MODUS_ASSISTANT_MODEL` says
otherwise) when `ANTHROPIC_API_KEY` is set. The model gets read-only tools that call core as the
caller: `search_items`, `get_item`, `my_work`, `process_overview` and `explain`. The system
prompt and tools never change, so they are cached across requests. Without a key, or when the
model fails or declines, the built-in interpreter (core `ask`) answers in the same shape with
`source: 'built-in'`. What is sent to Anthropic: [DEPLOYMENT.md › The assistant and your data](../../docs/DEPLOYMENT.md#the-assistant-and-your-data).

## Try it

```bash
# A person creates an item
curl -X POST localhost:8787/api/apps/app_invoice/items -H 'x-user-id: u_maya' \
  -H 'content-type: application/json' \
  -d '{"workflowId":"w_invoice","data":{"f_invno":"A-1","f_lines":[{"c_desc":"Toner","c_qty":4,"c_price":105}],"f_dept":"l_org_0","f_cc":"l_org_1"}}'

# A worker for the ERP service picks up the job and completes it
curl -X POST localhost:8787/api/jobs/poll -H 'content-type: application/json' \
  -d '{"serviceId":"svc_erp","workerId":"erp-1"}'
curl -X POST 'localhost:8787/api/jobs/app_invoice:o1~1/complete' -H 'content-type: application/json' \
  -d '{"outputs":{"matched":true}}'

# Or run the example worker, which polls, works and completes jobs for one service
SERVICE=svc_erp pnpm --filter @modus-bpm/server worker

# The clerk it was load balanced to sees it, and releases it
curl localhost:8787/api/apps/app_invoice/my/basket -H 'x-user-id: u_jordan'
curl -N localhost:8787/api/apps/app_invoice/stream     # live counts per step (SSE)

# Search, ask, supervise, expedite
curl 'localhost:8787/api/apps/app_invoice/search?q=toner%20is:open' -H 'x-user-id: u_maya'
curl -X POST localhost:8787/api/apps/app_invoice/assistant -H 'x-user-id: u_maya' \
  -H 'content-type: application/json' -d '{"question":"What should I work on next?"}'
curl localhost:8787/api/apps/app_invoice/my/supervision -H 'x-user-id: u_carla'
curl -X POST localhost:8787/api/apps/app_invoice/items/o1/expedite -H 'x-user-id: u_maya' \
  -H 'content-type: application/json' -d '{"on":true,"reason":"Early-payment discount ends Friday"}'
```

## In Docker

```bash
docker compose up --build                      # studio and API on http://localhost:8787
docker build -t modus:local . && docker run --rm -p 8787:8787 -v modus-data:/data modus:local
```

The image serves the studio from `/app/public`, keeps its snapshots in `/data`, runs as user
1000 and answers its `HEALTHCHECK` on `/api/health`. The Helm chart is in
[`deploy/helm/modus`](../../deploy/helm/modus).
