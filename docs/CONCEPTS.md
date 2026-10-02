# Concepts and terminology

Modus uses plain words in the product and keeps the standard terms close by, so
business users, administrators and engineers can talk about the same thing. Teams coming from
earlier-generation BPM tools will recognize most of these under older names.

| Modus | What it means | Older name you may know | Standard term (BPMN 2.0 / Workflow Patterns) |
| --- | --- | --- | --- |
| **Parallel split** | Run several paths at the same time. *All paths*, or *every path whose rule matches*. | Broadcast | Parallel gateway (AND-split) · inclusive gateway (OR-split) · WCP-2, WCP-6 |
| **Join** | Wait for parallel branches to come back together: *all of them*, *the first one*, or *N of M*; optionally withdraw the rest. | Rendezvous | Parallel/inclusive join · discriminator · partial join · WCP-3, WCP-7, WCP-9, WCP-30–32 |
| **Automated step** | Work the system does: call a registered service and route on *Succeeded* / *Failed*. | Device | Service task · external task / job worker · WRP-11 Automatic Execution |
| **Registered service** | A system automated steps can call: REST/OpenAPI, an MCP server's tools, a worker pool that polls for jobs, an AI agent, email. Has a capacity, a status and typed outputs. | Device definition | Connector · job worker · digital worker |
| **Worker pool** | Custom code registered under a topic; workers poll for jobs, then complete or fail them. Pool size limits throughput. | Device | External task pattern (fetch-and-lock) |
| **Subflow** | A step that runs a whole reusable process on the same item and continues on the way it ended. | Subflow / sub-process | Call activity · reusable sub-process |
| **Template** | A saved subflow (with the fields it uses) that can be stamped into any application. | — | Process template / marketplace asset |
| **Item** | One business object moving through a process (an invoice, a request, a camera event). | Object | Case / process instance |
| **Branch** (token) | One thread of an item. An item has one per active parallel branch. | — | Token |
| **Work item** | A branch waiting at a people step. | Work item | Work item / task |
| **Basket** | A person's own work items. | Work basket | Worklist · task inbox |
| **Queue** | Work waiting for any member of a group to claim it (or *Get next*). | Queue / fetch | Offer to multiple resources · resource-initiated allocation · WRP-13, WRP-21 |
| **Load balanced** | Each item goes to the available member with the fewest open items. | Load balanced | Shortest queue · WRP-17 |
| **Distribution group** | Dispatchers who hand each item to a member of the team (several supervisors sharing the job). | Supervisor distribution / distribution group | Deferred distribution · WRP-3, WRP-14 |
| **Direct** | Every item goes to one named person. | Direct | Direct distribution · WRP-1 |
| **Person on the item** | The person named in a field gets it: the requester, the officer who responded. | — | Retain familiar · WRP-7; organizational distribution · WRP-10 |
| **Reassign / delegate / return** | Move work between people (administrators: anyone or same group; workers: a colleague in the same group). | Reassign / redistribute | Detour patterns: delegation, reallocation, deallocation · WRP-27–31 |
| **Separation of duties** | Four eyes: nobody who released a given earlier step on this item may work this step. | — | WRP-5 Separation of Duties |
| **Escalation** | After N hours at a step: raise priority, notify, and/or send it back to the dispatchers. | — | Escalation · WRP-28 · SLA deadline |
| **Field security** | Who can edit, read or not see each field — by sensitive-data group, by workflow lock, by step. The strictest wins. | Field security per step | Attribute- and step-level access control |
| **Field lock** | A workflow rule: a field becomes read-only or hidden everywhere, or once the item passed a step (exempt groups allowed). | — | — |
| **Priority / due date** | Low · Normal · High · Urgent, from a field or raised by escalation; due dates from step service levels and the workflow's target time. Queues and baskets are ordered by them. | — | Work item priority · SLA |
| **Simulation** | The engine running the design with simulated people, arrivals and services, live on the map. | — | Process simulation |
| **What-if** | Run the live state forward twice — as is and with a change — and compare. | — | Scenario simulation / digital twin |
| **Stuck** | Work that can't continue (no matching path, a failed call). It resumes on its own when the map is fixed, or an administrator moves or retries it. | — | Incident |

## Reading the map

- The **number on a step** is how many items are there right now; amber means it is building
  up, red means backed up, and the busiest step carries a **Bottleneck** tag.
- Bars under a people step are **each person's share** of its work.
- A **subflow step** shows how many items are inside it; open it to see where.
- A **join** shows how many branches are waiting for their siblings.
- An **automated step** shows calls in flight, calls queued for capacity, and work handed to
  people when the automation failed.

## Where things are defined

| You want to… | Go to |
| --- | --- |
| Add a field, choose which fields show on cards, mark a field sensitive | Object Types · People & Security › Field security |
| Build cascading choices (Model Year → Make → Model) | Lists |
| Draw or change a process, add parallel steps, subflows, timers | Workflows |
| Decide who does the work and how it is handed out | Workflows › select a people step |
| Register a REST API, an MCP server, a worker pool or an AI agent | Integrations |
| Reuse a process someone already built | Templates · Workflows › From template… |
| Lock a field after approval, see the security matrix | People & Security › Field security |
| See counts, bottlenecks, workload, any item's history | Monitor · click a step · click an item |
| Test a fix before making it | What-if |
| Do the work as a particular person | Workspace |
