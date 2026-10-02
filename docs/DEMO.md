# A twenty-minute demo

Open the [live demo](https://empowerment-ai.github.io/throughline/) (or `pnpm dev`). Everything
runs in the browser: a simulated organization of about 50 people works three sample
applications. **Settings › Restore sample data** resets everything.

## 1. The big picture (Invoice Processing)

1. **Workflows › Invoice Approval.** Press **Run simulation** (or Space). Invoices arrive
   (14 an hour), tokens travel along the paths, and every step shows how many are there now.
2. Follow an invoice: **Capture & match PO** calls the ERP (a registered REST service). If the
   ERP keeps failing, the work is handed to an exceptions specialist to do by hand.
3. **Route by amount** sends invoices to the Controller (over $10,000), a budget manager (over
   $1,000) or the AP clerks. Click **8h** twice: **Controller approval** turns red with a
   **Bottleneck** tag — one person can't keep up.
4. After approval, **Pay & file** is a **parallel split**: post to the ERP, send the remittance
   email and archive to records all happen at once; **All filed** waits for all three.
5. **Resolve exception** is a **subflow** step: the number on it is how many invoices are
   inside. Open it to see *Exception Handling* — triage, then get the PO or correct the data.
   *Correct invoice data* uses **separation of duties**: whoever triaged may not correct.

## 2. Fix the bottleneck — safely (What-if)

1. **What-if** (left rail), or **Monitor › Test a fix in What-if**. Fixes for the current
   bottleneck are suggested: *Add 2 people to Finance Leadership* (Controller approval goes to
   one named person, so the suggestion also switches it to load balanced), *Cut handling time
   by 25%*, *Switch to load balanced*. Add one and run 8 hours.
2. Both futures start from the same live state with the same random numbers, so the difference
   is the change: more invoices finished, cycle time down, the bottleneck moves.
3. Try *Arrivals +50%* to stress the process, or take the ERP offline for the run.
4. Changes that map to the design (capacity, handling time, distribution, arrivals) can be
   applied with one click. Staffing changes point you to People & Security.

## 3. Change the process while it runs

1. Click the `Amount > $10,000` path and change it to `25,000`: new invoices follow the new
   rule at once. Work at a broken spot is parked as *stuck* and resumes when you fix the map.
2. Select **AP clerk review** › **Live work**: ten clerks, load balanced; *Burst of 25* spreads
   evenly. Reassign any item; **Redistribute** evens out the baskets.
3. Select **Capture & match PO**: the service, its capacity, retries and failure policy. In
   the **Live** tab an administrator can take an item off the automation and give it to a
   person in the fallback group.

## 4. Do the work (Workspace)

1. Switch to **Workspace** (top bar). Work as **Maya Patel**, an AP clerk. *My work* shows her
   basket by priority and due date; open one: the form shows exactly what she may edit at this
   step, and why the amount is locked (it was locked after *Route by amount*).
2. Release it as *Approve* — it moves on. The rest of the organization keeps working around you.
3. Work as **Carla Mendes** (AP Dispatch): the **Distribute** board shows approvals waiting to
   be handed out and each budget manager's live load. Drag an item onto a person, or
   *Distribute evenly*.
4. Work as **Rosa Delgado** (AP Exceptions): *Queues* › **Get next** pulls the most urgent,
   oldest exception.
5. *New request* creates an invoice as the person you are working as; *My requests* tracks it.

## 5. Not a business process (Video Security Operations)

1. Switch the application. 120 camera events an hour arrive on an event stream. **AI object
   detection** runs on a two-GPU worker pool; jump ahead a few hours and it becomes the
   bottleneck (automated steps can be bottlenecks too).
2. Events worth a look are **enriched in parallel**: watchlist comparison (an **MCP** tool),
   adjacent cameras and clip export (the video management system's REST API), and an
   **AI agent** that rates the threat. **Enrichment done** waits for all four.
3. Watch commanders (a **distribution group**) point an officer at the camera. Unanswered
   dispatches **escalate** after 15 minutes. Incidents go to the **Incident report** subflow,
   which goes back to the officer who responded (*person on the item* — retain familiar).
4. The watchlist subject is **sensitive**: only commanders and analysts can see it; officers
   never do. See **People & Security › Field security** and *Check as a person*.
5. **What-if**: raise the Vision AI capacity from 2 to 4 and the backlog clears.

## 6. Build with blocks

1. **Templates**: a starter library (two-level approval, parallel review, employee onboarding,
   AI triage with human review, three-way match, incident report). *Use in this app* maps the
   template's fields onto your object type and adds it as a subflow.
2. In a workflow: **From template…** on the palette, **Save as template** in the header, and
   **Blow out into a subflow** on any step.
3. **Integrations**: the service registry — REST APIs, MCP servers, worker pools, AI agents —
   with live calls, queue and failure rates, and which steps use each. Take a service offline
   and watch work queue up on the map.
4. **Fleet Vehicle Requests** › *Purchase vehicle*: three dealer quotes in parallel; the join
   continues after **two of three** reply and withdraws the third.

## 7. For the engineers

- `packages/core` is the engine; `pnpm test` runs it through all three applications.
- `pnpm --filter @throughline/server dev` runs the same engine live: create an item over REST,
  poll a job as a worker, complete it, and watch the item route — see `apps/server/README.md`.
- **Monitor** › *Export event log* writes OCEL 2.0 for process-mining tools.
