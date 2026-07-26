# Task 07 — Client Payments API

| | |
|---|---|
| **Track** | Core |
| **Depends on** | 04 (can run in parallel with 05/06) |
| **Unblocks** | 08 |
| **Est. effort** | 3–4 days |
| **Risk** | Medium — this is the surface external developers integrate against; SSRF and idempotency mistakes are security issues |

---

## 1. Objective

Implement the client-website API from `architecture.md §7.3`: order registration, status polling,
cancellation, reconciliation listing, and the order-expiry lifecycle — including callback-URL
validation (SSRF defence) and idempotency semantics.

After this task a client website can register a pending payment and poll its status. Verification
itself arrives in Task 08.

---

## 2. Scope of work

### In scope
- `POST /payments/register` with idempotency (header key + natural key on `order_id`).
- `GET /payments/{order_id}`, `POST /payments/{order_id}/cancel`, `GET /payments` (cursor paging).
- Callback-URL validation and the reusable `SafeUrlService` (used again by Task 09 at send time).
- `match_mode` derivation, settings snapshotting, `expires_at` computation.
- Expiry sweeper job (`PENDING` → `EXPIRED`) with late-grace bookkeeping.
- `POST /webhooks/test` endpoint shell (payload + queueing wired in Task 09).
- Reverse-match hook (no-op here, implemented in Task 08).
- Client-facing error semantics and `docs/integration-guide.md` first draft.

### Out of scope
- Matching → Task 08. Webhook signing/delivery → Task 09.
- Merchant-facing dashboard, SDKs, WooCommerce plugin → post-v1 (`architecture.md §19`).

---

## 3. Prerequisites

- Task 04: companies, `SERVER` keys, `company_settings`.
- Task 03: `ServerKeyGuard`, idempotency interceptor, rate limiting, error envelope.

---

## 4. Implementation steps

### 4.1 `POST /payments/register`
Request per `architecture.md §7.3`: `{order_id, amount, transaction_id?, provider?,
sender_msisdn?, callback_url?, metadata?}`.

1. **Auth/scope**: `ServerKeyGuard` + `payments:write`; rate limit
   `company_settings.rate_limit_register_rpm`.
2. **Validation**
   - `order_id`: 1–80 chars, `[A-Za-z0-9._:-]+` (must be safe in URLs and logs).
   - `amount`: decimal string via `Money`, `> 0`, ≤ `99,999,999.99`. Reject bare numbers with more
     than 2 decimals rather than rounding — silent rounding of money is never acceptable.
   - `transaction_id`: normalised via `packages/parsers` (same normaliser as ingestion, so
     `8a7bcd1234` and `8A7BCD1234 ` match) — using a *different* normaliser here than in Task 05
     would be a silent matching failure, so import it, don't reimplement.
   - `provider` ∈ `company_settings.allowed_providers` when present.
   - `sender_msisdn` normalised to `+8801…`.
   - `metadata`: object, ≤4 KB serialised, no nested depth >5.
   - `callback_url`: required unless `company.default_callback_url` is set; validated per §4.2.
3. **Mode derivation**: `transaction_id` present → `match_mode = EXACT`; absent → `HEURISTIC`,
   and rejected with `VALIDATION_ERROR` (`heuristic_disabled`) when
   `company_settings.heuristic_enabled = false`.
4. **Snapshot** `amount_tolerance` from settings onto the row (per Task 02) and compute
   `expires_at = now + order_ttl_minutes`.
5. **Idempotency / conflict semantics** — spelled out because integrators hit this constantly:
   - `Idempotency-Key` + identical body → replay stored response (`Idempotency-Replayed: true`).
   - No key, same `order_id`, **identical** `{amount, transaction_id, provider, sender_msisdn}` →
     `200` with the existing resource (safe retry).
   - Same `order_id`, **different** payload → `409 DUPLICATE_ORDER_ID`.
   - Different `order_id`, same live `transaction_id` → `409 DUPLICATE_TRANSACTION_ID` (the partial
     unique index from Task 02 backs this; catch `P2002` and map it, don't pre-check-then-insert).
6. **Reverse-match hook**: `await this.matchingHook.onOrderRegistered(paymentRequest)` — no-op here
   returning `{status: 'PENDING'}`; Task 08 makes it scan `UNMATCHED` sms_logs and possibly return
   `VERIFIED` synchronously. The response DTO must already model `status: VERIFIED` plus an optional
   `verified_at`/`transaction_id` so Task 08 doesn't change the contract.
7. **Response** `201` (or `200` on safe retry): `{payment_request_id, order_id, status, match_mode,
   amount, transaction_id, expires_at, created_at}`.
8. Metrics: `payment_requests_total{mode,result}`, `register_duration_seconds`.

### 4.2 `SafeUrlService` — SSRF defence (`architecture.md §13.1 T7`)
Used at register time **and** re-run at send time in Task 09 (DNS can be re-pointed after registration).
1. Parse; require `https:` scheme, no credentials in the URL, no fragment, port 443 only
   (configurable allowlist for staging), hostname length ≤253.
2. Resolve A/AAAA records; **every** resolved address must be public: reject loopback,
   `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. `169.254.169.254`), `127/8`, `::1`, `fc00::/7`,
   `fe80::/10`, `0.0.0.0/8`, and multicast/reserved ranges.
3. Reject hostnames resolving to zero addresses, and `.local`/`.internal`/`.localhost` suffixes.
4. Return `{url, resolvedIps, checkedAt}`; Task 09's HTTP client **pins the connection to a validated
   IP** (custom `lookup`) so a DNS-rebind between check and connect can't slip through.
5. `follow_redirects: false` documented as a client-facing rule (a redirect to an internal host is
   the classic bypass) — surfaced as `error_class: BAD_BODY` if a client responds 3xx.

### 4.3 `GET /payments/{order_id}`
- Scope `payments:read`; tenant-scoped (another company's `order_id` → `404 ORDER_NOT_FOUND`, never 403 —
  don't confirm existence across tenants).
- Response: `{order_id, status, amount, transaction_id, provider, match_mode, expires_at,
  created_at, verified_at?, verification:{method, confidence, sender_msisdn, provider,
  received_amount, was_late}?, review:{reason, opened_at}?}`.
- **No raw SMS body** — clients get facts, not the merchant's message content (`architecture.md §10.1`).
- `Cache-Control: no-store`. Rate limit 600/min/company (polling is expected and legitimate).
- Documented as the webhook fallback; the integration guide recommends polling every 5 s for up to
  the order TTL, and reconciling via §4.5 thereafter.

### 4.4 `POST /payments/{order_id}/cancel`
- Only from `PENDING` (or `MANUAL_REVIEW` with `?force=true`, audited); otherwise
  `409 ORDER_NOT_PENDING` with the current status.
- Sets `CANCELLED`, frees the TrxID for reuse (the partial unique index excludes cancelled rows).
- Emits `payment.cancelled` **internally only** — no webhook (the client initiated it).
- Body `{reason?}` stored in `metadata.cancel_reason`.

### 4.5 `GET /payments` — reconciliation listing
- Filters: `status`, `from`/`to` (on `created_at` or `verified_at` via `date_field`), `provider`,
  `q` (exact `order_id`/`transaction_id`), cursor + `limit` ≤100.
- Deterministic ordering `(created_at DESC, id DESC)` with an opaque base64 cursor.
- Includes `summary:{count_by_status, total_verified_amount}` for the requested window — this is what
  makes end-of-day reconciliation a single call.

### 4.6 Expiry sweeper (`workers/expire-orders.processor.ts`)
- Repeatable BullMQ job every 60 s: `PENDING` and `expires_at < now` → `EXPIRED`, in batches of 500
  with `SKIP LOCKED`.
- Emits a `payment.expired` webhook event **only if** `company_settings` opts in
  (`notify_on_expiry`, default true) — clients want to release reserved stock. Event creation is
  hooked here, delivery in Task 09.
- Does **not** delete anything: an `EXPIRED` order remains matchable for
  `late_match_grace_hours` (`architecture.md §5.4`). The sweeper never touches rows outside the grace
  window either — a separate metric counts orders that aged out unmatched
  (`payment_requests_aged_out_total`).
- Idempotent and safe to run concurrently with matching (row-level locking; a test asserts an order
  being verified at the same instant doesn't get expired — the verify wins).

### 4.7 `POST /webhooks/test`
- Shell here: validates the callback URL, builds a `test.ping` payload, and calls a
  `WebhookQueue.enqueueTest()` port that is a no-op returning `{queued: false, reason: 'not_implemented'}`
  until Task 09. Endpoint shape, auth, and docs are final now so Task 09 only supplies the implementation.

### 4.8 Client-facing docs (first draft)
`docs/integration-guide.md`: the four-step integration (register → show payment instructions →
receive webhook → verify signature), the full error table with recommended client action, the
idempotency rules from §4.1.5, the polling fallback, and a worked example with `curl`. Finalised in
Task 17; drafting it now surfaces contract awkwardness while it's still cheap to fix.

---

## 5. Files created / modified

```
apps/api/src/modules/payments/{payments.module.ts,payments.controller.ts,payments.service.ts,
                               register.service.ts,payment-query.service.ts,cancel.service.ts,
                               expiry.service.ts,matching.hook.ts,dto/*.ts}
apps/api/src/common/http/{safe-url.service.ts,ip-range.ts,pinned-lookup.ts}
apps/api/src/modules/webhooks/webhook-test.controller.ts     # shell
apps/api/src/workers/expire-orders.processor.ts
apps/api/test/e2e/{payments-register.e2e-spec.ts,payments-idempotency.e2e-spec.ts,
                   payments-query.e2e-spec.ts,payments-cancel.e2e-spec.ts,
                   payments-expiry.e2e-spec.ts}
apps/api/test/unit/safe-url.spec.ts
docs/openapi.yaml  docs/integration-guide.md  docs/error-codes.md
```

---

## 6. Testing & validation

| What | How |
|---|---|
| Register happy paths | Exact mode with TrxID; heuristic mode without; `provider`/`sender_msisdn` normalisation asserted (`01712345678` → `+8801712345678`, lowercase TrxID uppercased). |
| Money validation | `'1250.00'`, `'1250'`, `1250` (number), `'1,250.00'`, `'0'`, `'-1'`, `'1250.005'`, `'1e5'`, `null` → each with the documented outcome; no float drift on round-trip through Postgres. |
| **Idempotency matrix** | All four cases in §4.1.5, plus two concurrent identical registers → exactly one row created and two consistent 2xx responses. |
| TrxID uniqueness | Second live order with the same TrxID → 409; after cancelling the first → succeeds; after the first is `VERIFIED` → still 409. |
| **SSRF suite** | `http://`, `https://localhost`, `https://127.0.0.1`, `https://169.254.169.254`, `https://10.0.0.5`, `https://[::1]`, `https://user:pw@host`, `https://host:8080`, a hostname resolving to a private IP (stubbed resolver), a hostname with mixed public+private records (must reject), `.internal` suffix, and a valid public URL (must accept). |
| Heuristic gate | `heuristic_enabled=false` + no TrxID → `VALIDATION_ERROR` naming the reason. |
| Settings snapshot | Register, change company tolerance, assert the order's `amount_tolerance` unchanged. |
| Status polling | `PENDING`/`CANCELLED`/`EXPIRED` shapes; cross-tenant `order_id` → 404; no `raw_message` anywhere in the response (assert by scanning the serialised body). |
| Cancel | From `PENDING` → OK; from `VERIFIED` → 409 with current status; from `CANCELLED` → idempotent 200; TrxID freed. |
| Listing | Cursor stability while new rows are inserted mid-pagination (no duplicates, no skips); `summary` totals reconcile against raw SQL; `limit` cap enforced. |
| Expiry | Order expires at the right minute; grace window keeps it matchable; concurrent verify-vs-expire → verify wins, no `EXPIRED` overwrite; sweeper handles 5000 rows without lock contention; `notify_on_expiry=false` creates no event. |
| Rate limit | Per-company override from settings respected; another company unaffected. |
| Contract | OpenAPI regenerated; `docs/integration-guide.md` walked through by someone who hasn't seen the code, using only `curl`. |

**Smoke demo:** register an order with `curl` using the seeded server key, poll it (PENDING), cancel
it, register another and let it expire (with `order_ttl_minutes` temporarily set to 1), showing the
sweeper transition in the logs and the poll response.

---

## 7. Acceptance criteria

- [ ] `POST /payments/register` implements both modes, full validation, and all four idempotency/conflict cases, including concurrent duplicates.
- [ ] TrxID normalisation uses the **same** normaliser as the parser package (imported, not reimplemented) — asserted by a test that feeds the same inputs to both paths.
- [ ] `SafeUrlService` rejects every case in the SSRF suite and accepts valid public HTTPS URLs; the pinned-lookup helper exists and is unit-tested for Task 09.
- [ ] `GET /payments/{order_id}` returns the documented shape, never leaks raw SMS content, and 404s across tenants.
- [ ] Cancel frees the TrxID and enforces state transitions; listing paginates deterministically with a correct summary.
- [ ] Expiry sweeper transitions orders on time, preserves the late-grace window, and loses a race to verification rather than overwriting it.
- [ ] `POST /webhooks/test` exists with final shape and a documented no-op until Task 09.
- [ ] Reverse-match hook interface in place with the response DTO already able to express `VERIFIED`.
- [ ] `docs/integration-guide.md` draft complete enough for an external developer to register and poll an order using only the doc.
- [ ] `docs/error-codes.md` covers every code this API can return, with recommended client action.

---

## 8. Risks & notes

- **The response DTO must already model `VERIFIED`** even though nothing can verify yet. Otherwise
  Task 08 changes the shape of a published endpoint, and any client integrated in between breaks.
- Register-time SSRF validation is necessary but not sufficient — DNS can be re-pointed afterwards.
  That is why `pinned-lookup.ts` ships here and Task 09 must use it. Validating only at register would
  be a false sense of security.
- Two live orders can legitimately have the same amount (the heuristic collision problem). This task
  does not prevent that — it is Task 10's scoring/penalty problem — but the listing endpoint should
  make such collisions visible to the client, which is why `summary` and `q` exist.
- Resist adding a "force verify" endpoint for clients, however often it is asked for. Manual
  verification stays admin-only and audited (`architecture.md §7.4`); a client-callable force-verify
  would make the platform's core assertion meaningless.
