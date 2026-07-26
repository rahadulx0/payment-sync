# Task 09 — Webhook Delivery Subsystem

| | |
|---|---|
| **Track** | Core — **money-critical gate** |
| **Depends on** | 08 |
| **Unblocks** | 10, 14 (visibility), 17 |
| **Est. effort** | 4–5 days |
| **Risk** | High — this is the client's only automatic signal; a signature or retry bug means orders never get marked paid |

---

## 1. Objective

Implement the webhook subsystem from `architecture.md §10`: HMAC signing with replay protection and
rotation support, the delivery worker with its retry schedule and circuit breaker, delivery history,
admin retry/replay, the `test.ping` endpoint, and the published reference verifiers.

At the end of this task the full happy path from `architecture.md §5.1` runs end to end: order
registered → SMS uploaded → matched → **signed webhook delivered to the client**.

---

## 2. Scope of work

### In scope
- `WebhookSigner` using the single shared HMAC implementation from `packages/shared`.
- Event creation for `payment.verified`, `payment.expired`, `payment.review_required`, `test.ping`.
- BullMQ delivery worker: timeout, retry schedule, error classification, DLQ.
- Orphan sweeper (`PENDING` events whose enqueue was lost).
- Per-company concurrency cap and circuit breaker.
- Dual-signing during webhook-secret rotation (`v1` + `v0`).
- SSRF re-validation and IP-pinned connections at send time.
- Delivery history with redaction; admin retry / bulk replay; paused-company handling.
- `POST /webhooks/test` implementation; reference verifiers in PHP/Node/Python executed in CI.

### Out of scope
- Dashboard webhook screens → Task 12.
- Client-facing docs polish → Task 17 (snippets are written here, prose is finalised there).
- Merchant WhatsApp/Telegram notifications → post-v1.

---

## 3. Prerequisites

- Task 08: `webhook_events` created inside the verifying transaction, post-commit enqueue point.
- Task 07: `SafeUrlService` + `pinned-lookup.ts`, `POST /webhooks/test` shell.
- Task 04: webhook secret storage with `prev` slot and rotation endpoint.
- Task 01: `signWebhook`/`verifyWebhook` + golden vectors.

---

## 4. Implementation steps

### 4.1 Payload & signing (`modules/webhooks/signing/`)
1. Payload exactly as `architecture.md §10.1`, built **once** when the event row is created and stored
   frozen in `webhook_events.payload`. Retries re-send the identical bytes — never re-serialise
   (JSON key order changes would invalidate a client's signature check).
   - Store the canonical `raw_body` string alongside the parsed jsonb (add `payload_raw text` in this
     task's migration) so signing is byte-exact across attempts and processes.
2. Headers per `architecture.md §10.1`: `X-PaySync-Event-Id`, `-Event-Type`, `-Timestamp`,
   `-Signature`, `-Attempt`, plus `Content-Type`, `User-Agent`, `X-Request-Id`.
3. `X-PaySync-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC_SHA256(secret, "{t}.{raw_body}")`.
   **`t` is generated per attempt**, so each retry has a fresh timestamp within the client's 5-minute
   tolerance — a fixed `t` would make every retry fail replay checks after 5 minutes, which is a
   subtle and very expensive bug.
4. **Rotation**: if `webhook_secret_prev_enc` is set and `webhook_secret_rotated_at` is within 7 days,
   emit `t=…,v1=<new>,v0=<old>`. A Task 16 job clears `prev` after the window.
5. Signing uses `packages/shared/hmac.ts` — no local reimplementation; a test asserts the produced
   header matches the committed golden vectors.

### 4.2 Event creation (`modules/webhooks/events/`)
- `WebhookEventService.create(tx, {companyId, type, paymentRequestId, data})` — called **inside**
  callers' transactions (Task 08 verification, Task 07 expiry, Task 10 review).
- Resolves the effective callback URL: order's `callback_url` → company `default_callback_url`;
  none → event `CANCELLED` with `reason: NO_CALLBACK_URL` + a P3 alert (silently dropping would hide
  a misconfigured client).
- Sets `status = PENDING`, `attempt_count = 0`, `next_attempt_at = now`.
- Suppression rules: `payment.expired` only when `notify_on_expiry`; `payment.review_required` only
  when `notify_on_review`; company `SUSPENDED`/`DISABLED` → created but **paused** (`next_attempt_at`
  null, `status = PENDING`, `paused: true`), released on reactivation (the hook left in Task 04).

### 4.3 Delivery worker (`workers/webhook-delivery.processor.ts`)
```
process(event_id):
  load event (FOR UPDATE SKIP LOCKED semantics via a claim update); if not PENDING → return
  if company not ACTIVE → leave paused, return
  url = SafeUrlService.revalidate(event.callback_url)       # DNS may have changed since register
  attempt = event.attempt_count + 1
  t = now; sig = sign(secret(s), t, event.payload_raw)
  POST with: pinned IP lookup, timeout = settings.webhook_timeout_ms,
             maxRedirects 0, no proxy, Content-Length set, HTTP/1.1 keep-alive off
  classify(response | error) → outcome
  INSERT webhook_deliveries (attempt, url, headers redacted, status, body ≤2KB, error_class, duration)
  update event: DELIVERED | schedule next attempt | FAILED | DEAD | CANCELLED
```

**Classification and policy** (`architecture.md §10.2`):
| Outcome | Action |
|---|---|
| 2xx | `DELIVERED`, `delivered_at` set, circuit breaker reset |
| 408, 425, 429 | retry (honour `Retry-After` when present and sane, ≤1 h) |
| Other 4xx | **stop retrying** → `FAILED` + `reason: CLIENT_ERROR` + P3 alert (misconfiguration) |
| 410 Gone | `CANCELLED` — client explicitly says stop |
| 3xx | `FAILED` + `error_class: BAD_BODY` (redirects not followed, documented) |
| 5xx | retry per schedule |
| DNS / TLS / timeout / conn refused | retry per schedule, `error_class` recorded |
| SSRF re-validation failure | `FAILED` + `reason: UNSAFE_CALLBACK_URL` + P2 alert |

**Retry schedule**: `30s, 2m, 10m, 30m, 2h, 6h, 12h, 24h` (≈45 h over 8 attempts, capped by
`webhook_max_attempts`) with ±20% jitter. Implemented as explicit delays derived from
`attempt_count`, persisted in `next_attempt_at` — **not** BullMQ's opaque backoff — so the schedule is
inspectable in the dashboard and survives a Redis flush.

**Concurrency & fairness**: worker concurrency 20 globally; a Redis-based per-company semaphore caps
in-flight deliveries at 5 (`architecture.md §10.2`) so one slow client cannot starve others.

**Circuit breaker**: 10 consecutive failures for a company → `webhook_endpoint_state = OPEN`,
subsequent attempts spaced ≥1 h, flag `WEBHOOK_ENDPOINT_DOWN`, notify the company contact email once
per open period, P2 alert. First success closes it and restores the normal schedule.

### 4.4 Orphan sweeper (`workers/webhook-sweeper.processor.ts`)
Every 60 s: claim `webhook_events` with `status = PENDING`, `next_attempt_at <= now`, not paused,
`SKIP LOCKED`, batch 200 → enqueue. This is what makes delivery at-least-once even if the process
died between commit and enqueue (`architecture.md §14`). A test kills the enqueue path and asserts the
sweeper still delivers.

### 4.5 Dead letters & admin actions
- After `webhook_max_attempts` → `DEAD`, P1 alert (`architecture.md §15.3`), client contact emailed.
- `POST /admin/webhooks/events/:id/retry` — resets `attempt_count`? **No**: appends a new attempt with
  `manual: true`, preserving history; audited.
- `POST /admin/webhooks/replay-dead?company_id=&from=&to=` — bulk requeue with a dry-run count first;
  audited, rate-limited, chunked.
- `GET /admin/webhooks/events` (filters: company, status, type, date, `q` on order id) and
  `GET /admin/webhooks/events/:id/deliveries` (full attempt history).
- `GET /admin/webhooks/endpoint-health?company_id=` — success rate, p95 latency, breaker state,
  consecutive failures, last success.

### 4.6 `POST /webhooks/test`
Replace the Task 07 shell: builds a `test.ping` event with a fixed sample payload shape, signs and
delivers it **synchronously** (single attempt, 8 s timeout) and returns the full result —
status code, response body excerpt, latency, and the exact signature header sent, plus the expected
`v1` value so a client can diff their computation against ours. This one endpoint removes most
integration support load.

### 4.7 Reference verifiers (`docs/webhook-verification/`)
Working, minimal implementations that read the raw body and verify the header:
`verify.php`, `verify.js`, `verify.py`, plus a Laravel middleware snippet and a WooCommerce/WordPress
`rest_api_init` example (snippet only — no plugin, per the chosen scope).
Each demonstrates: raw-body access, constant-time compare, timestamp tolerance, `event_id`
idempotency, and `v0` fallback during rotation.
**CI executes all three** against payloads generated by the API's signer (a small docker step with
`php`, `node`, `python`) — this is what guarantees the published snippets actually work.

### 4.8 Metrics
`webhook_attempts_total{status,error_class}`, `webhook_delivery_latency_seconds`,
`webhook_events_total{type}`, `webhook_dead_total`, `webhook_queue_depth`,
`webhook_breaker_open_gauge{company}`, `webhook_time_to_delivery_seconds`
(verified_at → delivered_at — the number that matters to a merchant).

---

## 5. Files created / modified

```
apps/api/src/modules/webhooks/{webhooks.module.ts,event.service.ts,payload.builder.ts,
                               signing/signer.service.ts,delivery/delivery.service.ts,
                               delivery/classify.ts,delivery/schedule.ts,delivery/breaker.service.ts,
                               delivery/company-semaphore.ts,admin/webhooks-admin.controller.ts,
                               webhook-test.controller.ts,dto/*.ts}
apps/api/src/workers/{webhook-delivery.processor.ts,webhook-sweeper.processor.ts}
apps/api/prisma/migrations/000X_webhook_payload_raw_and_breaker/migration.sql
apps/api/test/unit/webhooks/{signer.spec.ts,classify.spec.ts,schedule.spec.ts}
apps/api/test/integration/webhooks/{delivery.spec.ts,retry.spec.ts,breaker.spec.ts,
                                    sweeper.spec.ts,rotation.spec.ts,paused-company.spec.ts}
apps/api/test/e2e/journey-verified-to-webhook.e2e-spec.ts
apps/api/test/helpers/webhook-receiver.ts     # configurable local receiver (2xx/4xx/5xx/slow/redirect)
docs/webhook-verification/{verify.php,verify.js,verify.py,laravel-middleware.php,wordpress.php,README.md}
.github/workflows/ci.yml                      # + verifier-execution job
docs/integration-guide.md                     # webhook section
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Signature correctness** | Matches Task 01 golden vectors; all three reference verifiers accept a real generated payload **in CI**; a one-byte body change is rejected; a tampered `t` is rejected; JSON re-serialisation is proven irrelevant because `payload_raw` is used. |
| Replay protection | Verifier rejects a payload older than 5 min; each retry carries a fresh `t` and passes; a captured-and-replayed request beyond tolerance fails (`architecture.md §13.1 T3`). |
| Rotation | After `webhook-secret/rotate`: header contains both `v1` and `v0`; a verifier holding only the old secret still passes via `v0`; after the 7-day window (clock-advanced) only `v1` is sent. |
| Retry schedule | Receiver returns 500 → attempts occur at the documented offsets (fake timers / injected clock), jitter within ±20%, `attempt_count` and `next_attempt_at` persisted; after max attempts → `DEAD` + alert. |
| Early stop | Receiver returns 404 → exactly one attempt, `FAILED`, P3 alert; 410 → `CANCELLED`; 429 with `Retry-After: 60` → next attempt ≈60 s. |
| Timeout | Receiver sleeps 20 s with `webhook_timeout_ms = 8000` → timeout classified, connection aborted, no socket leak (assert handle count stable over 50 attempts). |
| Redirect | Receiver 302s to another host → `FAILED`/`BAD_BODY`, not followed. |
| SSRF at send time | Callback host re-resolves to `127.0.0.1` after registration → `FAILED`/`UNSAFE_CALLBACK_URL`, P2 alert, request never sent (assert the receiver saw nothing). |
| **Orphan recovery** | Create a verification with the enqueue path stubbed to throw → sweeper delivers within 60 s. Kill the worker mid-attempt → event is re-claimed and delivered, and the client receives at most one *successful* delivery (idempotency by `event_id` is the client's contract; assert we never mark `DELIVERED` twice). |
| Ordering & duplication | A verified order produces exactly one event; two rapid state changes produce two distinct `event_id`s; no duplicate `DELIVERED` rows. |
| Concurrency fairness | One company's receiver sleeping 8 s × 50 events does not delay another company's deliveries beyond p95 + 1 s. |
| Breaker | 10 consecutive failures → OPEN, spacing ≥1 h, one notification email; first success closes it and resumes normal schedule. |
| Paused company | `SUSPENDED` → events created, nothing delivered; reactivation releases and delivers them in order. |
| Redaction | `webhook_deliveries.request_headers` contains no signature secret material and no `Authorization`; response bodies truncated at 2 KB. |
| Admin actions | Manual retry appends an attempt and preserves history; `replay-dead` dry-run count matches the actual replay; both audited. |
| `/webhooks/test` | Returns status, latency, body excerpt, sent signature, and expected `v1`; works against a receiver that deliberately computes the signature wrongly, and the response makes the mismatch obvious. |
| **Full journey** | `architecture.md §5.1` end to end against the local receiver: register → upload → verified → delivered, asserting the receiver got a valid signature and correct payload fields, and `webhook_time_to_delivery_seconds` recorded. |

**Smoke demo:** run the full journey against `webhook-receiver.ts` with logging on; then break the
receiver (500) and show the retry schedule progressing in `webhook_deliveries`; then fix it and show
manual retry succeeding; finally run `php docs/webhook-verification/verify.php` against a captured
payload and show it printing `OK`.

---

## 7. Acceptance criteria

- [ ] Payload is frozen at event creation (`payload_raw`) and byte-identical across every attempt.
- [ ] Signature format is `t=…,v1=…` over `"{t}.{raw_body}"`, with a fresh `t` per attempt; matches golden vectors.
- [ ] All three reference verifiers (PHP/Node/Python) execute in CI against generated payloads and pass, including the `v0` rotation case.
- [ ] Retry schedule matches `architecture.md §10.2` exactly, is persisted in `next_attempt_at`, and is inspectable; jitter applied.
- [ ] Error classification implements every row of the §4.3 table, including 4xx early-stop and 410 cancel.
- [ ] Redirects are not followed; SSRF is re-validated at send time with IP-pinned connections, proven by test.
- [ ] Orphan sweeper delivers events whose enqueue was lost; worker kill mid-flight results in delivery without a duplicate `DELIVERED`.
- [ ] Per-company concurrency cap prevents cross-tenant starvation, demonstrated with a timing assertion.
- [ ] Circuit breaker opens/closes as specified, with one notification per open period.
- [ ] `SUSPENDED` companies pause delivery; reactivation releases queued events.
- [ ] Dead letters alert P1; admin retry and bulk replay work, preserve history, and are audited.
- [ ] `POST /webhooks/test` returns enough detail for a client to self-diagnose a signature mismatch.
- [ ] Delivery history is redacted and truncated as specified.
- [ ] All §4.8 metrics emitted; `webhook_time_to_delivery_seconds` visible end to end.
- [ ] The `architecture.md §5.1` journey passes as an automated E2E test.

---

## 8. Risks & notes

- **Fresh `t` per attempt** and **frozen `payload_raw`** are the two non-obvious requirements in this
  task. Getting either wrong produces failures that only appear on retries — i.e. only when a client
  is already having a bad day.
- Following redirects would reopen SSRF after all the register-time validation. The rule is: no
  redirects, ever, documented in the integration guide so clients don't configure one.
- CI-executing the PHP/Node/Python verifiers is unusual and worth the setup cost: these snippets are
  copy-pasted by every client, and a broken snippet generates support load that dwarfs the CI time.
- Don't reset `attempt_count` on manual retry. Support needs the full history to answer "how many
  times did you try?" — and a reset would also silently re-arm the 8-attempt budget.
- The circuit breaker protects *us*, not the client: without it, one client with a 30-second timeout
  endpoint can consume the whole worker pool. Verify the fairness test actually asserts wall-clock
  behaviour rather than just counting attempts.
