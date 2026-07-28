# Admin dashboard guide

How I operate the platform day to day. The dashboard (`apps/admin`, Next.js) is a thin client over the
Task 04 API — all authorization is server-side; the UI only renders and guides.

## Signing in

1. **Login** with email + password.
2. **TOTP** — on first login you enrol: scan the QR into an authenticator app and **save the 10
   recovery codes** (they are shown once). Thereafter, enter the 6-digit code.
3. The access token lives in memory only; a hard reload silently refreshes from the httpOnly cookie.
   After 30 minutes idle you are signed out.

Manage active sessions under **Sessions** — "Sign out everywhere" revokes every session (use it if a
laptop is lost).

## Onboarding a company

**Companies → New company.** Enter the business details and create. The next screen reveals four
secrets **once**:

- **Company code** — the client sends it in `X-Company-Id`.
- **Server key** (`psk_live_`) — the client's backend uses it; never put it in a browser or the app.
- **Device enroll key** (`pde_live_`) — used once to enrol the merchant's phone.
- **Webhook secret** (`whsec_`) — the client verifies webhook signatures with it.

**Download the onboarding packet** and confirm you saved them before leaving — losing a key means
rotating it, which takes the client's site down until they update it.

## Company operations

- **Status** — `Suspend` (SMS still ingested, new orders rejected, webhooks paused), `Disable`
  (everything stops, device tokens revoked), `Reactivate`. Each needs the company code typed and a
  reason; the inline text states the exact effect. Misreading this is a client outage.
- **Webhook test** — sends a signed `test.ping` and shows the status, latency, the exact signature
  sent, and the expected `v1`. This is the button that ends most integration support threads.

## Devices

The **offline-devices banner** at the top of every screen lists phones offline >30 min — the single
most important operational signal. A merchant with an offline phone is silently missing payments.

Per device: force-sync (applies at the next heartbeat, ≤15 min), rotate token, block/unblock, retire.
Check the telemetry panel for missing SMS permission or battery-optimisation exemption — the two most
common reliability problems.

## Audit log

Every mutation is recorded with before/after (secrets redacted). Filter by action and expand a row to
see the detail. Use the `request_id` shown in error toasts when raising a support thread.

## Notes

- The **environment badge** (top-left) is coloured — red `PRODUCTION`, amber `STAGING`. The same person
  operates both; check it before any destructive action.
- Everything the form validates is also validated server-side; the UI mirrors _bounds_, never _logic_.

## Operations screens (Task 12)

**Overview** opens with an **alert strip** — only what needs action (invariant violations, dead
webhooks, open reviews, unmatched SMS), each linking to the fix. When healthy it shows a single quiet
"all clear" with the `as_of` time.

### The 60-second diagnosis ("customer paid, order still pending")

1. **Transactions → search** the TrxID, MSISDN, order id, or a phrase from the SMS.
2. Open the SMS row to the **decision-trace** screen: raw message (left), server extraction (middle),
   and the `match_attempts` trace (right). The trace states the cause in plain language — e.g.
   "Ignored: this is an outgoing payment (Cash Out), not an incoming one", or the ranked candidate
   orders with their score breakdown and `why` lines for an ambiguous review.
3. Act from that screen: **Re-parse** (shows a diff, may trigger a rescan), or resolve via the
   **Review queue**.

### Review queue

Oldest first; a review past its SLA is shown in red. Open one to see the SMS beside the ranked
candidate orders (amount/Δ, score, `why`). **Link this order** verifies it (`MANUAL_ADMIN`, emits a
webhook); **Dismiss** returns the SMS to the pool. Both require a note and are audited; a conflicting
resolve (order changed in another tab) surfaces the conflict rather than double-crediting.

### Webhooks

Filter to `DEAD`/`FAILED`; open an event to see every delivery attempt with status, latency, and the
response excerpt. **Retry now** appends a fresh attempt (never resets the history). Endpoint health and
the circuit-breaker state live under the company.

### Parsers & Analytics

**Parsers** shows the parse-status distribution and the unparsed queue grouped by shape — the
parser-improvement workflow (see a shape → add a fixture → ship a rule). **Analytics** charts verified
volume, provider split, and verification methods, each with a CSV export of the underlying rows
(Excel-safe, amounts as text).
