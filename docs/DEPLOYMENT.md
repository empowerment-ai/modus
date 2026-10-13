# Deploying Modus

Modus ships as one container image, `ghcr.io/empowerment-ai/modus`, that holds the studio and the
server. This guide covers running it on a laptop, on a single VM, on Kubernetes as a hosted
(SaaS) service, and self-hosted in a closed network. Each section says plainly what works
today and what is planned.

- [What is real today](#what-is-real-today)
- [Run it locally](#run-it-locally)
- [A single VM](#a-single-vm)
- [Kubernetes and SaaS](#kubernetes-and-saas)
- [Self-hosted and air-gapped](#self-hosted-and-air-gapped)
- [Configuration reference](#configuration-reference)
- [Health and readiness](#health-and-readiness)
- [Backups and upgrades](#backups-and-upgrades)
- [The assistant and your data](#the-assistant-and-your-data)

## What is real today

| Area | Today | Planned |
| --- | --- | --- |
| Packaging | One image (amd64 and arm64), Docker Compose, a Helm chart, CI that builds every PR and publishes `main` | Signed images, release bundles |
| Storage | **PostgreSQL** (`DB_DIALECT=postgres`, the Compose default): design, each application's live state, the event log, item and work-item projections and an outbox, all written in one transaction per command, with versioned migrations run at startup. Or **in memory**, snapshotted to JSON files in `DATA_DIR`. | Per-item locking (after M1); SQL Server (M6), Oracle (v1.1) behind the same storage ports |
| Scale | On PostgreSQL, several replicas share one database, one command at a time per application. In memory, one process. | Roles split across deployments |
| Identity | The `x-user-id` header: whoever calls the API says who they are | OIDC sign-in (Keycloak, Entra ID, Login.gov), SCIM group sync |
| Tenancy | One organization per installation | Tenant id in every key; Postgres row-level security for hosted; a database per tenant for regulated customers |
| Observability | JSON logs on stdout, live counts per step (`/overview`), OCEL 2.0 export | OpenTelemetry traces, Prometheus metrics |
| Outbox | Every message is posted to configured webhook endpoints, signed, with retries, shared by all replicas ([Webhooks](#webhooks)) | Email from Modus, REST and MCP connectors (M4) |
| Assistant | Claude through read-only tools when `ANTHROPIC_API_KEY` is set; the built-in interpreter otherwise | |

> **Treat today's server as a pilot.** Because identity is a header, anyone who can reach the
> API can act as anyone. Run it for demos, evaluations and pilots on a trusted network, not on
> the open internet, until OIDC lands.

## Run it locally

From a clone, with Node.js 22 and pnpm (via `corepack enable`):

```bash
pnpm install
pnpm dev                                      # the studio alone, simulating in the browser: http://localhost:5180
pnpm --filter @modus-bpm/server dev           # the API: http://127.0.0.1:8787/api

# The studio served by the server, as in the image:
pnpm --filter @modus-bpm/studio build
STATIC_DIR=$PWD/apps/studio/dist pnpm --filter @modus-bpm/server dev

# The production bundle (one file, no node_modules needed to run it):
pnpm --filter @modus-bpm/server build
STATIC_DIR=$PWD/apps/studio/dist node apps/server/dist/server.mjs
```

The server on a local PostgreSQL (any 16–18; the Compose one is fine):

```bash
docker compose up -d postgres                 # PostgreSQL 18 on 127.0.0.1:5432
DB_DIALECT=postgres DATABASE_URL=postgres://modus:modus-dev-only@127.0.0.1:5432/modus \
  pnpm --filter @modus-bpm/server dev
TEST_DATABASE_URL=postgres://modus:modus-dev-only@127.0.0.1:5432/modus \
  pnpm --filter @modus-bpm/server test:pg      # the storage contract suite against it
```

`pnpm test` runs the contract suite against the memory adapter only and skips Postgres unless
`TEST_DATABASE_URL` is set; `test:pg` fails without it. Each Postgres test works in a schema of its
own and drops it afterwards, so it never touches the tables Modus itself uses.

With Docker:

```bash
docker compose up --build                     # Modus and PostgreSQL: http://localhost:8787
ANTHROPIC_API_KEY=… docker compose up -d      # with the language-model assistant
docker compose down                           # stop; the postgres-data volume keeps the state
docker compose down -v                        # stop and delete the data
DB_DIALECT=memory docker compose up --no-deps modus   # no database: JSON snapshots in modus-data
```

Compose starts `postgres` (PostgreSQL 18, data in the `postgres-data` volume, published on
`127.0.0.1:5432`, or `POSTGRES_PORT`) and starts `modus` once Postgres reports healthy, with
`DB_DIALECT=postgres` and a `DATABASE_URL` pointing at it. Modus applies its schema migrations
at startup. The password is a development-only default (`modus-dev-only`); set
`POSTGRES_PASSWORD` in an untracked `.env` before the volume is first created (it is spliced
into the connection string, so use URL-safe characters). Two optional profiles hold
infrastructure on the roadmap that Modus does not use yet: `nats` (NATS JetStream with an MQTT
listener, for event ingest) and `keycloak` (OIDC). They never start unless named:
`docker compose --profile nats up -d`.

Or run the image directly (in memory, unless you pass `DB_DIALECT` and `DATABASE_URL`):

```bash
docker run -d --name modus -p 8787:8787 -v modus-data:/data ghcr.io/empowerment-ai/modus:main
```

## A single VM

The simplest real deployment: one Linux VM with Docker Engine and the Compose plugin.

1. Copy `docker-compose.yml` to the VM (or clone the repository) and point it at the published
   image instead of building: replace `build: .` with `image: ghcr.io/empowerment-ai/modus:main`
   (or a `sha-…` tag to pin a build).
2. Keep secrets out of the file. Put them in a `.env` next to it, readable only by the
   operator (`chmod 600 .env`), or export them in the shell that runs Compose:
   ```bash
   ANTHROPIC_API_KEY=…
   ```
3. Publish the port on localhost only and put a TLS proxy in front. With Caddy, which gets
   certificates automatically and streams Server-Sent Events without buffering:
   ```bash
   MODUS_PORT=127.0.0.1:8787 docker compose up -d
   ```
   ```caddyfile
   modus.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```
4. `restart: unless-stopped` brings Modus and Postgres back after a reboot. Back up the
   database (see [Backups](#backups-and-upgrades)).

Sizing: an idle server uses about 50 MB of memory. Memory grows with the number of live items,
since every server keeps each application's live state in memory (Postgres stores it, it does
not page it); 1 GB is plenty for pilots.

## Kubernetes and SaaS

The chart is in `deploy/helm/modus`. It needs Kubernetes 1.27 or later and Helm 3.

```bash
kubectl create namespace modus
# Optional: the language-model assistant. Prefer External Secrets, Sealed Secrets or a CSI
# driver in production; never commit the key.
kubectl -n modus create secret generic modus-anthropic --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"

helm install modus deploy/helm/modus -n modus \
  --set image.tag=main \
  --set assistant.existingSecret=modus-anthropic \
  --set ingress.enabled=true --set ingress.className=nginx \
  --set ingress.hosts[0].host=modus.example.com --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

What the chart creates: one Deployment per entry in `deployments` (by default a single
all-in-one deployment), a Service on the pods that play the `api` role, a ConfigMap with the
non-secret settings, a PersistentVolumeClaim for `/data` (memory only; kept on uninstall), a ServiceAccount
without an API token, and optionally an Ingress, a HorizontalPodAutoscaler and a
PodDisruptionBudget. Pods run as user 1000 with a read-only root filesystem, no capabilities
and the runtime-default seccomp profile.

**With `database.dialect: memory` (the default) the chart runs one pod.** It fails to render
with more than one replica, more than one deployment, or autoscaling, because each pod would
hold its own copy of the live state. The Deployment uses the `Recreate` strategy, so an upgrade
has a short gap while the old pod stops and the new one loads.

**With `database.dialect: postgres` you can run several replicas.** Point
`database.existingSecret` at a Secret holding `DATABASE_URL`; the server migrates the schema at
startup. Then set `deployments.all.replicas`, or turn on `autoscaling`, and turn on
`podDisruptionBudget` once you run two or more. The Deployment uses `RollingUpdate` unless you
set `deployments.<name>.strategy: Recreate` (needed once when upgrading from a release before M2;
see [Upgrades](#backups-and-upgrades)).

```bash
helm install modus deploy/helm/modus -n modus --set image.tag=main \
  --set database.dialect=postgres --set database.existingSecret=modus-db \
  --set deployments.all.replicas=3 --set podDisruptionBudget.enabled=true
```

### Several replicas on PostgreSQL

Every replica serves every request and keeps each application's state in memory. A command locks
its application's row in Postgres, so commands to one application run one at a time across all
replicas, and commands to different applications run in parallel. Each commit sends a
`NOTIFY`; the other replicas reload that application, so their reads and live streams catch up
within moments. One replica per application, the one holding its advisory lock, moves the
clock (timers, SLAs, escalations, retries). If it stops, another takes over on its next tick.

- **`503` busy.** A command waits up to 5 seconds (`lock_timeout`) for its application's row. If
  another replica still holds it, the command fails with `503`, a `Retry-After: 5` header and
  "Another server is busy with this application. Try again shortly." Nothing changed; retry it.
- **Stalled transactions.** A command's transaction may not run a statement for more than 30
  seconds (`statement_timeout`) or sit idle for more than 15 (`idle_in_transaction_session_timeout`).
  Postgres then ends it and releases the row, so a hung or cut-off replica can't hold an
  application for the others.
- **Readiness.** Each replica keeps one extra connection open to `LISTEN` for the others'
  changes. While that connection is down, `/api/ready` answers `503` so traffic goes to replicas
  that are current. When it comes back, the replica reloads every application.
- **Connections.** Each replica uses up to `DB_POOL_MAX + 1` connections (the pool, default 10,
  plus the listening one), all from `DATABASE_URL`. Replicas × (`DB_POOL_MAX` + 1), plus the
  extra pods a rolling update starts, must stay under Postgres `max_connections` minus its
  reserved connections (`superuser_reserved_connections` and any others), or under your pooler's
  limit. In the chart, set `database.poolMax`. `DATABASE_URL` must point at Postgres directly or
  at a session-mode pooler (PgBouncer `pool_mode = session`). Transaction pooling breaks `LISTEN`
  and the session advisory locks that pick each clock's ticker.

To try two replicas with Compose, uncomment `modus-2` in `docker-compose.yml`, run
`docker compose up -d`, and open http://localhost:8787 and http://localhost:8788 side by side.

To put 1-3 replicas under load on your machine, run `pnpm load`; see
[tools/load/README.md](../tools/load/README.md). Its numbers are for comparing runs, not for
sizing production.

### Ingress and TLS

Set `ingress.tls` and let cert-manager issue the certificate:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
    # The live stream is Server-Sent Events: no buffering, long reads.
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
  hosts:
    - host: modus.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: modus-tls
      hosts: [modus.example.com]
```

### Roles and scaling

Every process can play six roles. Today each process plays all of them (`MODUS_ROLES` is
accepted and logged). On PostgreSQL you scale out by adding replicas of the all-in-one
deployment; in memory you scale up. Once processes honor their roles, the same image runs as
separate deployments, each scaled on its own signal:

| Role | Does | Scales on |
| --- | --- | --- |
| `api` | REST edge, search, the assistant, the studio's files | requests per second, CPU |
| `engine` | Commands against the process engine (per-application locks in SQL; per item later) | command latency |
| `automation` | Outbox dispatch, REST and MCP connectors, worker job leases | outbox depth |
| `scheduler` | Timers, SLAs, escalations, retries | due-timer backlog (few replicas, claims with `SKIP LOCKED`) |
| `ingest` | Stream intake and triage from NATS, MQTT or Kafka | consumer lag |
| `realtime` | The live stream to studios and workspaces | open connections |

`values.yaml` shows the split (`deployments.api`, `deployments.engine`, …) as a commented example.

### Multi-tenancy (planned)

Modus is designed to be hosted for many organizations from one installation:

- **Tenant id in every key and every query**, enforced by the storage ports so application code
  can't forget it. Events, items, work items, timers and the outbox are all keyed by tenant.
- **Hosted SaaS:** one PostgreSQL cluster shared by tenants, with **row-level security** as
  defense in depth (each transaction sets the tenant; policies filter every table).
- **Regulated customers:** a **database per tenant** (or a dedicated installation), selected by
  the tenant's connection string, for hard separation, separate keys and separate backups.

`TENANT_MODE=multi` is accepted today with a warning and changes nothing. **The way to separate
customers today is one Helm release per customer**, each in its own namespace with its own
volume, Secret and host name.

### Secrets

The chart only references Secrets that already exist; it never creates one from values:

| Value | Secret key | Used for |
| --- | --- | --- |
| `assistant.existingSecret` | `assistant.apiKeyKey` (default `ANTHROPIC_API_KEY`) | The language-model assistant |
| `database.existingSecret` | `database.urlKey` (default `DATABASE_URL`) | PostgreSQL storage (`database.dialect: postgres`) |
| `webhooks.existingSecret` | every key, as an environment variable | Webhook secrets named by `secretEnv` (or `WEBHOOK_URL` and `WEBHOOK_SECRET`) |

### Observability

Logs are JSON on stdout (Fastify's pino logger) with a request id per request; health and
readiness probes are only logged when they fail. Collect them with your cluster's log agent.
Live numbers per step are at `GET /api/apps/:app/overview`, and the event log exports as OCEL 2.0
for process-mining tools at `GET /api/apps/:app/export/ocel`. OpenTelemetry traces (click →
command → job → connector call) and a Prometheus `/metrics` endpoint are planned.

## Self-hosted and air-gapped

Modus is built to run where nothing leaves the network.

- **No phone-home.** There is no telemetry. The studio loads nothing from the internet. The
  server makes outbound connections only to the Anthropic API, and only when
  `ANTHROPIC_API_KEY` is set; leave it unset and the built-in assistant answers offline.
- **Offline bundle.** On a connected machine, copy the image (both architectures) and package
  the chart; carry the files across; load them into your registry:
  ```bash
  skopeo copy --all docker://ghcr.io/empowerment-ai/modus:sha-abc1234 oci-archive:modus-sha-abc1234.tar
  helm package deploy/helm/modus                                 # modus-0.2.0.tgz
  # inside:
  skopeo copy --all oci-archive:modus-sha-abc1234.tar docker://registry.internal/modus:sha-abc1234
  helm install modus modus-0.2.0.tgz --set image.repository=registry.internal/modus --set image.tag=sha-abc1234
  ```
  `docker save` / `docker load` work too for a single architecture. Pin by digest
  (`--set image.digest=sha256:…`) so what was reviewed is what runs.
- **Building from source inside** needs the npm packages: run `pnpm fetch` outside to fill a
  pnpm store, carry it in, and build with `pnpm install --offline --frozen-lockfile`.
- **What's in the image.** `/app/server.mjs` (the bundled server), `/app/public` (the studio),
  `/app/LICENSE`, `/app/NOTICE` and `/app/THIRD-PARTY-NOTICES.txt` (the license of every package
  bundled into the server). Nothing else is installed on top of `node:22-alpine`.
- **SBOM and signing.** Images pushed from CI carry a BuildKit SBOM (SPDX) and SLSA provenance
  attestation: `docker buildx imagetools inspect ghcr.io/empowerment-ai/modus:main --format '{{ json .SBOM }}'`.
  Planned: keyless cosign signatures in CI with a verification policy you can enforce
  (Kyverno or the Sigstore policy controller), CycloneDX SBOMs attached to releases, signed
  Helm charts, and a NIST 800-53 control mapping.

## Webhooks

Every outbox message (`job.ready` when a service job is ready, `notify` for notifications and
escalations) is posted to the webhook endpoints you configure, signed, at least once. Use them to
send email, post to chat or wake a worker; sending email from Modus itself comes in M4.

Every server runs a sender. Servers sharing a PostgreSQL database share the work: each delivery is
claimed by one of them at a time, and a server that dies mid-send loses its claim after 60 seconds,
when another takes it. With no endpoint configured, messages are marked sent at once.

The memory store keeps deliveries in the process only: a restart loses pending and failed ones
(and unsent messages). Its message ids keep growing across restarts, so receivers can still drop
ids they have seen.

### Settings

| Variable | What it does |
| --- | --- |
| `WEBHOOK_URL` + `WEBHOOK_SECRET` | One endpoint, named `default`, for every message. |
| `WEBHOOKS_FILE` | A JSON file listing endpoints (below). Can be combined with the two above. |
| `WEBHOOKS_ALLOW_HTTP` | `true` allows `http://` URLs, for receivers inside the cluster and tests. Otherwise `https://` only. |
| `WEBHOOKS_KEEP_DAYS` | Days to keep messages that went out (default 7). |
| `WEBHOOKS_KEEP_FAILED_DAYS` | Days to keep messages with a failed delivery (default 30). |

```json
[
  { "name": "ops", "url": "https://hooks.example.com/modus", "secretEnv": "OPS_HOOK_SECRET", "kinds": ["notify"] },
  { "name": "erp", "url": "https://erp.example.com/in", "secretEnv": "ERP_HOOK_SECRET", "apps": ["app_invoice"] }
]
```

`name` is 1 to 40 of `a-z 0-9 _ -`. `secretEnv` names the environment variable that holds the
secret (`secret` inline also works, but keep secrets out of files you commit). Secrets are at
least 16 characters. `apps` and `kinds` are optional filters; leave them out for everything. URLs
may not carry a username or password. A bad file, a missing secret or a bad URL stops the server
at startup with a message that names the problem; the startup line lists each endpoint's name,
host and filters, never its secret or path.

### The request

```http
POST /modus HTTP/1.1
Content-Type: application/json
User-Agent: Modus-Webhooks/1
Modus-Signature: t=1791896001,v1=5f1c…
Modus-Delivery: 42

{"id":42,"kind":"notify","appId":"app_invoice","itemId":"o_17","createdAt":"2026-10-13T12:53:20.000Z",
 "payload":{"at":95,"kind":"notify","nodeId":"n_reject","text":"Email to Vendor Contact Email: “Invoice INV-17 was rejected”"}}
```

`id` (also in `Modus-Delivery`) is the outbox message id. A message can arrive more than once, so
drop ids you have already handled. A `job.ready` payload is
`{ tokenId, serviceId, nodeId, attempt }`. A `notify` payload is the item's audit entry, so an
escalation also arrives as `kind: "notify"`, with `payload.kind` set to `"escalated"`. `Modus-Signature` holds the time the request was signed
(`t`, Unix seconds) and `v1`, the hex HMAC-SHA256 of `"<t>.<raw body>"` with the endpoint's
secret.

### Verifying the signature (Node)

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

// rawBody: the request body exactly as received (a string), before any JSON parsing.
function verify(secret, rawBody, header) {
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.trim().split('=')))
  const t = Number(parts.t)
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false // older than 5 min
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest()
  const got = Buffer.from(parts.v1 ?? '', 'hex')
  return got.length === expected.length && timingSafeEqual(got, expected)
}
```

Answer with any 2xx once you have the message. Answer quickly: a request times out after 10
seconds.

### Retries and giving up

- A 2xx is delivered.
- Network errors, timeouts, 408, 429 and 5xx are retried after 10 s, 30 s, 2 min, 10 min and 1 h,
  then every hour. A longer `Retry-After` is honored.
- Any other answer fails at once, including 3xx: redirects are not followed.
- An endpoint this server doesn't know (another pod may, during a rollout) is retried on the same
  schedule.
- No retry is scheduled past 24 hours after the first attempt (or after an administrator's retry):
  a delivery still failing then fails.

Each endpoint has its own delivery, so a failing endpoint never delays or repeats another. The
status and the first 500 characters of the answer are kept; failures are logged with the endpoint's
name and status.

### Administration

Administrators only (`403` for everyone else):

| Route | What it does |
| --- | --- |
| `GET /api/admin/outbox?status=failed\|pending\|delivered&limit=100` | Deliveries, newest message first, with attempts, the last status and error. Endpoints appear by name only. `limit` is 1 to 500. |
| `POST /api/admin/outbox/:id/retry` | Send a message again: its failed deliveries go back to pending, due now, with a fresh 24-hour schedule. `404` when it has none failed. |

### Helm

```yaml
webhooks:
  endpoints:
    - name: ops
      url: https://hooks.example.com/modus
      secretEnv: OPS_HOOK_SECRET
      kinds: [notify]
  existingSecret: modus-webhooks   # a Secret with a key OPS_HOOK_SECRET
  allowHttp: false
  keepDays: 7
  keepFailedDays: 30
```

```bash
kubectl create secret generic modus-webhooks --from-literal=OPS_HOOK_SECRET="$(openssl rand -hex 32)"
```

The chart writes the list to `webhooks.json` in its own `<release>-modus-webhooks` ConfigMap,
mounts it at `/etc/modus/webhooks.json` and sets `WEBHOOKS_FILE`. It refuses an inline `secret`,
keys other than `name`, `url`, `secretEnv`, `apps` and `kinds`, and `secretEnv` without
`existingSecret`. Every key of `existingSecret` becomes an environment variable, so `secretEnv`
names resolve; it may instead hold `WEBHOOK_URL` and `WEBHOOK_SECRET` for a single endpoint.
Changing the list or the settings rolls the pods (checksum annotations). The checksums don't
cover Secrets: after rotating a webhook secret, restart the pods
(`kubectl -n modus rollout restart deploy/modus-all`). With an empty list and no Secret, nothing
is rendered.

### Known limits

- A slow endpoint holds a sending round for up to 10 seconds (the timeout); other deliveries
  claimed in that round wait for it.
- The outbox list isn't scoped per application: it shows every application's deliveries, because
  roles are organization-wide.
- Each server routes messages with its own endpoint list. During a rollout that adds an endpoint,
  messages that old pods fan out are not sent to the new endpoint.

## Configuration reference

Every setting is an environment variable, read and checked once at startup by
`apps/server/src/config.ts`. An empty value counts as unset. Invalid values stop the server with
a message that names the variable.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | Port the HTTP server listens on. |
| `HOST` | `127.0.0.1` (image: `0.0.0.0`) | Interface to bind. |
| `DATA_DIR` | unset (image: `/data`) | Where the in-memory store writes its snapshots: `design.json`, `state-<app>.json`, `meta-<app>.json`, `events.jsonl`. Unset: nothing is written and a restart starts from the sample design. Ignored, with a warning, for `postgres`. |
| `TIME_SCALE` | `1` | Simulated minutes per real minute for timers, due dates and escalations. Demos may run faster. |
| `STATIC_DIR` | unset (image: `/app/public`) | A built studio to serve at `/`, with single-page-app fallback. `/api/*` stays the API. Unset: API only. The directory must contain `index.html`. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `ANTHROPIC_API_KEY` | unset | Turns on the language-model assistant. Secret: never logged. |
| `MODUS_ASSISTANT_MODEL` | `claude-opus-5-5` | The Claude model the assistant uses. |
| `MODUS_ASSISTANT_EFFORT` | `medium` | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max`, or `off` for models without the setting. |
| `MODUS_ASSISTANT_FALLBACKS` | `default` | `default` lets the API retry a declined question on its recommended fallback model; `off` for models or platforms without server-side fallback. |
| `DB_DIALECT` | `memory` (Compose: `postgres`) | Storage: `memory` or `postgres`. `mssql` and `oracle` are validated (with `DATABASE_URL`) and then refused with a clear message until their adapters ship. |
| `DATABASE_URL` | unset | Connection string, required for a SQL dialect: `postgres://` or `postgresql://` (`mssql://` or `sqlserver://`, `oracle://` later). Secret: the startup log shows only host, port and database. Ignored, with a warning, for `memory`. |
| `DB_POOL_MAX` | `10` | Most database connections each process keeps in its pool, 1 to 200 (`postgres`). Each process also holds one more to listen for other replicas' changes. Ignored, with a warning, for `memory`. |
| `WEBHOOK_URL` | unset | One webhook endpoint (`default`) for every outbox message; needs `WEBHOOK_SECRET`. See [Webhooks](#webhooks). |
| `WEBHOOK_SECRET` | unset | Signs requests to `WEBHOOK_URL`, at least 16 characters. Secret: never logged. |
| `WEBHOOKS_FILE` | unset (Helm: `/etc/modus/webhooks.json` when endpoints are listed) | A JSON file of webhook endpoints with filters. |
| `WEBHOOKS_ALLOW_HTTP` | `false` | `true` allows `http://` webhook URLs. |
| `WEBHOOKS_KEEP_DAYS` | `7` | Days to keep outbox messages that went out, 1 to 365. |
| `WEBHOOKS_KEEP_FAILED_DAYS` | `30` | Days to keep outbox messages with a failed delivery, 1 to 365. |
| `TENANT_MODE` | `single` | `multi` is planned; accepted with a warning, runs as one tenant. |
| `MODUS_ROLES` | all six | Comma-separated roles this process plays (`api,engine,automation,scheduler,ingest,realtime`). Unknown roles stop the server; a subset is accepted with a warning and every role still runs. |
| `NODE_ENV` | image: `production` | Standard Node.js setting. |
| `NODE_OPTIONS` | image: `--enable-source-maps` | Stack traces point at the TypeScript sources. |

The example worker (`apps/server/examples/worker.ts`) reads `MODUS_URL` (default
`http://127.0.0.1:8787`) and `SERVICE` (the service id whose jobs it polls).

## Health and readiness

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /api/health` | The process is up and serving: `{ ok: true, apps }`. | Liveness probe, Docker `HEALTHCHECK`, load-balancer checks |
| `GET /api/ready` | The design and state are loaded, storage answers (for Postgres, a `select 1`), the server is receiving other replicas' changes, and it is not shutting down: `200 { ok: true, apps, storage }`, or `503` while stopping, while the database is unreachable, or while the listening connection is down. | Readiness probe |

On `SIGTERM` the server stops accepting connections (new requests get `503`), ends open live
streams, finishes in-flight commands, gives up its clocks and closes its database connections,
then exits; this takes well under a second, inside the default 30-second grace period. Every
commit is already stored, so there is nothing to write on the way out. The
image's `HEALTHCHECK` calls `/api/health` every 30 seconds.

If Postgres goes away while the server runs, readiness turns `503` (the reason goes to the log,
not the response) and changes are refused with `503` and `Retry-After`. A command either commits
everything (state, audit entries, projections, outbox) or nothing, so a refused command changed
nothing and can be retried. Reads keep working from memory. At startup the server exits with a
message if it cannot reach the database or apply its migrations (Compose and Kubernetes restart
it).

## Backups and upgrades

**PostgreSQL:** back up the database with your usual tooling: `pg_dump` for a logical copy, or
base backups with WAL archiving (pgBackRest, Barman, a managed service's point-in-time
recovery). With Compose:

```bash
docker compose exec -T postgres pg_dump -U modus -Fc modus > modus-$(date +%F).dump
docker compose exec -T postgres pg_restore -U modus -d modus --clean < modus-2026-10-06.dump   # restore
```

Each command commits the state, its events, the projections and the outbox in one transaction,
so a dump of a running database is consistent.

**In memory:** back up the `/data` volume, which holds `design.json` (applications, workflows,
people), `state-<app>.json` (every live item, work item and counter) and `events.jsonl` (the
append-only audit trail), plus `meta-<app>.json` (the state's version and clock time). Each
change rewrites the application's state and meta files, each through a temporary file and an
atomic rename, then appends its events, so copying a running volume never yields half a
snapshot, but the files can be a change apart. For an exact point in time, stop the container
first or take a volume snapshot.

```bash
# Compose: archive the volume
docker run --rm -v modus_modus-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/modus-$(date +%F).tgz -C /data .

# Kubernetes: a CSI VolumeSnapshot of the modus-data claim, or copy the files out
POD=$(kubectl -n modus get pods -l app.kubernetes.io/instance=modus -o jsonpath='{.items[0].metadata.name}')
kubectl -n modus cp "$POD":/data ./modus-backup
```

**Restore** by putting the files back into an empty volume and starting Modus.

**Upgrades:** pull the new tag and restart (`docker compose pull && docker compose up -d`, or
`helm upgrade modus deploy/helm/modus --reuse-values --set image.tag=…`). Back up first. While
Modus is a prototype the snapshot format follows the engine's state shape and is not versioned
or migrated: an upgrade can require starting with fresh state. The stored `design.json` always
wins over the sample design built into the image; delete it to pick up a new sample. With
PostgreSQL, the server applies pending schema migrations at startup (recorded in the
`kysely_migration` table); the state inside the JSONB rows follows the same caveat as the
snapshots. A Helm pre-upgrade migration job is planned, and SQL Server and Oracle installs will
get migration scripts DBAs can review and run.

**Upgrading Helm from a release before M2** (before one transaction per command): the old pods
don't know about versions, other replicas or the clock lock. During a rolling update an old pod
would keep writing its whole state every few seconds, tick its own clock and number its own log
entries, so changes would be lost, timers would fire twice and log writes would fail. Stop the
old pods first, once:

```bash
helm upgrade modus deploy/helm/modus -n modus --reuse-values --set image.tag=… \
  --set deployments.all.strategy=Recreate
# afterwards, roll again as usual:
helm upgrade modus deploy/helm/modus -n modus --reuse-values --set deployments.all.strategy=
```

(Scaling to zero first, `kubectl -n modus scale deploy/modus-all --replicas=0`, works too.)
Compose is unaffected: `docker compose up -d` stops the old container before starting the new
one. Going back to a release before M2 means restoring a backup: once migration `0002` has run,
the older server refuses to start because it doesn't know that migration.

From now on pods roll while one of them migrates, so the release before a migration keeps
running against the new schema for a moment. Every migration must work with the previous
release.

**Upgrading to the release with webhooks** (migration `0003`): messages written before it were
never sent, and the migration marks them sent, so the first sender doesn't post that backlog as
new. Only messages committed after the upgrade go to your endpoints.

## The assistant and your data

With `ANTHROPIC_API_KEY` set, `POST /api/apps/:app/assistant` answers with Claude. Each request
sends Anthropic:

- a fixed system prompt and tool list (the same for everyone, cached);
- the question and the recent conversation the client sent;
- a short context block: the application's name and description, the item types with the field
  labels **this person** may see, the workflows' step labels, and the person's name, title and
  groups;
- the results of the tools the model calls: search hits, one item, the person's own work, the
  process overview, help text. Every tool runs as the person asking, so fields hidden from them
  never reach the model.

The tools only read; the model can't change anything. Each answer may take up to six rounds of
tool calls. If the key is missing, rejected, rate-limited or unreachable, or the model declines,
the built-in interpreter answers instead and the response says why (`source: 'built-in'`, with a
`notice`). Leave the key unset where nothing may leave the network.
