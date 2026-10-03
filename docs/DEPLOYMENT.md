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
| Storage | **In memory**, snapshotted to JSON files in `DATA_DIR` (design, live state, event log). One process holds all state. | PostgreSQL (M2), SQL Server (M6), Oracle (v1.1) behind the same storage ports |
| Scale | One pod. Scale up (CPU and memory), not out. | Roles split across deployments, horizontal scaling, autoscaling |
| Identity | The `x-user-id` header: whoever calls the API says who they are | OIDC sign-in (Keycloak, Entra ID, Login.gov), SCIM group sync |
| Tenancy | One organization per installation | Tenant id in every key; Postgres row-level security for hosted; a database per tenant for regulated customers |
| Observability | JSON logs on stdout, live counts per step (`/overview`), OCEL 2.0 export | OpenTelemetry traces, Prometheus metrics |
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

With Docker:

```bash
docker compose up --build                     # http://localhost:8787
ANTHROPIC_API_KEY=… docker compose up -d      # with the language-model assistant
docker compose down                           # stop; the modus-data volume keeps the state
```

`docker-compose.yml` also defines three optional profiles for the infrastructure on the roadmap:
`postgres` (PostgreSQL 18), `nats` (NATS JetStream with an MQTT listener, for event ingest) and
`keycloak` (OIDC). **Modus does not use any of them yet**; they exist so the pieces can be tried
side by side. They never start unless named: `docker compose --profile nats up -d`.

Or run the image directly:

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
4. `restart: unless-stopped` brings Modus back after a reboot. Back up the `modus-data` volume
   (see [Backups](#backups-and-upgrades)).

Sizing: an idle server uses about 50 MB of memory. Memory grows with the number of live items,
since everything is held in memory today; 1 GB is plenty for pilots.

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
non-secret settings, a PersistentVolumeClaim for `/data` (kept on uninstall), a ServiceAccount
without an API token, and optionally an Ingress, a HorizontalPodAutoscaler and a
PodDisruptionBudget. Pods run as user 1000 with a read-only root filesystem, no capabilities
and the runtime-default seccomp profile.

**The chart refuses what the server can't do yet.** While `database.dialect` is `memory`, it
fails to render with more than one replica, more than one deployment, or autoscaling, because
each pod would hold its own copy of the state. The Deployment uses the `Recreate` strategy, so
an upgrade has a short gap while the old pod stops and the new one loads.

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
accepted and logged), so you scale by giving the one pod more CPU and memory. Once the SQL store
lands, the same image runs as separate deployments, each scaled on its own signal:

| Role | Does | Scales on |
| --- | --- | --- |
| `api` | REST edge, search, the assistant, the studio's files | requests per second, CPU |
| `engine` | Commands against the process engine (per-item locks in SQL) | command latency |
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
| `database.existingSecret` | `database.urlKey` (default `DATABASE_URL`) | SQL storage (planned) |

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

## Configuration reference

Every setting is an environment variable, read and checked once at startup by
`apps/server/src/config.ts`. An empty value counts as unset. Invalid values stop the server with
a message that names the variable.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | Port the HTTP server listens on. |
| `HOST` | `127.0.0.1` (image: `0.0.0.0`) | Interface to bind. |
| `DATA_DIR` | unset (image: `/data`) | Where the in-memory store writes its snapshots: `design.json`, `state-<app>.json`, `events.jsonl`. Unset: nothing is written and a restart starts from the sample design. |
| `TIME_SCALE` | `1` | Simulated minutes per real minute for timers, due dates and escalations. Demos may run faster. |
| `STATIC_DIR` | unset (image: `/app/public`) | A built studio to serve at `/`, with single-page-app fallback. `/api/*` stays the API. Unset: API only. The directory must contain `index.html`. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `ANTHROPIC_API_KEY` | unset | Turns on the language-model assistant. Secret: never logged. |
| `MODUS_ASSISTANT_MODEL` | `claude-opus-5-5` | The Claude model the assistant uses. |
| `MODUS_ASSISTANT_EFFORT` | `medium` | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max`, or `off` for models without the setting. |
| `MODUS_ASSISTANT_FALLBACKS` | `default` | `default` lets the API retry a declined question on its recommended fallback model; `off` for models or platforms without server-side fallback. |
| `DB_DIALECT` | `memory` | Storage. Only `memory` is implemented. `postgres`, `mssql` and `oracle` are validated (with `DATABASE_URL`) and then refused with a clear message until their adapters ship. |
| `DATABASE_URL` | unset | Connection string for a SQL dialect (`postgres://`, `mssql://` or `sqlserver://`, `oracle://`). Secret. Ignored, with a warning, for `memory`. |
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
| `GET /api/ready` | The design and state are loaded and the server is not shutting down: `200 { ok: true, apps, storage }`, or `503` while stopping. | Readiness probe |

On `SIGTERM` the server stops accepting connections (new requests get `503`), ends open live
streams, finishes in-flight commands, writes a final snapshot and exits; this takes well under
a second, inside the default 30-second grace period. The image's `HEALTHCHECK` calls
`/api/health` every 30 seconds.

## Backups and upgrades

**What to back up:** the `/data` volume, which holds `design.json` (applications, workflows,
people), `state-<app>.json` (every live item, work item and counter) and `events.jsonl` (the
append-only audit trail). Snapshots are rewritten every five seconds when something changed and
on shutdown, each through a temporary file and an atomic rename, so copying a running volume
never yields half a file; the three files can be a few seconds apart. For an exact point in
time, stop the container first or take a volume snapshot.

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
PostgreSQL, schema migrations will run as a Helm pre-upgrade job, and SQL Server and Oracle
installs will get migration scripts DBAs can review and run.

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
