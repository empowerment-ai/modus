# Outbox sender: webhooks

Status: implemented (approved 2026-10-13; see Refinements). Builds on M2 (`outbox` rows written in each command's transaction).

## Goal

Deliver every outbox message (`job.ready`, `notify`) to configured HTTP endpoints, signed, at
least once, with retries. Email, chat or a worker wake-up are wired outside Modus for now; sending
email from Modus comes later.

## Configuration (server settings)

- `WEBHOOK_URL` + `WEBHOOK_SECRET`: one endpoint, every message.
- `WEBHOOKS_FILE`: a JSON file for several endpoints:
  `[{ "name": "ops", "url": "https://…", "secret": "…" or "secretEnv": "OPS_HOOK_SECRET", "apps": ["app_invoice"], "kinds": ["notify"] }]`.
  `apps` and `kinds` are optional filters. In Helm, the file comes from a ConfigMap and secrets from a Secret.
- `WEBHOOKS_ALLOW_HTTP=true` allows `http://` URLs (local testing). Otherwise only `https://`.
- A bad file, a missing secret or a bad URL stops the server at startup with a clear message.
- The startup line lists each endpoint's name, host and filters, never its secret.

## The request

`POST` with JSON body `{ id, kind, appId, itemId, createdAt, payload }`; `id` is the outbox row id, so
receivers can drop repeats. Header `Modus-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`
(the Stripe scheme); receivers reject anything older than 5 minutes. 10 s timeout. Redirects are
not followed.

## Delivery

- Each message goes to every endpoint whose filters match. Each (message, endpoint) pair is its
  own delivery, so a failing endpoint never delays or repeats another.
- Success: a 2xx answer. Retried: network errors, timeouts, 408, 429, 5xx, on 10 s, 30 s, 2 min,
  10 min, 1 h, then hourly up to 24 h after the first attempt; a longer `Retry-After` is honored.
  Any other 4xx: failed at once. After 24 h: failed.
- Stored per attempt: status code and the first 500 characters of the error, never the body sent.
- With no endpoint configured, messages are marked skipped at once, so the table doesn't grow.

## Who sends

Every server runs a sender loop. It wakes after a commit that wrote outbox rows (the change notice
it already hears) and otherwise every 2 s.

1. Fan out: for messages with no deliveries yet, create one delivery per matching endpoint
   (`INSERT … ON CONFLICT DO NOTHING`), or mark the message skipped when none match.
2. Claim: `SELECT … FOR UPDATE SKIP LOCKED` a batch of due deliveries, set `next_at = now + 60 s`
   (the claim), commit.
3. Send each outside any transaction; record delivered, the next attempt, or failed.
4. A message's `sent_at` is set when every delivery is delivered or failed.

A server that dies mid-send loses its claim after 60 s and another retries: at least once.

## Storage

Migration `0003_outbox_delivery`: `outbox_delivery(outbox_id, endpoint, status pending|delivered|failed,
attempts, next_at, last_status, last_error, delivered_at, created_at)`, primary key
`(outbox_id, endpoint)`, index on `(status, next_at)`; `outbox.skipped boolean`. The memory adapter
does the same in process. Clean-up deletes messages that went out after 7 days and failed ones
after 30 (`WEBHOOKS_KEEP_DAYS`, `WEBHOOKS_KEEP_FAILED_DAYS`).

## Administration

`GET /api/admin/outbox?status=failed|pending|delivered` lists deliveries with their last error;
`POST /api/admin/outbox/:id/retry` sends a message again (its failed deliveries back to pending).
Administrator role required. Each failure is logged with the endpoint name and status.

## Testing

- Unit: signature, retry schedule, classifying responses, config parsing.
- Storage contract (memory and Postgres): fan-out to matching endpoints; exclusive claims (two
  claimers never get the same delivery); an expired claim is retaken; success, next attempt,
  final failure; `sent_at`; clean-up.
- End to end with a local HTTP server: an invoice's `job.ready` arrives once, signed; 500 retries;
  400 fails; the admin retry resends.
- Two servers on one database: each message arrives exactly once while both run.

## Docs

DEPLOYMENT: a Webhooks section (settings, payload, verifying the signature in Node, retries).
ROADMAP and ARCHITECTURE: outbox sender done (webhooks); email from Modus and connectors stay in M4.

## Refinements

What changed while building it:

- **Fenced record.** `record` takes the lease its claim returned and applies only while the
  delivery still holds it, so a server that answers after its lease ran out can't overwrite the
  result of the server that took over.
- **Retry restarts the schedule.** Each delivery keeps `since` (fan-out, or the last admin retry),
  and the 24 hours count from it, not from when the message was written. An admin retry resets
  `since` and the attempt count.
- **`outbox.routed`.** A message is marked routed in the transaction that creates its deliveries.
  The flag is on the row fan-out locks, so a second server's fan-out re-checks it under the lock
  and skips the message; a check for existing deliveries could miss rows just committed and fan
  it out twice.
- **Lease guard.** The sender refuses a lease that isn't more than twice the request timeout: a
  send plus reading the answer can take one timeout, and recording comes after.
- **Leftovers settle with no endpoints.** The sender claims even when no endpoint is configured,
  so deliveries for removed endpoints fail instead of staying pending.
- **Admin check without applications.** Roles are organization-wide, so the outbox routes check
  the user's role directly (`isAdmin`), and work in a design with no applications.
