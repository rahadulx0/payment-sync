# Support playbook

The ten questions that actually arrive, and how to answer each in under a minute. Every one starts the
same way: **get the `request_id` or the order id**, then open the transaction drill-down.

---

### 1. "Customer paid but the order is still pending"

Transactions → search the TrxID / amount / order id → open the SMS **decision trace**. It states the
cause in plain language. Most common: the SMS hasn't arrived yet (phone offline → §2), the TrxID was
mistyped (→ §3), or it's in review (→ §4).

### 2. "The app isn't capturing anything"

Admin → Devices → the offline banner. Check `has_sms_permission` and battery-optimisation state.
Full procedure: `docs/device-offline-playbook.md`. Ask the merchant to tap **Sync now** — it re-scans
the inbox and reports honestly what is still unsent.

### 3. "The customer typed the wrong transaction ID"

The client can fix it themselves while the order is pending or expired-in-grace:
`PATCH /payments/{order_id}/transaction-id` (ADR-14). It re-runs matching immediately. After the order
is VERIFIED it is deliberately refused — that path could consume a second payment.

### 4. "Why is this in manual review?"

Reviews → open it. The candidate cards show the score breakdown and the `why` lines. The two usual
reasons: **underpayment beyond tolerance** (never auto-verified, by design) or **ambiguity** — two
orders could match. Resolve by linking the right order (note required, audited) or dismissing.

### 5. "Signature mismatch on our webhook"

Almost always the **raw-body** pitfall: they parsed the JSON and re-serialised it before verifying.
Point them at `docs/webhook-verification/` and have them run `POST /webhooks/test` — it returns the
exact signature we sent plus the `v1` we computed, so they can diff against their own.

### 6. "The webhook never arrived"

Webhooks → filter their company. Check status and the attempt history. `FAILED` with `CLIENT_ERROR`
means their endpoint returned a 4xx (misconfiguration — we stop retrying by design). `DEAD` means the
retry budget is exhausted: fix their endpoint, then **replay dead** (dry-run first). Remind them the
poll fallback `GET /payments/{order_id}` exists precisely for this.

### 7. "We got the same webhook twice"

Expected and documented: delivery is **at-least-once**. They must deduplicate on
`X-PaySync-Event-Id`. That is in the integration guide and in every verifier snippet.

### 8. "Payment came in after the order expired"

Late matching within the grace window still verifies it, and the webhook carries `was_late: true`.
Their business logic should decide whether to honour it. Outside the grace window an order is never
revived — that is deliberate.

### 9. "Can you just mark this order as paid?"

Yes, but only through the audited path: resolve the review by linking, or verify manually from the SMS
drill-down. Both require a note and are recorded with your admin id. Never touch the database.
If a verification was made in error, use the **void** procedure (`docs/runbook.md`) — it reverts the
order and the SMS, with a mandatory reason.

### 10. "Is our data safe / what do you read?"

Only messages from bKash/Nagad/Upay sender addresses; everything else is discarded on the phone before
storage or logging. Send them `docs/privacy-policy.md` and the limitations one-pager
(`docs/client-agreement-notes.md`).

---

## What to ask for, every time

- From the **merchant**: Diagnostics → _Copy diagnostics for support_ (no message bodies, no token, no
  customer numbers — safe to paste anywhere).
- From the **client's developer**: the `request_id` from the error envelope, and the order id.

## What never to do

- Never edit the database directly to "fix" a payment. Use the review/void paths so the audit trail
  stays true.
- Never lower `auto_verify_min_confidence` to clear a review backlog. Get the client to collect a TrxID
  or `sender_msisdn` instead — that removes the ambiguity at the source.
- Never promise that funds settled. We assert a consistent SMS was received; that is the boundary.
