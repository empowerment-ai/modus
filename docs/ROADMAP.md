# Roadmap

Status of the capabilities the [competitive analysis](research/competitive-analysis.md#6-best-features-to-adopt)
ranked, plus what the prototype already does. *Prototype* means it works end to end in the
browser studio (simulated); *Skeleton* means the server path exists in a first form.

## Model and design

| Capability | Status |
| --- | --- |
| Dynamic object types, generated forms, numbering, title and summary fields | Prototype |
| Linked (cascading) lists | Prototype |
| Visual workflow designer with live counts on every step | Prototype |
| Decisions on object metadata (ordered rules + Otherwise) | Prototype |
| Parallel split (all / inclusive) and join (all / first / N-of-M, cancel the rest) | Prototype |
| Subflows (call a reusable process; route on its named ending); blow a step out into a subflow | Prototype |
| Timers | Prototype |
| Templates: save a workflow, stamp it into any app with field mapping, starter library | Prototype |
| Event-stream, API, schedule and inbox start triggers (modeled; simulated arrivals) | Prototype (ingest planned M5) |
| DMN decision tables bound to object fields | Planned |
| Case handling: stages, milestones, ad-hoc tasks | Planned |
| Natural language → draft workflow (always editable as a diagram) | Planned |
| Draft → simulate → publish with visual diff; workflow versions | Planned (next) |
| Migration of in-flight items to a new version, with preview | Planned |
| BPMN 2.0 XML export / import | Planned |

## Work and people

| Capability | Status |
| --- | --- |
| Load balanced, queue (claim / get next), distribution groups (dispatchers), direct, from a field (retain familiar) | Prototype |
| Priority and due dates; urgency-ordered queues and baskets | Prototype |
| Escalation (raise priority, notify, return to dispatchers) | Prototype |
| Reassign within group, delegate, return, redistribute evenly, move, release on behalf, cancel | Prototype |
| End-user Workspace: home, basket, queues, dispatch board, my requests, new request, work form | Prototype |
| Out of office (availability) and "reassign their work" | Prototype |
| Separation of duties ("not the same person as step X"), enforced in allocation, claims, delegation and dispatch | Prototype (engine) |
| Capability / skills-based allocation, shifts and business calendars | Planned |
| Mobile Workspace (PWA) for field users such as officers | Planned |

## Automation and integration

| Capability | Status |
| --- | --- |
| Service registry: REST, MCP, worker pools, AI agents, email; capacity, status, typed outputs | Prototype |
| Retries, failure path, hand to a person, stop for an administrator; take work off automation | Prototype |
| Worker job protocol (poll with lease, complete with outputs, fail) | Skeleton |
| REST/OpenAPI connector, MCP client connector, outbox dispatcher | Planned (M4) |
| Worker SDKs (TypeScript, Python, .NET, Java) | Planned (M4) |
| Processes exposed as MCP tools (other agents can start and query them) | Planned |
| Stream ingest (NATS JetStream / MQTT / Kafka) with triage and bulk create | Planned (M5) |

## Visibility and control

| Capability | Status |
| --- | --- |
| Live heat map, bottleneck detection (people and automated steps), SLA breaches | Prototype |
| Monitor: KPIs, work in flight over time, workload per person, services, activity, item explorer | Prototype |
| Complete audit history per item | Prototype |
| What-if lab on the live state (staffing, handling time, arrivals, distribution, capacity, outages), apply to design | Prototype |
| Three-layer field security enforced by the engine; security matrix; "check as a person" | Prototype |
| Process mining export: OCEL 2.0 JSON (studio and API) | Prototype |
| XES export; simulation calibrated from history | Planned (M5) |
| Predicted SLA breach, AI-assisted routing suggestions | Later |

## Platform

| Capability | Status |
| --- | --- |
| Same engine in browser and server (live mode) | Skeleton |
| REST API + live stream (SSE) | Skeleton |
| PostgreSQL adapter, event log + projections + outbox + timers | Planned (M2) |
| OIDC / SAML sign-in, SCIM group sync | Planned (M2–M6) |
| SQL Server adapter (certified) | Planned (M6) |
| Oracle adapter (certified) | Planned (v1.1) |
| Multi-tenancy, Helm chart, air-gapped bundle, SBOM and signed images | Planned (M5–M6) |

See [ARCHITECTURE.md](ARCHITECTURE.md#from-prototype-to-production-milestones) for the milestone plan.
