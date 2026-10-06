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
| **Line items** (table field) | Rows inside an item — an invoice's lines, a request's requested items — with typed columns, calculated columns (*Quantity × Unit Price*) and a **total** field that sums a column. | Multi-row / repeating group | Repeating section · child records · data object collection |
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
| **Expedite** | Flag an item to go faster: it moves ahead of everything (even urgent work), its clocks shrink (e.g. twice as fast), and rules can send it down a fast lane. Each process says who may expedite and whether a reason is required. | Rush / hot item | Priority escalation · expedited handling |
| **Task supervisor** | Oversees one people step: sees all its work and can reassign, return, release on behalf, retry, set priority, expedite and redistribute. Named on the step; the work group's supervisor always counts. | Supervisor | Task/activity owner · WRP-30 (supervisor reallocation) |
| **Process supervisor** | The same powers on every step of a process, including its subflows. | Process owner | Process owner |
| **Roles** | Organization-wide powers: **Administrator** (all work and settings), **Designer** (change designs), **Auditor** (read everything, change nothing). | Administrator | RBAC roles |
| **Search** | Find any item you may see by number, words (in any field, line item or comment) and filters such as `is:overdue`, `priority:urgent`, `amount>10k`, `step:"manager approval"`. | Search | Case search |
| **Ask Modus** | Ask in plain words ("urgent invoices over 10k", "what's waiting on me?"); it shows the search it ran and the results. Runs offline; a server can add an AI model with the same permissions as you. | — | Conversational assistant |
| **Simulation** | The engine running the design with simulated people, arrivals and services, live on the map. | — | Process simulation |
| **What-if** | Run the live state forward twice — as is and with a change — and compare. | — | Scenario simulation / digital twin |
| **Draft** | The map you see and edit. Changing it touches no item until you publish it. | — | Working copy · unpublished revision |
| **Version** | A numbered copy of a workflow, made when you publish. Every version is kept; each item records the version it started on and runs it to the end. Access is the exception: supervisors and field security are the stricter of the item's version and the live one, so removing a supervisor or adding a lock applies to every item at once. | — | Process definition version |
| **Publish** | Make the draft the next version and choose who uses it: *new items only* (items in flight finish on the version they started), *new items and items in flight* (move them now), or *nobody yet* (keep it as a draft). | — | Deploy · process versioning |
| **Move items to a version** | Put items in flight onto another version, usually the latest: all of an old version's items, or one item. Work at a step both versions have stays where it is; work at a step the new version removed goes where you choose, or the item stays on its version. Audited. | — | Process instance migration (with a step mapping) |
| **Stuck** | Work that can't continue (no matching path, a failed call). Publish a fixed map and move the item onto it, and it resumes on its own; or an administrator moves or retries it. | — | Incident |

## Reading the map

- The **number on a step** is how many items are there right now, whichever version they run;
  amber means it is building up, red means backed up, and the busiest step carries a
  **Bottleneck** tag.
- The chip in the header says which version is live (**Version 2 · Live**), or **Draft · 3
  changes** while the map has changes that aren't published. A note on the map counts items at
  steps the map no longer has (they run an older version), with a link to **History**.
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
| Publish a change, see which items run which version, move items to the latest | Workflows › **Publish…** · **History** · click an item › *Move to version N* |
| Decide who does the work and how it is handed out | Workflows › select a people step |
| Add line items (a table) to a form, with totals | Object Types › add a field › Table |
| Name supervisors; set who may expedite | Workflows › the process overview (process supervisors, expedite) · select a people step (task supervisors) |
| Give someone the Administrator, Designer or Auditor role | People & Security › Roles |
| Find an item, or ask a question | Workspace › Search (⌘K) · Ask Modus |
| Oversee steps you supervise | Workspace › Supervise |
| Register a REST API, an MCP server, a worker pool or an AI agent | Integrations |
| Reuse a process someone already built | Templates · Workflows › From template… |
| Lock a field after approval, see the security matrix | People & Security › Field security |
| See counts, bottlenecks, workload, any item's history | Monitor · click a step · click an item |
| Test a fix before making it | What-if |
| Do the work as a particular person | Workspace |
