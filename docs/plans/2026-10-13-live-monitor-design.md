# Live Monitor: the Studio's Monitor on a real server

Status: implemented 2026-10-13 on `feat/live-monitor` (approved the same day). A slice of M3 ("the
studio's Workspace and Monitor wired to the API and the live stream"): the Monitor only, read-only.
See "Refinements" at the end for what changed while building it.

## Goal

When the Studio is served by a Modus server, its Monitor shows the server's real state, updating live,
with a switch back to the in-browser simulation. The standalone build (Pages, `pnpm dev`) is unchanged.

## How the Studio connects

- **Detection:** one `GET /api/health` at startup. An answer means a Modus server serves the Studio.
- **Toggle:** served by a server, the Monitor header has **Live / Simulation**; it opens on Live.
  Simulation is today's in-browser simulation, unchanged.
- **Design:** Live draws the server's published design (`GET /api/design`), not the browser's. A note
  appears when they differ.
- **Identity:** until OIDC, the Studio sends `x-user-id` as an administrator (default the sample's
  administrator). The Monitor endpoints are administrator-only.
- **Updates:** the Live view opens `/api/apps/:app/stream`. Step counts come from each `change` event;
  other panels refetch, throttled to about once a second. `items: null` or a dropped stream → full refresh
  and reconnect. A badge shows "Live · updated Ns ago" or "reconnecting…".

## Server endpoints (administrator-only, in-memory reads)

- `GET /api/apps/:app/monitor` — the full `SimView` (KPIs, bottleneck, steps incl. expedited per step,
  services, workload per person with the item each is working on). Size grows with steps, people and
  services, not items.
- `GET /api/apps/:app/monitor/series?since=` — work in flight over time; incremental.
- `GET /api/apps/:app/monitor/feed?limit=` — the activity feed (last 300).
- `GET /api/apps/:app/monitor/items?status&type&step&assignee&q&limit&cursor` — the item explorer,
  paged, over all items (can move onto the `item` projection later).
- `GET /api/design` — the published design; any named user (the Workspace will need it).

## Studio

A small server client (detection, `x-user-id`, stream with reconnect, refetch throttling) and a live
source next to the simulation store, so each Monitor panel reads from one of two sources with the same
layout. Panels that read the raw simulation today (workload's "working on", the explorer) use the
server's ready answers in Live. Monitor actions (redistribute) stay simulation-only for now.

## Errors

Unreachable → amber badge, last data kept. 403 → "the acting person isn't an administrator".
Refetches capped at one per second per tab, so the Live view can't load the server.

## Tests

Server: endpoint shapes, admin-only, paging and filters. Studio: unit tests of the live store against a
fake server (event updates counts, `items: null` refreshes, reconnect). One end-to-end smoke: the built
Studio served by a server opens Live and shows an invoice created through the API.

## Docs

ARCHITECTURE and ROADMAP (M3 slice: Monitor live), and the load-test README (watch at
`localhost:8790`).

## Refinements

What building it changed or added to the design above:

- **Working now comes from tokens.** `workingNow` (core) finds what each person is working on from
  tokens in the working state, not from the simulated person's current task, which a live server
  doesn't track. "+N more" counts the rest.
- **Allowlisted design.** `GET /api/design` sends only the service, operation and output fields the
  Studio draws. Endpoint, auth, secret reference, owner, and any field added later stay on the server.
- **One explorer for both.** The item explorer's filtering and paging live in core and serve the
  Studio's simulation and the server alike. A page keeps only the top `limit + 1` matches instead of
  sorting them all. The server keeps a search cache per app that survives commits.
- **Hidden tabs.** A hidden tab refetches nothing (the stream still updates counts) and reloads
  everything once when shown.
- **Ready before admin reads.** The live store fetches the design first (as anyone named), picks an
  administrator from it, and only then calls the administrator-only endpoints.
- **Denied and not found.** A 401/403 on the stream ends it with a message naming the person. A 404
  ends it too: an error if the design still lists the app (the server dropped it), idle otherwise.
- **Unknown app.** An app the server doesn't run makes no Monitor reads and opens no stream; the
  badge reads "Not on this server".
- **Badge.** "Live · last change Ns ago", counting only events that moved an item, then "Live · idle"
  on a quiet server; "Connecting…" pulses; amber "Reconnecting…" keeps the last data.
- **Heard from recently.** `feat/load-tests` owns the stream handler and its 25 s pings. After the
  merge the stream reports every chunk (pings included) and the store keeps `lastHeard`: 60 s with
  nothing heard counts as a dropped stream, which it closes and reopens, showing "Reconnecting…" in
  between. So "Live" means heard from recently, not just a socket the browser believes is open.
- **Smoke check.** `pnpm --filter @modus-bpm/server smoke:live` (after a studio build) runs the
  end-to-end check against a real server.
