# Live Monitor: the Studio's Monitor on a real server

Status: approved 2026-10-13. A slice of M3 ("the studio's Workspace and Monitor wired to the API and the
live stream"): the Monitor only, read-only.

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
