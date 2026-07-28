# Verifying payment-sync webhooks

Every webhook is a `POST` with a JSON body and these headers:

| Header                 | Meaning                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| `X-PaySync-Event-Id`   | Unique event id — **use it for idempotency** (ignore ids you've seen).         |
| `X-PaySync-Event-Type` | `payment.verified`, `payment.expired`, `payment.review_required`, `test.ping`. |
| `X-PaySync-Timestamp`  | Unix seconds; also encoded inside the signature.                               |
| `X-PaySync-Signature`  | `t=<unix>,v1=<hex>[,v0=<hex>]`.                                                |
| `X-PaySync-Attempt`    | 1-based delivery attempt number.                                               |

## The rule

```
v1 = HMAC_SHA256(secret, "{t}.{raw_body}")
```

- Verify over the **raw request body**, before any JSON parsing or re-serialisation.
- Reject if `|now - t|` exceeds your tolerance (5 minutes is what we use).
- During a secret rotation the header carries both `v1` (new secret) and `v0` (old). Accept **either**
  for the 7-day rotation window; then drop the old secret.
- Compare in constant time (`hash_equals` / `crypto.timingSafeEqual` / `hmac.compare_digest`).
- Respond `2xx` fast. We retry non-2xx on a schedule (30s → 24h, 8 attempts). Redirects are **not**
  followed — point the callback URL directly at your handler.

## Self-test

`POST /webhooks/test` delivers a `test.ping` to your callback synchronously and returns the exact
signature we sent plus the `v1` we computed — diff it against your own to debug a mismatch.

## References

- `verify.php`, `verify.js`, `verify.py` — minimal, dependency-free verifiers (CI-executed against
  real generated payloads).
- `laravel-middleware.php`, `wordpress.php` — framework integration snippets (copy-paste, no plugin).
