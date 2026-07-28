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
