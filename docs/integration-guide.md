# Client integration guide

How a client website integrates with payment-sync. v1 is documented REST + OpenAPI + copy-paste
signature snippets (no SDK/plugin).

## 1. Register an order

When the buyer chooses bKash, register the pending order from your **backend** with your server key
(`psk_live_…`, never in a browser):

```
POST /api/v1/payments/register
Authorization: Bearer psk_live_…
X-Company-Id: <your company code>

{ "order_id": "ORD-123", "amount": "1500.00", "transaction_id": "DA56RP7N7C",
  "provider": "BKASH", "callback_url": "https://you.example.com/paysync/webhook" }
```

- `transaction_id` present → **exact** matching (recommended). Absent → heuristic (amount + time
  window + sender), which is deliberately conservative.
- Amounts are decimal **strings** (`"1500.00"`), never floats.
- If the buyer mistypes the TrxID, correct it while the order is still pending:
  `PATCH /api/v1/payments/{order_id}/transaction-id`.

## 2. Receive the webhook

On a match we `POST` a signed event to your `callback_url`. See
[`webhook-verification/`](./webhook-verification/README.md) for drop-in verifiers (PHP/Node/Python)
and framework snippets.

The rule, in one line:

```
v1 = HMAC_SHA256(secret, "{t}.{raw_body}")   # header: X-PaySync-Signature: t=…,v1=…[,v0=…]
```

- **Verify over the raw request body, before JSON parsing.**
- Reject if `|now − t| > 300s`.
- During a secret rotation both `v1` (new) and `v0` (old) are sent for 7 days — accept either.
- Use `X-PaySync-Event-Id` for **idempotency**; you may receive the same event more than once.
- Respond `2xx` quickly. Non-2xx is retried on a schedule (30s → 24h, 8 attempts). **Redirects are
  not followed** — point the callback directly at your handler.

Event types: `payment.verified`, `payment.expired`, `payment.review_required`, `test.ping`.

## 3. Test your endpoint

```
POST /api/v1/webhooks/test   (server key)
{ "callback_url": "https://you.example.com/paysync/webhook" }
```

Delivers a `test.ping` synchronously and returns the status, latency, the exact signature we sent, and
the `v1` we computed — diff it against your own to debug a mismatch without a support ticket.

## 4. Poll as a fallback

Webhooks can fail (downtime, firewall, TLS). `GET /api/v1/payments/{order_id}` always returns the
current status, so an order is never stuck "paid but not marked".

## 5. What to collect at checkout (read this one)

This single decision determines how well verification works for you.

| You collect                | What happens                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TrxID** (best)           | Exact match. Deterministic, immediate, no ambiguity                                                                                                                                                                       |
| **Sender's mobile number** | Heuristic match is safe — the sender disambiguates two customers paying the same amount                                                                                                                                   |
| **Both** (ideal)           | Exact match, with a safe fallback if the customer mistypes the TrxID                                                                                                                                                      |
| **Neither**                | Verification falls back to amount + time window. Two customers paying the same amount inside that window is genuinely ambiguous — we send it to **manual review** rather than guess. That means a delay for your customer |

Send `sender_msisdn` **even when you collect a TrxID**. A mistyped TrxID is the single most common
real-world failure, and the sender number is what lets the fallback resolve it safely.

If the customer does mistype it, you can correct it yourself while the order is pending:
`PATCH /api/v1/payments/{order_id}/transaction-id`. It re-runs matching immediately.

## 6. Reconcile

- `GET /api/v1/payments/{order_id}` — the poll fallback. Webhooks fail (downtime, firewall, bad TLS);
  this is why an order is never stuck "paid but not marked".
- `GET /api/v1/payments` — list with a `summary` (`count_by_status`, `total_verified_amount`) for
  end-of-day reconciliation.
- Two fields worth handling in your business logic:
  - `was_late: true` — the payment arrived after the order expired but inside the grace window. You
    decide whether to honour it.
  - `verification_method` — `EXACT_TXN_ID`, `HEURISTIC_AMOUNT_WINDOW`, or `MANUAL_ADMIN` (an operator
    resolved it by hand).

## 7. Retry schedule

Non-2xx webhook responses are retried on this schedule, with ±20% jitter, up to 8 attempts:

`30s → 2m → 10m → 30m → 2h → 6h → 12h → 24h`

- `4xx` (other than 408/425/429) **stops** retries — we treat it as a misconfiguration, not a blip.
- `410 Gone` cancels the event entirely.
- `429` honours your `Retry-After`.
- Redirects are **not** followed. Point the callback directly at your handler.

## 8. Troubleshooting

| Symptom                       | Cause, almost always                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| "Signature mismatch"          | You parsed the JSON and re-serialised it. **Verify over the raw body**, before parsing                                     |
| "Webhook never arrived"       | Your endpoint returned a 4xx (we stop retrying), or the callback isn't publicly reachable https. Run `POST /webhooks/test` |
| "We got the same event twice" | Expected — delivery is at-least-once. Deduplicate on `X-PaySync-Event-Id`                                                  |
| "Order still pending"         | The SMS hasn't reached us yet (merchant's phone offline), or it's in manual review. Poll `GET /payments/{order_id}`        |

## 9. Limitations — what this platform asserts

When we mark an order verified, we assert exactly this:

> **A payment-confirmation SMS consistent with this order was received on the merchant's registered
> phone.**

We are **not** a payment processor. We never touch, hold, or move funds. We do not confirm that money
settled, and we cannot reverse or dispute a payment. The merchant's own reconciliation against their
bKash statement remains their responsibility. See `client-agreement-notes.md`.
