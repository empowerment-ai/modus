# Product

<!-- impeccable:product-schema 1 -->

<!-- Inferred from the repository (README, docs/, the sample applications) and the owner's
     requests in the build conversation; not yet confirmed in an interview. -->

## Platform

web

## Users

- **Process owners and administrators** in organizations whose work moves through people and
  systems (accounts payable, fleet and facilities, public-safety operations). They design and
  change processes, decide who does the work, and need the big picture: where work piles up and
  what a change would do.
- **People doing the work**, who use the Workspace: a basket of assigned items, queues, a
  dispatch board, search and a plain-language assistant.
- **Evaluators**: engineers and decision makers visiting the public demo or the GitHub
  repository to judge whether Modus fits, how it is built, and how it would be deployed.

## Product Purpose

Modus is an open-source process manager (Apache-2.0) where the model is the system: the
process an administrator draws is the process that runs, the one that is simulated, and the
one that is monitored. Success is that changing how work flows becomes an edit, not a project,
and that administrators can see bottlenecks and test a fix before making it.

## Positioning

One deterministic engine runs the design, the live simulation, the what-if lab and (on the
server) production, so the map, the forecast and the running process never drift apart. Live
counts, bottleneck detection and what-if experiments come from the same model people edit.

## Operating Context

- The browser prototype simulates an organization of about 50 people working three sample
  applications: Invoice Processing, Fleet Vehicle Requests and Video Security Operations
  (camera events screened by AI and routed to officers).
- Two modes: **Studio** (design, monitor, what-if, security) and **Workspace** (do the work as
  a chosen person).
- The prototype runs entirely in the browser, with no sign-in and nothing sent anywhere. The
  product adds sign-in (OIDC/SAML), a server and a database; those are planned, not built.

## Capabilities and Constraints

Built in the prototype: dynamic object types and forms, line items with calculated totals,
linked lists, visual workflow designer, parallel split/join, subflows, timers, templates,
automated steps over a service registry (REST, MCP servers, worker pools, AI agents), five
distribution modes, escalation, priorities and due dates, expedite, task and process
supervisors, roles (administrator, designer, auditor), three-layer field security, search,
Ask Modus (offline assistant; Claude on the server when configured), live counts and
bottlenecks, what-if lab, audit history and OCEL 2.0 export. The server is a skeleton with
in-memory storage, shipped as one container image with Docker Compose and a Helm chart.
Planned, not built: PostgreSQL (then SQL Server, Oracle), OIDC/SAML, multi-tenancy.

## Brand Commitments

- Name: **Modus** ("as in modus operandi: the way your organization gets things done").
- Plain words for business users; standard terms nearby for engineers.
- Never name the legacy product it replaces; refer to "classic" or "earlier-generation" BPM.
- An Empowerment AI open-source project; repository https://github.com/empowerment-ai/modus.

## Evidence on Hand

Screenshots in `docs/images/`; the live demo itself; the docs (DEMO, ARCHITECTURE,
TECH-STACK, DEPLOYMENT, ROADMAP). There are no customers, testimonials, benchmarks or prices:
never invent them.

## Product Principles

1. The model is the system: one design for running, simulating and monitoring.
2. Change is an edit: work in flight follows the new map.
3. Show the big picture: counts, bottlenecks and workload, for people and automation alike.
4. Test before you change: what-if on the live state.
5. Honest about status: prototype features are labeled as such; planned is never shown as done.

## Accessibility & Inclusion

Target WCAG 2.2 AA / Section 508 (public-sector buyers): keyboard paths for every action,
labeled controls, visible focus, reduced motion respected.
