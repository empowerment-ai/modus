# A twenty-five-minute demo

Open the [live demo](https://empowerment-ai.github.io/modus/) (or `pnpm dev`). The front page
says what Modus is and offers doors in: open a sample application in the Studio, or work in it
as one of its people. Everything runs in the browser: a simulated organization of about 50
people works three sample applications. **Settings › Restore sample data** resets everything;
the Modus logo in the top bar returns to the front page.

## 1. The big picture (Invoice Processing)

1. On the front page, **Invoice Processing › Open in the Studio**, which lands on **Workflows ›
   Invoice Approval**. Press **Run simulation** (or Space). Invoices arrive
   (14 an hour), tokens travel along the paths, and every step shows how many are there now.
2. Follow an invoice: **Capture & match PO** calls the ERP (a registered REST service). If the
   ERP keeps failing, the work is handed to an exceptions specialist to do by hand.
3. **Route by amount** sends invoices to the Controller (over $10,000), a budget manager (over
   $1,000) or the AP clerks — except that an **expedited** invoice under $5,000 takes the fast
   lane straight to the clerks (the first rule tests *Expedited*, a work attribute). Click **8h** twice: **Controller approval** turns red with a
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
4. Changes that map to the design can be applied with one click. Capacity and arrivals change
   at once; changes to steps (handling time, distribution) go into the workflow's draft, and
   the confirmation offers **Publish…**. Staffing changes point you to People & Security.

## 3. Change a process safely

1. Click the `Amount > $10,000` path and change it to `25,000`. The chip in the header turns
   from **Version 1 · Live** to **Draft · 1 change**, and the map says *Draft: changes aren't
   live until you publish*: nothing in flight is touched yet.
2. Press **Publish…**. The dialog lists what changes; add a note and choose **Who uses version
   2?** — *New items only* (recommended: invoices in flight finish on version 1), *New items
   and items in flight* (move them now), or *Nobody yet* (keep the draft). Publish for new
   items only.
3. Now delete **Manager approval** from the map (invoices are waiting there) and **Publish…**
   with *New items and items in flight*: the dialog asks where the invoices at *Manager
   approval* should go. Leave them where they are for now; everything else moves to version 3,
   and the map notes the invoices at a step it no longer has.
4. **History** lists every version with its note, when it was published and how many invoices
   run on it; *Restore as draft* starts the draft over from any version. Open one of the
   invoices left at *Manager approval* (Monitor › Object explorer): the drawer says which
   version it runs (*Version 2 of Invoice Approval (latest: 3)*), and **Move to version 3** asks
   where it goes. Or, in History, *Move these items to the latest version* moves all of an old
   version's work at once.
5. Select **AP clerk review** › **Live work**: ten clerks, load balanced; *Burst of 25* spreads
   evenly. Reassign any item; **Redistribute** evens out the baskets.
6. Select **Capture & match PO**: the service, its capacity, retries and failure policy. In
   the **Live** tab an administrator can take an item off the automation and give it to a
   person in the fallback group.

## 4. Line items

1. **Object Types › Invoice › Line Items**: a **table** field with typed columns —
   Description, Category (a list), Quantity, Unit Price — and **Line Total**, calculated as
   Quantity × Unit Price. **Amount** is a *total* of Line Total, so it can never disagree with
   the lines. *Fill sample* in the form preview shows it working.
2. Rules can test rows: in a decision, pick *Line Items* and choose *any row where* Category
   is Software, or *sum of* Line Total, or *number of rows*.
3. Open any invoice (Monitor › an item, or the Workspace): the lines render as a grid with a
   total. Where a step lets you edit them, Amount updates as you type; once Amount is locked
   after routing, the lines lock with it.

## 5. Do the work (Workspace)

1. Switch to **Workspace** (top bar). Work as **Maya Patel**, an AP clerk. *My work* shows her
   basket by priority and due date; open one: the form shows exactly what she may edit at this
   step, and why the amount is locked (it was locked after *Route by amount*).
2. Release it as *Approve* — it moves on. The rest of the organization keeps working around you.
3. Work as **Carla Mendes** (AP Supervisor): the **Distribute** board shows approvals waiting to
   be handed out and each budget manager's live load. Drag an item onto a person, or
   *Distribute evenly*.
4. Work as **Rosa Delgado** (AP Exceptions): *Queues* › **Get next** pulls the most urgent,
   oldest exception.
5. *New request* creates an invoice as the person you are working as; *My requests* tracks it.

## 6. Find anything, ask anything

1. Press **⌘K** (or `/`) anywhere in the Workspace and type an invoice number, or a vendor:
   results appear as you type. *See all* opens **Search**.
2. On **Search**, try `amount>10k is:open`, `toner`, `step:"controller approval"` or
   `-northwind`. Each result says where it is now and *why it matched* — including words
   inside line items. Click a facet (status, priority, where it is now) to narrow. *Search
   tips* lists the whole language.
3. Search respects field security: as Maya, a vendor's bank account can't be found, because
   she isn't allowed to see it.
4. **Ask Modus** (left nav): *“urgent invoices over 10k”*, *“what should I work on next?”*,
   *“where is the bottleneck?”*, *“how do I delegate?”*. Every answer shows the search it ran
   — click it to open Search with that query. It runs offline; on the server, an AI model
   (Claude) can answer open-ended questions with the same permissions as the person asking.

## 7. Supervise and expedite

1. Work as **Carla Mendes**. She supervises the AP steps and (through Finance Leadership) the
   whole Invoice Approval process, so **Supervise** appears: every step she oversees with
   waiting, in baskets, working, overdue and each person's load. Open **Controller approval**:
   reassign within the group, *Release…* on someone's behalf (a comment is required and
   recorded), return, retry, change priority, or *Redistribute evenly*.
2. Work as **Victor Lindqvist** (Controller). Open an invoice and press **Expedite**: the
   dialog explains the policy (the requester or a supervisor; a reason is required) and shows
   the due date tightening. The item jumps to the top of every basket and queue — above
   urgent work — with an orange *Expedited* badge and the reason.
3. Switch to **Video Security Operations** and work as **Elena Vasquez** (watch commander):
   *Escalated to you* lists dispatches that waited too long. Avery Brooks (administrator)
   supervises everything in every application.
4. In the Studio: **Workflows** › the process overview sets *process supervisors* and the
   *expedite policy*; a people step sets *task supervisors* and whether escalations notify
   them. **People & Security › Roles** grants Administrator, Designer and Auditor and shows
   who supervises what. **Monitor** compares expedited and normal cycle time, and **What-if**
   can expedite a share of new arrivals to show what it costs everyone else.

## 8. Not a business process (Video Security Operations)

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

## 9. Build with blocks

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

## 10. For the engineers

- `packages/core` is the engine; `pnpm test` runs it through all three applications.
- `pnpm --filter @modus-bpm/server dev` runs the same engine live: create an item over REST,
  poll a job as a worker, complete it, and watch the item route — see `apps/server/README.md`.
- `docker compose up` runs the whole product (API and studio) from one image on port 8787;
  set `ANTHROPIC_API_KEY` to let Ask Modus use Claude. See [DEPLOYMENT.md](DEPLOYMENT.md).
- **Monitor** › *Export event log* writes OCEL 2.0 for process-mining tools.
