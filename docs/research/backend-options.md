# Modus: backend architecture research

Facts as of 2026-10-01. Versions and license claims were checked against GitHub, npm and vendor docs on that date and are linked inline. The prototype being discussed is the engine in `packages/core/src/engine/` (pure TypeScript, a seeded RNG in `rng.ts`, conditions in `model/conditions.ts`). When this research was done it was a single ~1,000-line `engine.ts`; since then it has gained tokens, parallel split/join, subflows, a service registry and workspace operations (see [ARCHITECTURE.md](../ARCHITECTURE.md)).

## Bottom line

- **Build the engine ourselves in TypeScript.** Extract a deterministic kernel from the prototype and run that same kernel inside the browser simulator and inside the production server. None of the embeddable engines is open source, human-task-centric and certified on Postgres, SQL Server and Oracle all at once. Flowable comes closest, but it is a Java sidecar whose semantics we would have to bend.
- **Persist per-case events plus projections that are updated in the same transaction.** Business objects are stored as a JSON document, and an admin-flagged "promoted field" index table covers search. That design is portable to all three databases.
- **Postgres first. Use Kysely behind a storage-port interface.** A SQL Server adapter is certified in v1.x. An Oracle adapter comes after that. All adapters must pass one shared contract test suite.
- **Use the transactional outbox for every side effect** (REST, MCP, email, webhooks). Timers and job claiming live in database tables and use the SKIP LOCKED family of locks. pg-boss, Graphile Worker and DBOS are all Postgres-only, so we avoid them.
- **Run a modular monolith shipped as one OCI image** with role flags. Fastify plus OpenAPI on the edge, NATS JetStream for high-volume signals, the official MCP TypeScript client v2, OpenTelemetry throughout, Keycloak/OIDC/SCIM for identity.

---

## 1. Engine approach options

### 1.1 What the engine has to do

The workload has two shapes:

1. **Classic BPM.** Thousands of cases per day, admin-defined object types, human steps with four distribution modes, SLAs, field-level security per step, and workflows edited by business admins while older versions are still running.
2. **Signal triage.** Thousands of camera events per minute (around 50 to 100 events/s sustained) get an AI triage, and only a fraction become officer work.

The engine therefore needs to be human-task-heavy, data-centric (decisions read object metadata), versioned at runtime, and cheap per event. Most durable-execution engines are built for the opposite profile: code-defined workflows written by engineers, with few human steps.

### 1.2 Options compared

| Option | License (Oct 2026) | Runtime | Persistence | Human-task BPM fit | SQL Server / Oracle | Verdict |
|---|---|---|---|---|---|---|
| **(a) Own TS engine** (prototype kernel) | Ours (Apache-2.0 suggested) | Node/TS, same code in browser | Whatever we choose (Postgres first) | Exactly our semantics: the four distribution modes, decisions on metadata, field security | Through our adapters | **Recommended** |
| **Camunda 8 / Zeebe** 8.10 | Source code under Camunda License 1.0. Compiled binaries are proprietary, and **production needs a paid Enterprise license since 8.6 (Oct 2024)** ([Camunda licenses](https://docs.camunda.io/docs/reference/licenses/), [announcement](https://camunda.com/blog/2024/10/camunda-licensing-what-you-need-to-know/)) | Java | Zeebe's own log/RocksDB. Secondary storage is ES/OpenSearch or RDBMS (Postgres, Oracle, SQL Server, MySQL, MariaDB), but Optimize still needs ES/OS ([secondary storage](https://docs.camunda.io/docs/self-managed/concepts/secondary-storage/), [RDBMS](https://docs.camunda.io/docs/next/self-managed/concepts/databases/relational-db/)) | Excellent (BPMN user tasks, Tasklist) | Yes for secondary storage | **Disqualified.** It cannot sit inside an OSS product that customers run in production for free |
| **Camunda 7 CE** and its forks | Camunda 7 CE reached **EOL in Oct 2025** with final release 7.24 ([forum](https://forum.camunda.io/t/important-update-camunda-7-community-edition-end-of-life-announced/50921)). The [Operaton](https://github.com/operaton/operaton) fork is Apache-2.0 and active (2.2.0-SNAPSHOT) | Java | RDBMS (Oracle, SQL Server, Postgres…) | Good, with mature external-task pattern | Yes | Worth watching, but you would be betting on a young fork's governance |
| **Flowable** 8.0.0 (Feb 2026) | Apache-2.0 ([releases](https://github.com/flowable/flowable-engine/releases)) | Java, Spring Boot 4 / Spring 7 ([8.0 notes](https://forum.flowable.org/t/flowable-8-0-0-release/12548)) | RDBMS. Tested on Oracle, SQL Server, Postgres, MySQL, MariaDB and DB2 ([config docs](https://www.flowable.com/open-source/docs/bpmn/ch03-Configuration)) | Strong: BPMN, CMMN and DMN; user tasks with candidate groups | **Yes, natively** | Best "embed" choice, but you get a JVM sidecar, a second model and no simulation reuse |
| **Temporal** server 1.30.7, TS SDK 1.24.0 | MIT ([server](https://github.com/temporalio/temporal), [TS SDK](https://github.com/temporalio/sdk-typescript)) | Go server, TS workers | Cassandra, MySQL 8, Postgres 12+, SQLite for dev ([persistence](https://docs.temporal.io/temporal-service/persistence)). **No SQL Server or Oracle** ([thread](https://community.temporal.io/t/is-there-oracle-db-support-in-temporal-server/6850)) | Weak. Human steps are signals/updates and there is no worklist. Admin-defined models need an interpreter workflow plus Continue-As-New for long cases | No | Excellent at durable code. Wrong shape for this product |
| **Restate** 1.7.13 | **BSL 1.1**: no "Public Restate Platform Service"; converts to Apache-2.0 four years after each release. SDKs are MIT ([LICENSE](https://github.com/restatedev/restate)) | Rust single binary | Its own embedded log and RocksDB | Weak, code-first | Not applicable: state lives outside the customer's DB | Not OSI open source, and state stays opaque to DBAs |
| **DBOS Transact** TS 5.2 | MIT ([repo](https://github.com/dbos-inc/dbos-transact-ts)) | In-process TS library, no server | Postgres or Postgres-compatible (CockroachDB); SQLite for dev | Medium. Durable steps, queues and notifications, but no worklist concept | **No** (system DB is Postgres or SQLite) | Closest in spirit to option (a), but it locks us to Postgres |
| **Inngest** 1.45 | Server is **SSPL** with delayed publication as Apache-2.0. SDKs are Apache-2.0 ([LICENSE](https://github.com/inngest/inngest)) | Go server | SQLite or Postgres, plus Redis ([self-hosting](https://www.inngest.com/docs/self-hosting)) | Weak, event-driven functions | No | SSPL makes it a non-starter as an embedded dependency |
| **Trigger.dev** v4.7.0 | Apache-2.0 ([repo](https://github.com/triggerdotdev/trigger.dev)) | TS tasks running in containers | Postgres, Redis, ClickHouse, registry and object storage ([self-host](https://trigger.dev/docs/self-hosting/docker)) | Weak; it is a background-job platform | No | Too heavy to embed, and the wrong abstraction |
| **Hatchet** | MIT ([repo](https://github.com/hatchet-dev/hatchet)); TS SDK 1.33 | Go server | Postgres | Weak; DAG task orchestration | No | Could serve as an automation runtime, but it adds a Go service and stays Postgres-only |
| **pg-boss** 12.35 / **Graphile Worker** 0.18 | MIT ([pg-boss](https://github.com/timgit/pg-boss), [Graphile](https://worker.graphile.org/releases)) | Node library | Postgres only (pg-boss needs PG 13+ and Node 22.12+) | Not an engine; queues only | No | Fine on Postgres. Their designs are worth copying, but we should not depend on them |

### 1.3 Why option (a) wins, and what it costs

- **Licensing and openness.** The only fully OSS, multi-database, human-task engine is Flowable. Using it means a Java runtime next to a TS product, BPMN/CMMN semantics we would need to extend for load-balanced, supervisor-distributed and queue-fetch distribution, and process variables that fit poorly with 50-field business objects carrying per-step field security.
- **"The simulator IS the engine."** If the engine is someone else's, the simulator becomes a second implementation that drifts from it. If the engine is our kernel, then a simulated run *is* a prediction of production behavior, and production history can be replayed through it. That is the product's differentiator.
- **Cost.** We take on correctness of joins, timers, concurrency and versioning. We mitigate that by keeping semantics deliberately narrower than full BPMN 2.0, by using the simulator as a fuzzer (pushing millions of random cases through the kernel to find stuck tokens and orphaned joins), by golden replay tests, and by offering BPMN 2.0 XML export through [bpmn-moddle](https://www.npmjs.com/package/bpmn-moddle) for interoperability.

### 1.4 What the kernel extraction looks like

Today `advance(sim, ctx, minutes)` loops in one-minute ticks over `arrivals → finishAutomated → finishWork → retryStuck → supervise → pullWork`. It mutates a single whole-world `SimState` and mixes in synthetic concerns: Poisson arrivals, synthetic user work time, and random data from `generate.ts`. The split:

| Layer | Contents | Runs in |
|---|---|---|
| **Kernel** (pure) | `decide(caseState, command, ctx, clock) → Event[]` and `evolve(caseState, event) → caseState`. Covers routing, decisions (`evaluateCondition`), split/join, allocation policy, SLA computation and field-permission checks. No I/O, and `Date.now()`/`Math.random()` are banned (lint rule). | Browser and server |
| **Ports** | `Clock`, `Rng`, `CaseStore`, `WorkStore`, `ObjectStore`, `Outbox`, `TimerStore`, `Directory` (users, groups, load) | Interfaces |
| **SimDriver** | Virtual clock that jumps from one event time to the next, synthetic arrivals and users, in-memory stores, connectors stubbed with latency and failure distributions | Browser (Studio "Simulate") and server (what-if jobs) |
| **RuntimeDriver** | Wall clock, database stores, outbox dispatch, real users through the API | Server |

Commands map one-to-one to the prototype's admin functions and a few more: `CreateCase`, `FetchWork`, `Assign`, `ReturnToPool`, `Release(outcome, patch)`, `Move`, `UpdateData`, `TimerFired`, `AutomationCompleted/Failed`, `SignalReceived`. The existing `AuditKind` list (`entered`, `decision`, `assigned`, `fetched`, `released`, `stuck`, …) is already most of the event catalog. Production is event-driven with no global tick; the simulator keeps discrete-event time.

---

## 2. Persistence for dynamic object types

### 2.1 Approaches

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| **EAV** | One row per (object, field, value), with typed value columns | Fully dynamic, portable, no DDL | Queries need N self-joins, reporting is painful, writes amplify, and type safety is weak. Most old BPM/ECM systems regret it ([EAV vs JSONB](https://coussej.github.io/2016/01/14/Replacing-EAV-with-JSONB-in-PostgreSQL/)) |
| **Per-type generated tables** (the classic BPM approach) | Saving a type issues `CREATE/ALTER TABLE obj_<type>` | Natural SQL and BI-friendly | Runtime DDL in production, locking and migrations per type per tenant, DBA change control (a big problem in government), and three DDL dialects |
| **JSON document column** | `data` holds the whole object; the type definition validates it | One table, no DDL, atomic object writes, maps 1:1 to the prototype's `data: Record<string, unknown>` | Indexing and reporting need extra work, and JSON features differ by database |
| **Hybrid** (recommended) | JSON document is the source of truth. Admin-flagged "searchable/reportable" fields go to an indexed projection. Optional per-type reporting views | Dynamic *and* queryable, portable | Projection has to be kept in sync (same transaction, so this is easy) |

### 2.2 JSON capabilities by database

| | PostgreSQL 16–18 | SQL Server | Oracle |
|---|---|---|---|
| Native type | `jsonb` | Native **`json` type: GA on Azure SQL in May 2025** ([blog](https://devblogs.microsoft.com/azure-sql/announcing-the-general-availability-ga-of-json-data-type-json-aggregates/)) and **in SQL Server 2025, GA Nov 18 2025** ([type docs](https://learn.microsoft.com/en-us/sql/t-sql/data-types/json-data-type), [GA](https://www.neowin.net/news/microsoft-announces-general-availability-of-sql-2025-fabric-databases-and-documentdb/)). Binary storage, UTF-8. SQL Server 2016–2022 store `nvarchar(max)` with an `ISJSON` check | Native `JSON` since 21c. **26ai replaced 23ai as the LTS release in Oct 2025** through a release update ([Oracle](https://www.oracle.com/news/announcement/ai-world-database-26ai-powers-the-ai-for-data-revolution-2025-10-14/)). 19c (extended support to 2032, [Register](https://www.theregister.com/2025/02/18/oracle_extends_19c_support/)) uses BLOB/CLOB with an `IS JSON` check |
| General index | GIN (`jsonb_path_ops` for containment) ([docs](https://www.postgresql.org/docs/current/datatype-json.html#JSON-INDEXING)) | `CREATE JSON INDEX` (2025/Azure). Limits: one per JSON column, needs a clustered PK, offline create/alter, no overlapping paths ([docs](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-json-index-transact-sql)) | JSON search index and multivalue index (23ai+) ([oracle-base](https://oracle-base.com/articles/23/json-support-in-oracle-database-23)) |
| Per-field index | Expression index on `(data->>'f')`, or a STORED generated column. PG 18's new **virtual** generated columns (now the default) **cannot be indexed** ([PG18](https://www.postgresql.org/about/news/postgresql-18-released-3142/), [detail](https://hashrocket.com/blog/posts/postgresql-18-virtual-generated-columns)) | Computed column on `JSON_VALUE(...)` plus a normal index. Works on every version since 2016 | Function-based index on `JSON_VALUE(... RETURNING ...)` |
| Extras | `uuidv7()` built in (PG 18) | JSON aggregates, `JSON_CONTAINS` | **JSON Relational Duality Views** give updatable JSON over relational tables ([oracle-base](https://oracle-base.com/articles/23c/json-relational-duality-views-23c), [Oracle](https://www.oracle.com/database/json-relational-duality/)) |

Duality Views and SQL Server JSON indexes are attractive, but each is single-vendor. Use them only as adapter-level optimizations, never as a design dependency.

### 2.3 Recommended portable schema (simplified)

```
object_type(id, tenant_id, key, version, schema_json, ...)        -- versioned type definitions
object(id uuidv7, tenant_id, type_id, type_version, number, title,
       status, data JSON, row_version, created_at/by, updated_at/by)
object_field_idx(tenant_id, type_id, field_id, object_id,
       v_text varchar(400), v_num decimal(38,10), v_date timestamp, v_ref varchar(64))
  -- composite indexes (tenant_id, type_id, field_id, v_*) ; maintained in the same tx
object_link(tenant_id, from_id, to_id, link_type)                   -- linked objects / subflows
list_def / list_item(id, list_id, parent_id, label, sort, active)   -- cascading lists (adjacency)
attachment(id, object_id, field_id, name, size, mime, sha256, storage_key)
```

- **Search and reporting.** `object_field_idx` uses EAV only as an index, never as storage. The DDL is identical on all three databases. Each adapter can later add native accelerators: a Postgres GIN or expression index, a SQL Server computed column or JSON index, an Oracle function-based index.
- **BI exports.** Generate per-type views (`v_obj_<type>` via `JSON_VALUE` / `->>`) so Power BI or Tableau users get tidy columns. These are generated views, not tables, so no data migrates.
- **Value encoding.** Currency is a decimal string plus an ISO currency code (JS numbers lose precision). Dates are ISO 8601 UTC. User and list values are stored as IDs and resolved for display. Choice values are list-item IDs, never labels. Every object stores its `type_version`, and type changes are events too.
- **Field-level security** is enforced in the API layer. On read, project `data` by the (step, role) permission map. On write, reject patches that touch non-editable fields. The audit view applies the same redaction, because audit events contain values. Database column grants cannot express "editable at step 3 only".
- **Attachments** go in an S3-compatible store, with a filesystem driver for small installs. Store hashes for integrity, and leave hooks for virus scanning.

---

## 3. Multi-database support in practice

### 3.1 TypeScript options (versions from npm and GitHub, Sep 2026)

| Library | Version | Postgres | SQL Server | Oracle | Notes |
|---|---|---|---|---|---|
| **Kysely** | 0.29.6 (MIT) | Core | **Core `MssqlDialect`** | Community [`kysely-oracledb`](https://github.com/griffiths-waite/kysely-oracledb) 3.1.2 (MIT, small project) | Typed SQL builder rather than an ORM, so it suits dynamic JSON plus raw dialect fragments ([dialects](https://kysely.dev/docs/dialects)) |
| **Drizzle** | stable 0.45.3; v1 at **1.0.0-rc.4** (Jun 2026) | Yes | **Only in the v1 beta/RC line** (added in 1.0.0-beta.2) ([notes](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v1beta2)) | No | Schema-as-code fits poorly with runtime-defined types |
| **Prisma** | 7.x GA (Nov 2025); **8.0 in RC** | Yes | 7.x via `@prisma/adapter-mssql`. In Prisma 8 it is "coming soon" ([supported DBs](https://www.prisma.io/docs/orm/reference/supported-databases)) | **No**; open request since 2020 ([#2853](https://github.com/prisma/prisma/issues/2853)) | Static schema; the wrong tool for dynamic types |
| **TypeORM** | 1.1.1 (1.0 shipped May 2026) | Yes | Yes | Yes | Broadest coverage. Decorator entities and a history of maintenance gaps ([repo](https://github.com/typeorm/typeorm)) |
| **MikroORM** | 7.2.3 (7.0 in Mar 2026) | Yes | Yes | **Yes: `@mikro-orm/oracledb` is new in v7** ([repo](https://github.com/mikro-orm/mikro-orm)) | Well maintained. Unit-of-work ORM; heavier than we need |
| **Knex** | 3.3.0 (Jun 2026) | Yes | Yes | Yes | Mature but untyped and slow-moving ([repo](https://github.com/knex/knex)) |
| Drivers | `pg` 8.23, `mssql` 12.7 / `tedious` 20.3, `oracledb` 7.0.1 | | | | node-oracledb's default Thin mode needs no Instant Client, which matters for containers and air-gapped sites ([repo](https://github.com/oracle/node-oracledb)) |

### 3.2 Other ecosystems, for honesty

- **.NET** has the strongest first-party story. EF Core 10 runs with Npgsql 10.0.3 ([repo](https://github.com/npgsql/efcore.pg)), Microsoft's SQL Server provider, and **Oracle's official EF Core 10 provider** (free on NuGet, Oracle 19c+) ([announcement](https://medium.com/@alex.keh/announcing-oracle-entity-framework-core-10-595fd4d1e984)). If Oracle and SQL Server parity were the top requirement, .NET would be the safest backend language.
- **Java.** Hibernate ORM 7 is now Apache-2.0 ([relicense](https://in.relation.to/2025/03/14/orm-asl/)) and supports every relevant database. jOOQ's free edition covers only open-source databases; **Oracle and SQL Server need a paid jOOQ license** ([editions](https://www.jooq.org/download/)).
- **Why we still choose TypeScript.** It keeps one language from the browser simulator to the server kernel. That is the core product thesis, and it outweighs Oracle being the weakest spot in the TS ecosystem.

### 3.3 Where the real portability cost is

The query builder is the easy part. These are the costs that surface in production:

- **Upserts.** `ON CONFLICT` vs `MERGE`, and SQL Server `MERGE` has known concurrency pitfalls.
- **Queue claims.** Postgres uses `FOR UPDATE SKIP LOCKED`. SQL Server uses `WITH (UPDLOCK, READPAST, ROWLOCK)` plus `OUTPUT`. Oracle uses `FOR UPDATE SKIP LOCKED` but needs a cursor fetch, because row-limiting clauses do not combine with `FOR UPDATE`.
- **Oracle quirks.** `''` is treated as NULL, IN lists are limited to 1,000 items, identifiers are upper-cased, and BOOLEAN exists only from 23ai.
- **SQL Server quirks.** A 2,100-parameter limit, and the default locking `READ COMMITTED`. Require `READ_COMMITTED_SNAPSHOT ON`.
- **Type mapping.** Timestamps and time zones, `text` vs `nvarchar(max)` vs `CLOB`, identity vs sequence, and JSON functions.
- **Listen/notify.** Postgres has `LISTEN/NOTIFY`; the others need polling or the message bus.

### 3.4 Recommendation

Postgres first, behind a **storage port** made of repository interfaces (`CaseStore`, `EventStore`, `WorkStore`, `ObjectStore`, `TimerStore`, `Outbox`, `JobClaim`). Kysely is the SQL layer for every adapter. One **contract test suite** runs in CI against containers: Postgres 16/17/18, SQL Server 2022 and 2025 (Linux images), and Oracle Database Free 23ai/26ai. Advertise **certified versions**, never "any database". Ship SQL Server as a certified adapter in v1.x and Oracle after it, either vendoring/forking `kysely-oracledb` or contributing to it. SQL Server 2022 uses `nvarchar(max)` plus computed columns; 2025 can use the native `json` type.

---

## 4. Event sourcing, audit, outbox and process mining

### 4.1 Model: event-first, with projections updated in the same transaction

| | State tables + audit table | Pure event sourcing | **Recommended hybrid** |
|---|---|---|---|
| Write | Update state, then insert an audit row | Append events only; projections are async | Append events **and** update projections in **one transaction** |
| Worklist consistency | Immediate | Eventually consistent (bad for "fetch next item") | Immediate |
| Replay / simulation | Lossy | Full | Full |
| Rebuild projections | No | Yes | Yes |

```
case_event(tenant_id, case_id, seq, event_id uuidv7, type, at, actor, node_id,
           payload JSON, model_version, engine_version, causation_id, correlation_id,
           prev_hash)            -- UNIQUE(case_id, seq); prev_hash gives a tamper-evident chain
case(id, tenant_id, workflow_id, workflow_version, object_id, status, version, tokens JSON, ...)
work_item(id, case_id, node_id, state, assignee_id, group_id, priority, due_at, ...)
outbox(id, case_id, kind, payload, idempotency_key, status, attempts, next_attempt_at, trace_ctx)
timer(id, case_id, due_at, kind, payload, status)
```

- **Concurrency.** Each command locks its case row (`SELECT … FOR UPDATE`, or `UPDLOCK` on SQL Server), runs `decide`, appends events with consecutive `seq`, and updates projections. Transactions are short, cases are serialized, and `UNIQUE(case_id, seq)` is the backstop. This is what makes parallel joins safe (see 5.3b).
- **Snapshots.** Cases with long histories get a snapshot every N events, so replay stays cheap.
- **Audit.** The event log *is* the audit trail: who, what, when, from which step, old and new values. The per-case hash chain gives tamper evidence for records-retention reviews, and retention or legal-hold policies apply per object type.

### 4.2 Outbox for automated steps

Every side effect (REST call, MCP tool call, email, outbound webhook, worker job) is written to `outbox` in the same transaction as the event that caused it ([pattern](https://microservices.io/patterns/data/transactional-outbox.html)).

A dispatcher claims rows with SKIP LOCKED/READPAST, executes them with an idempotency key, and feeds the result back as a *command* (`AutomationCompleted`/`Failed`). That command produces new events. Retries with backoff end in a `stuck` state, which the prototype already models as the `stuck` token state and `retryStuck`, and the Monitor surfaces it as an incident. Customers who want Kafka can tail the outbox with CDC (Debezium supports all three databases), so the product needs no Kafka dependency.

### 4.3 Process mining exports

- **OCEL 2.0** is the right primary format because Modus is object-centric: business objects, linked objects, subflows, work items and users. The spec was released in 2023, with SQLite, XML and JSON exchange formats ([ocel-standard.org](https://www.ocel-standard.org/), [spec](https://arxiv.org/abs/2403.01975)). Mapping: each `case_event` becomes an OCEL event whose activity is the step plus the event type. Object references (case object, work item, user, linked objects) are qualified by role. `FieldsUpdated` events become OCEL object attribute changes.
- **XES, IEEE 1849-2023** (published Aug 2023, superseding 1849-2016) is for classic case-centric tools ([xes-standard.org](https://xes-standard.org/), [IEEE](https://standards.ieee.org/ieee/1849/10907/)). Mapping: trace = case; `concept:name` = step; `lifecycle:transition` = assign/start/complete; `org:resource` = user; `time:timestamp`.
- **Simulation from the log.** Three uses:
  1. *Deterministic replay* of a case through the kernel, for debugging and for engine-upgrade regression tests.
  2. *Calibration*: derive arrival rates, service-time distributions, routing probabilities and per-user capacity from events and feed them into the SimDriver.
  3. *What-if from now*: snapshot the live state, change staffing or rules, and run forward on a virtual clock. Because kernel code is shared, the forecast uses production semantics.

---

## 5. Runtime services and call stack

### 5.1 Decomposition

Start as a **modular monolith**: one codebase and one image, with roles enabled by environment flags (`ROLES=api,engine,automation,scheduler,ingest,realtime`). Small installs run every role in one process. Kubernetes runs each role as its own Deployment. Module boundaries follow the services below, so a later split costs little.

```
 Browser SPA (React/Vite: Studio · Workspace/workbasket · Monitor · Simulate[kernel in-browser])
        │ HTTPS (OIDC bearer)          ▲ SSE / WebSocket (counts, my-work updates)
        ▼                              │
 ┌───────────── API edge: Fastify 5 + Zod 4 → OpenAPI 3.1, authn/authz, field-security filter ─────────────┐
 │  Process svc (kernel + RuntimeDriver) ── Work svc (worklists, allocation, delegation, SLA)             │
 │  Object svc (types, objects, lists, attachments, search)   Identity svc (OIDC/SAML, SCIM, groups)     │
 └──────────────┬────────────────────────────────┬───────────────────────────────┬──────────────────────┘
                │ one DB transaction             │ claims (SKIP LOCKED)          │ publish
                ▼                                ▼                               ▼
          PostgreSQL (events, projections, outbox, timers) ◄─ Scheduler (timers/SLA) ── Realtime gateway
                ▲                                │                                    (NATS or LISTEN/NOTIFY)
                │ commands (results)             ▼
          Automation svc: REST/OpenAPI · MCP client · worker long-poll/gRPC · sandboxed mapping
                ▲
          Event ingest: webhooks · NATS JetStream · Kafka · MQTT  ──► signal triage ──► CreateCase (bulk)
          Analytics: OCEL/XES export · calibration · what-if simulation jobs (SimDriver)
```

### 5.2 Library choices (TypeScript)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS, moving to **26 LTS when it is promoted on 2026-10-28** ([schedule](https://github.com/nodejs/Release)) | |
| HTTP | **Fastify 5.12** (v6 is in alpha) ([repo](https://github.com/fastify/fastify)) with `@fastify/swagger`, `@fastify/websocket` | Mature plugins and the best fit for a long-running Node server. **Hono 4.13** ([repo](https://github.com/honojs/hono)) is the alternative if edge or multi-runtime deployment matters |
| API style | **REST + OpenAPI 3.1** generated from Zod 4 schemas | Government integrators use Java/.NET/Python and need generated clients. tRPC 11 is fine for an internal SPA-only layer, but it ties clients to TS. GraphQL is optional later, read-side only |
| SQL | Kysely 0.29 plus the drivers above | Section 3 |
| Jobs, timers, outbox | **Own tables + SKIP LOCKED claim/lease** (about 500 LOC) | pg-boss is excellent but Postgres-only; copy its design |
| Event ingest | **NATS JetStream** (Apache-2.0, CNCF; the 2025 relicensing dispute ended with NATS staying in CNCF under Apache-2.0) ([CNCF](https://www.cncf.io/blog/2025/05/01/protecting-nats-and-the-integrity-of-open-source-cncfs-commitment-to-the-community)), client `@nats-io/jetstream` 3.4 ([repo](https://github.com/nats-io/nats.js)) | Light, single binary, works air-gapped, and has a built-in MQTT listener for cameras and IoT ([NATS MQTT](https://docs.nats.io/running-a-nats-service/configuration/mqtt)) |
| Kafka (when the customer already runs it) | `@confluentinc/kafka-javascript` 1.10 (kafkajs is unmaintained since 2023) | Kafka 4.2 (Feb 2026) made share groups ("queues for Kafka") production-ready, which suits worker pools ([4.2](https://kafka.apache.org/blog/2026/02/17/apache-kafka-4.2.0-release-announcement/)) |
| Redis Streams | Avoid as a core dependency. If a cache is needed, use **Valkey** (BSD) | Redis 8 is AGPLv3/RSAL/SSPL ([Register](https://www.theregister.com/2025/05/01/redis_returns_to_open_source/)) |
| MQTT broker | NATS MQTT or Mosquitto | EMQX 5.9+ is BSL 1.1; clustering needs a license ([EMQX](https://www.emqx.com/en/blog/adopting-business-source-license-to-accelerate-mqtt-and-ai-innovation)) |
| MCP | **`@modelcontextprotocol/client` 2.2**, the v2 split packages implementing **spec 2026-07-28** ([SDK](https://github.com/modelcontextprotocol/typescript-sdk), [versioning](https://modelcontextprotocol.io/specification/versioning)) | v2 is the stable line. v1 `@modelcontextprotocol/sdk` 1.31 still gets fixes for at least 6 months. 2026-07-28 removed sessions (stateless core) and added the Tasks extension for long-running work ([post](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). MCP has been governed by the Linux Foundation's Agentic AI Foundation since Dec 2025 ([LF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)) |
| Registered workers | HTTP long-poll "fetch-and-lock" (like [Camunda 7 external tasks](https://docs.camunda.org/manual/latest/user-guide/process-engine/external-tasks/)), with gRPC streaming later (like [Zeebe job workers](https://docs.camunda.io/docs/components/concepts/job-workers/)) | Thin worker SDKs in TS, Python, .NET and Java, generated from OpenAPI |
| Scripts and mapping | Keep decisions declarative (the prototype's condition model). Use JSONata for data mapping. For user scripts, run QuickJS-in-WASM or an out-of-process sandbox | `isolated-vm` 7 is in **maintenance mode** ([repo](https://github.com/laverdet/isolated-vm)) |
| Identity | `openid-client` 6.8 ([repo](https://github.com/panva/openid-client)) and `@node-saml/node-saml` 5.1, or broker everything through **Keycloak** (Apache-2.0) | Login.gov supports OIDC with `private_key_jwt`/PKCE ([docs](https://developers.login.gov/oidc/)). Entra ID through OIDC. Group sync via a **SCIM 2.0** endpoint ([RFC 7644](https://datatracker.ietf.org/doc/html/rfc7644)) |
| Observability | OpenTelemetry JS SDK 2.x ([repo](https://github.com/open-telemetry/opentelemetry-js)), pino logs, Prometheus metrics | Trace context is stored on outbox rows, so a trace spans the user click → MCP call → routing |

### 5.3 Sequences

**(a) A user releases a work item**

1. The SPA sends `POST /work-items/{id}/release` with `{outcomeId, patch, comment, expectedVersion}` and a bearer token.
2. API: verify the JWT, then authorize (the caller holds the item, or is a delegate or supervisor). Apply the step's field policy to `patch`, rejecting non-editable fields and enforcing required ones. Validate against the object type's JSON Schema.
3. Process service: open a transaction and lock `case`. Load case state, using a snapshot plus the event tail if needed. Run `kernel.decide(Release)`, which produces `FieldsUpdated`, `WorkItemReleased`, `TokenMoved(edge)`, `NodeEntered(next)` and possibly `DecisionEvaluated → TokenMoved`. When the token reaches a user step, it also produces `WorkItemCreated` plus an allocation event:
   - load-balanced: `Assigned(user)`, using current open-load counts;
   - queue-fetch: left unassigned;
   - supervisor-distributed: `AwaitingSupervisor`;
   - direct: `Assigned`.
4. In the same transaction: insert `case_event` rows, update `case`, `work_item` and `object` (plus `object_field_idx`), and insert `outbox` rows (notification email, outbound webhook) and `timer` rows (SLA due, escalation).
5. Commit. Return `200` with the new version. A stale `expectedVersion` gets `409`, and the UI refreshes.
6. After commit, publish a small change message on `LISTEN/NOTIFY` or NATS. The realtime gateway pushes "new item" to the assignee's Workspace and folds the change into node counts, which it emits in one-second batches. Per-event counter rows would become hot rows at signal volume.
7. The outbox dispatcher sends the email or webhook asynchronously.

**(b) A parallel split fires and the join waits**

1. A token enters split `S`. The kernel emits `TokenForked{forkId, branches:[t1,t2,t3]}` and a `NodeEntered` per branch. Each branch creates its own work items or automation jobs, all in one transaction.
2. Branches progress independently, possibly with three people working at once. Each release is a separate command on the *same case*, so the per-case lock serializes them.
3. When `t1` reaches join `J`, the kernel emits `JoinArrived{forkId, token:t1, 1/3}`. The case shows "waiting at J (1/3)", and an optional join-SLA timer is scheduled.
4. Because arrivals are serialized, exactly one transaction observes "3/3". It emits `JoinCompleted` and `TokenMoved(J→next)`. Two branches cannot both believe they are last.
5. **Policies.** The join rule can be all, any (cancel the rest), or N-of-M. A rejection in one branch either cancels its siblings (`WorkItemCancelled` events) or routes to the reject path. Data conflicts are prevented by giving branches disjoint editable fields through step field security. Where they overlap, last writer wins and a conflict event is recorded.

**(c) An automated step calls an MCP tool and the result routes the case**

1. A token enters automated step `Triage`, configured as `{connector:"mcp", server:"camera-triage", tool:"classify_event", inputMap, outputMap, timeout, retries}`. The kernel emits `AutomationRequested{jobId, idempotencyKey}`, and the outbox row is written in the same transaction.
2. An automation worker claims the job with SKIP LOCKED and a lease. It resolves the server's endpoint and credentials from the secret store; remote MCP servers use OAuth, per the 2026-07-28 authorization model. It builds tool arguments from the object, **limited to the fields this connector is allowed to read**.
3. It calls `tools/call` through `@modelcontextprotocol/client` over Streamable HTTP, with a timeout and an OTel span. Long-running tools use the Tasks extension, and the worker polls or receives a completion notification.
4. It validates `structuredContent` against the tool's `outputSchema` and maps the result to fields, for example `ai_category` and `ai_confidence`. Tool output is untrusted data; the model never chooses the route directly.
5. It sends the command `AutomationCompleted{jobId, result}`. The kernel emits `FieldsUpdated(actor=connector:camera-triage, model/tool version recorded)` and `AutomationCompleted`. The next decision node evaluates admin-defined conditions such as `ai_category = weapon AND ai_confidence ≥ 0.8`, giving `TokenMoved → "Officer review"` (a high-priority user step, load-balanced to on-duty officers) or `→ "Auto-close"`.
6. On failure: retry with backoff. After N attempts the step goes `Stuck`, an incident appears in Monitor, and an admin can retry, skip or move the case (`adminMove` already exists).

**High-volume signal path.** Camera events go into the JetStream stream `signals.camera.>`. Ingest workers pull in batches and run triage, either an MCP tool or a registered GPU worker, with concurrency limits. **Only actionable signals become cases**, through a bulk `CreateCase`. Discards remain in stream retention and a compact `signal_log`. At 5,000 events/min (about 83/s) with 5% actionable, that is roughly 4 new cases/s. Even if every event became a case at about 10 rows each, about 830 row writes/s is within reach of one well-provisioned Postgres primary. Prove it with the M5 load test rather than assuming it.

---

## 6. Deployment

| Tier | Shape |
|---|---|
| **Small / pilot** | One OCI image (all roles) plus Postgres 18 via Docker Compose. Attachments on a local volume. Optional Keycloak container. Runs on one VM. |
| **Department / enterprise** | Helm chart with the same image in role-specific Deployments: `api` (with HPA), `engine`, `automation` (scaled by queue depth), `scheduler` (2 replicas; SKIP LOCKED makes leader election unnecessary), `ingest`, `realtime`. Postgres through the CloudNativePG operator ([cloudnative-pg.io](https://cloudnative-pg.io)) or managed RDS/Azure, with PgBouncer. A 3-node NATS JetStream cluster. S3-compatible object storage. |
| **SQL Server / Oracle shops** | Same chart, with `DB_DIALECT=mssql|oracle` pointing at the customer-managed database. The product never needs DDL rights after install/upgrade migrations, which DBAs can run themselves from shipped SQL scripts. |

**Government and air-gapped requirements**

- No phone-home: telemetry is off by default. Fonts and assets are bundled, and license files work offline.
- Supply chain: SBOM (CycloneDX/SPDX), signed images (cosign), and hardened bases (UBI, Chainguard, or Iron Bank submission). Air-gap bundles use [Zarf](https://zarf.dev).
- FIPS 140-3 crypto: Node on a base image whose OpenSSL 3 FIPS provider is validated, with TLS terminated at FIPS-validated ingress.
- **FedRAMP covers cloud services, not self-hosted software.** A self-hosted Modus install inherits the agency's ATO, so ship NIST 800-53 control mappings and STIG-style hardening guides. If we later offer SaaS, FedRAMP 20x is the route: the Phase 2 Moderate pilot granted first authorizations in March 2026, and the Consolidated Rules for 2026 (CR26) published 2026-06-25 replace Low/Moderate/High with classes A–D ([FedRAMP 20x Phase 2](https://fedramp.gov/20x/phases/2/), [roadmap](https://secureframe.com/blog/fedramp-20x-roadmap)).

**Multi-tenancy**

| Model | Pros | Cons | Use for |
|---|---|---|---|
| `tenant_id` column + Postgres **RLS** ([docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)) | One schema, cheap tenants | Postgres-specific (SQL Server RLS and Oracle VPD behave differently); noisy neighbors | Hosted/SaaS edition |
| Schema per tenant | Logical separation | Migrations × N, catalog bloat, connection-pool complexity | Avoid at scale |
| Database per tenant | Strongest isolation, per-tenant backup/restore and keys | Ops overhead | Regulated agencies, which is the usual self-hosted case |

Recommendation: put `tenant_id` in every key, index and repository query from day one, enforced by the storage port so it is portable. Add Postgres RLS as defense in depth in the hosted edition. Support database-per-tenant through connection routing for customers who require hard separation.

---

## 7. Recommendation summary

**The stack**

| Layer | Pick | Why |
|---|---|---|
| Engine | **Own deterministic TS kernel**, extracted from `engine.ts` and shared by the simulator and the server | One semantics for design-time simulation, production and replay. Fully open license. Our distribution modes are first-class |
| State | Per-case event log + projections updated in the same transaction + hash chain | Instant worklists, a complete audit trail, replay and process mining |
| Objects | JSON document + `object_field_idx` + generated reporting views | Dynamic types without runtime DDL; portable |
| Database | **Postgres 18** (16+ certified). **SQL Server 2022/2025** certified in v1.x. **Oracle 19c/26ai** after that | Matches the customer base, with honest sequencing |
| Data access | Kysely behind a storage port, plus a cross-database contract test suite | The only typed TS layer with core MSSQL and a usable Oracle dialect |
| Async | DB outbox, timers and job claims with SKIP LOCKED/READPAST | Exactly-once effects, no extra infrastructure, portable |
| API | Fastify 5 + Zod 4 + OpenAPI 3.1; SSE/WebSocket for live data | Integrator-friendly, generated clients |
| Automation | REST/OpenAPI connector, MCP client v2 (spec 2026-07-28), long-poll worker protocol, JSONata mapping | Covers APIs, AI tools and customer code without arbitrary in-process scripts |
| Streaming | NATS JetStream (and MQTT through it); Kafka connector as an option | Light, air-gap-friendly, Apache-2.0 |
| Identity | OIDC/SAML (Keycloak optional), SCIM 2.0, Login.gov and Entra ID | Covers both citizen and workforce identity |
| Ops | One image with role flags; Compose and Helm; CloudNativePG; OTel; Zarf bundle; SBOM and signing | Same artifact from laptop to air-gapped cluster |

**First six milestones**

1. **M1: Kernel extraction.** Split `engine.ts` into a pure kernel (`decide`/`evolve`, event catalog v1, `Clock`/`Rng` ports) and a SimDriver. The prototype UI keeps working on the new kernel. Add property tests, a "simulate one million cases with zero stuck tokens" fuzz run, and versioned JSON Schemas for workflow and type definitions. *Exit:* the browser simulator runs unchanged on the kernel; replaying the event log reproduces final state exactly.
2. **M2: Server skeleton on Postgres.** Fastify + OpenAPI, Kysely migrations, and `case_event`/projections/outbox/timer tables with per-case locking. Object types, objects, lists and attachments, with field-level security in the API. OIDC login against Keycloak. Ship the single Docker image and Compose file. *Exit:* create a case, release items over REST, and see the audit trail.
3. **M3: Work service and Workspace.** Worklists and all four distribution modes (queue-fetch through SKIP LOCKED), return/delegate/out-of-office, SLA timers with business calendars and escalations, and realtime counts over SSE. Wire the SPA's Workspace and Monitor to the server. *Exit:* a pilot team works real cases end to end.
4. **M4: Automation.** Outbox dispatcher, REST/OpenAPI connector, MCP client connector, the long-poll worker protocol plus a TS worker SDK, secrets, retries, incidents and stuck handling, and end-to-end OTel tracing. *Exit:* the camera-triage demo routes on MCP tool output, and failures surface as incidents.
5. **M5: Scale, ingest and analytics.** JetStream ingest with the signal-triage path, OCEL 2.0 and XES export, simulation calibrated from logs plus what-if from live state, the Helm chart, and load tests (target: 100 signals/s sustained, 1,000 concurrent Workspace users, p95 release under 200 ms). *Exit:* published capacity numbers per deployment tier.
6. **M6: Hardening and the second database.** SQL Server adapter certified by the shared contract suite (2022 and 2025), SCIM, SAML, the multi-tenancy model, backup/restore and upgrade runbooks, SBOM, signed images, the air-gap bundle, an external security review, then **v1.0**. The Oracle adapter (19c/26ai) is the headline item for v1.1.

**Main risk and mitigation.** Owning the engine is the big bet. Contain it in three ways: keep the semantics small and explicit (no full BPMN 2.0), use the simulator as a permanent fuzzer and regression oracle, and keep BPMN export plus the worker protocol so that customers are never locked in. If Oracle/SQL Server parity ever outranks one-language-everywhere, revisit .NET/EF Core for the server tier. The kernel/port design is what keeps that move feasible.
