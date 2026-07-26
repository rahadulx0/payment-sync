# Task 10 — Heuristic Matching, Review Queue & Analytics API

| | |
|---|---|
| **Track** | Core — **money-critical gate** |
| **Depends on** | 09 |
| **Unblocks** | 12, 16 (full) |
| **Est. effort** | 5–6 days |
| **Risk** | **Highest of the backend tasks** — this is the only path that can verify a payment without a transaction ID |

---

## 1. Objective

Implement the fallback matching path from `architecture.md §9.2 (step 2)` and `§9.3`: candidate
scanning by amount + time window + sender, confidence scoring with collision penalties, the manual
review queue and its resolution flow, and the analytics API that the dashboard and daily operations
depend on.

The governing principle: **a review queue is cheaper than a false verification.** Ambiguity must never
be resolved by guessing.

---

## 2. Scope of work

### In scope
- Heuristic candidate query + scoring implementation of `architecture.md §9.3`.
- Auto-verify threshold and top-vs-runner-up gap rules.
- Review creation (all five reasons), listing, and resolution (link / dismiss) with audit + webhook.
- Reverse heuristic matching at register time.
- Adversarial collision test suite proving zero false verifications.
- Per-company tuning knobs already defined in `company_settings`.
- Analytics API: overview, providers, daily, funnel, parser-health, latency.
- `payment.review_required` webhook emission.

### Out of scope
- Review UI → Task 12 (endpoints and semantics are final here).
- Fraud-rules engine, ML scoring → post-v1 (`architecture.md §19`).
- OCR matching → post-v1.

---

## 3. Prerequisites

- Task 08: pure core with the `heuristicPass` extension point, transactional runner, trace, invariants.
- Task 09: webhook events so a resolved review notifies the client.
- Task 04: `company_settings` bounds (`heuristic_enabled`, window, tolerance, threshold,
  `require_sender_match`).

---

## 4. Implementation steps

### 4.1 Candidate query (`modules/matching/heuristic/candidate.query.ts`)
Exactly the predicate from `architecture.md §9.2`:
```sql
SELECT * FROM payment_requests
 WHERE company_id = $1
   AND status = 'PENDING'
   AND transaction_id IS NULL          -- never steal an order that is in EXACT mode
   AND ABS(expected_amount - $amount) <= amount_tolerance
   AND $sms_time BETWEEN created_at - INTERVAL '5 minutes'
                     AND created_at + make_interval(mins => heuristic_window_minutes)
   AND (expected_provider IS NULL OR expected_provider = $provider)
   AND ($require_sender_match = false OR expected_sender_msisdn = $sender)
 ORDER BY created_at DESC
 LIMIT 50
 FOR UPDATE
```
Notes that must be respected:
- `transaction_id IS NULL` is load-bearing: an exact-mode order must never be verified by a
  heuristic match, or a customer's mistyped TrxID could silently consume someone else's payment.
- The `LIMIT 50` is a safety bound; hitting it is itself a signal (metric
  `heuristic_candidate_cap_hit_total`) that the window/tolerance is too loose for that tenant.
- Uses the Task 02 index `(company_id, expected_amount, created_at) WHERE status='PENDING'`;
  verify the plan under load.

### 4.2 Scoring (`modules/matching/heuristic/score.ts`) — pure
Implement `architecture.md §9.3` verbatim, returning a per-signal breakdown for the trace:

```ts
score = 0.45 * amountScore      // 1.0 exact; linear decay to 0 across the tolerance band
      + 0.30 * senderScore      // 1 if expected_sender_msisdn === sms.senderMsisdn, else 0
      + 0.15 * timeScore        // linear decay across heuristic_window_minutes
      + 0.10 * providerScore    // 1 if expected_provider === sms.provider (or unspecified → 0.5)
      - 0.30 * collisionPenalty // another PENDING order with the same amount in-window exists
      - 0.10 * roundAmountPenalty // amount ∈ {50,100,200,500,1000,1500,2000,5000} AND >1 candidate
clamped to [0, 1]
```
Return `{score, signals: {amount, sender, time, provider, collision, roundAmount}, why: string[]}`.
The `why` strings are shown verbatim in the Task 12 review UI — write them for a human reading them
six weeks later, not for a developer debugging today.

### 4.3 Decision rules (in the pure core, extending Task 08)
```
candidates = scored, sorted desc
0 candidates                                    → UNMATCHED
1 candidate:
    score >= auto_verify_min_confidence         → VERIFIED (HEURISTIC_AMOUNT_WINDOW, confidence=score)
    else                                        → REVIEW (AMBIGUOUS_CANDIDATES)
>1 candidates:
    top >= threshold AND (top - runnerUp) >= 0.25 → VERIFIED
    else                                          → REVIEW with the full ranked snapshot
```
Additional hard rules:
- `heuristic_enabled = false` → never enter this pass (guard `HEURISTIC_DISABLED`).
- An SMS with a TrxID that found no exact match **may** still enter the heuristic pass, but only
  against `transaction_id IS NULL` orders — and any such verification is flagged
  `VERIFIED_HEURISTIC_DESPITE_TRXID` for review visibility, because it often means the customer typed
  a wrong TrxID on a different order.
- Underpayment beyond tolerance can never be verified here either (inherited from Task 08).
- A single SMS can satisfy at most one order, and the DB constraints still backstop it.

### 4.4 Reverse heuristic matching (register time)
Extend Task 08's `onOrderRegistered`: for a `HEURISTIC`-mode order, scan `UNMATCHED` sms_logs with
`amount` within tolerance and `sms_timestamp` within `[now - window, now + 5min]`, score them with the
same function (roles swapped), and apply the same thresholds. Bounded to 50 candidates,
newest first. A register can therefore return `VERIFIED` for a customer who paid before submitting.

### 4.5 Review queue (`modules/reviews/`)
1. Creation (Task 08 already writes rows; extend to all reasons):
   `AMBIGUOUS_CANDIDATES`, `AMOUNT_MISMATCH`, `DUPLICATE_TXN_ID`, `SUSPICIOUS_SMS`,
   `UNPARSED_MESSAGE` (opened by a Task 05 hook when an `UNPARSED` message is >1 h old and the company
   has pending orders — otherwise unparsed messages would sit invisible).
   The `candidates` jsonb snapshot stores scores + signals + `why` at detection time, so a later
   settings change doesn't rewrite history.
2. `GET /admin/reviews?status=OPEN&company_id=&reason=` — cursor paged, oldest first, with an
   `age_minutes` field and the full candidate snapshot.
3. `POST /admin/reviews/:id/resolve` — body is one of:
   - `{link_sms_log_id, link_payment_request_id, note}` → verify via the Task 08 `apply()` path with
     `verification_method = MANUAL_ADMIN`, `confidence` = the snapshot score (or 1.0 if the admin
     asserts an exact link), `matched_by_admin_id` set. Emits `payment.verified` with
     `verification_method: MANUAL_ADMIN`.
   - `{dismiss_reason, note}` → review `DISMISSED`; SMS → `UNMATCHED` (so it stays eligible for a
     future order) or `IGNORED` if the admin says it isn't a payment; order stays `PENDING`.
   Mandatory `note` on every resolution; audited; idempotent (resolving twice → 409 with the existing
   resolution).
4. Guard rails: resolution re-validates current state inside the transaction — if the order was
   verified or cancelled in the meantime, the resolve fails with a clear conflict rather than
   double-crediting.
5. `GET /admin/reviews/stats` — open count, median age, count by reason, by company (drives the
   dashboard tile and the Task 16 P3 alert at >10 open).
6. SLA signal: a review open longer than `review_sla_minutes` (new setting, default 30) increments
   `reviews_breaching_sla` and alerts P2 — an unattended review queue is a merchant with unfulfilled
   paid orders.

### 4.6 Analytics API (`modules/analytics/`)
All endpoints admin-only, tenant-filterable, timezone-aware (`Asia/Dhaka` day boundaries), served from
SQL aggregates with a short Redis cache (60 s) and an explicit `as_of` field in every response.

| Endpoint | Contents |
|---|---|
| `GET /admin/analytics/overview?range=` | verified count + amount (today/7d/30d), success rate, median & p95 verification latency, median SMS→webhook latency, unmatched count, open reviews, dead webhooks, devices offline, active companies |
| `GET /admin/analytics/providers?range=` | per provider: SMS received, parsed, ignored, matched, verified amount, parse-failure rate |
| `GET /admin/analytics/daily?range=&company_id=` | per Dhaka day: registered, verified, expired, cancelled, reviewed, amount, success rate |
| `GET /admin/analytics/funnel?range=` | registered → SMS seen → matched → webhook delivered, with drop-off counts and the top three drop-off reasons at each stage |
| `GET /admin/analytics/parser-health` | from Task 05 (exposed here for the dashboard) |
| `GET /admin/analytics/verification-methods?range=` | split by `EXACT_TXN_ID` / `HEURISTIC_AMOUNT_WINDOW` / `MANUAL_ADMIN`, with mean confidence |
| `GET /admin/analytics/companies?range=` | league table: volume, success rate, webhook health, device liveness — the "which client needs attention" view |

Implementation notes: hand-written SQL (not Prisma aggregate chains) in a `queries/` folder, each with
a matching test that reconciles it against a naive count over seeded data. Add covering indexes as the
`EXPLAIN` requires; document any query slower than 500 ms at 1M rows and pre-aggregate it into a
daily rollup table if needed (`analytics_daily_rollup`, refreshed by a Task 16 job).

### 4.7 Metrics
`heuristic_decisions_total{result}`, `heuristic_score_histogram`,
`heuristic_candidate_count_histogram`, `heuristic_candidate_cap_hit_total`,
`reviews_open_gauge{reason}`, `reviews_age_seconds`, `reviews_resolved_total{resolution}`,
`false_verify_suspicion_total` (voided verifications, from Task 08's void endpoint — the closest
available proxy for a false-positive rate).

---

## 5. Files created / modified

```
apps/api/src/modules/matching/heuristic/{heuristic.strategy.ts,candidate.query.ts,score.ts,
                                         collision.ts,reverse-heuristic.service.ts}
apps/api/src/modules/matching/core/decide.ts            # wire the real heuristic port
apps/api/src/modules/reviews/{reviews.module.ts,reviews.controller.ts,reviews.service.ts,
                              resolve.service.ts,review-stats.service.ts,dto/*.ts}
apps/api/src/modules/analytics/{analytics.module.ts,analytics.controller.ts,
                                queries/{overview.sql.ts,providers.sql.ts,daily.sql.ts,
                                         funnel.sql.ts,methods.sql.ts,companies.sql.ts},
                                rollup.service.ts,cache.ts}
apps/api/src/workers/analytics-rollup.processor.ts
apps/api/prisma/migrations/000X_review_sla_and_rollup/migration.sql
apps/api/test/unit/heuristic/{score.spec.ts,decision-rules.spec.ts,collision.spec.ts}
apps/api/test/integration/heuristic/{candidate-query.spec.ts,adversarial.spec.ts,
                                     reverse-heuristic.spec.ts,review-resolve.spec.ts}
apps/api/test/integration/analytics/reconcile.spec.ts
apps/api/test/e2e/journey-heuristic-match.e2e-spec.ts
docs/matching.md            # heuristic section, tuning guidance per client
docs/runbook.md             # how to work the review queue
```

---

## 6. Testing & validation

### 6.1 Scoring unit matrix
Table-driven over: exact vs within-tolerance amount; sender match / mismatch / absent; time at 0%,
50%, 99%, 101% of window; provider match / mismatch / unspecified; collision present / absent; round
amount with 1 vs 3 candidates. Assert exact scores against hand-computed values (so a weight change
is a deliberate, visible test edit) and assert monotonicity: improving any signal never lowers the score.

### 6.2 Adversarial collision suite (the core deliverable of this task)
Each scenario asserts **no false verification**:
| Scenario | Expected |
|---|---|
| Two PENDING orders, same amount, same minute, no sender info | REVIEW, both candidates in the snapshot |
| Same as above but only one has a matching `expected_sender_msisdn` | VERIFIED (gap ≥0.25) — assert the *correct* one |
| Three orders, same amount, spread across the window | REVIEW |
| One order at 1000.00, SMS at 1000.00, another order at 1000.00 created 1 s later | REVIEW |
| SMS amount inside tolerance of two orders with different amounts | REVIEW |
| Popular round amount (500) with 2 candidates | REVIEW (round penalty pushes below threshold) |
| Single candidate at exactly `auto_verify_min_confidence` | VERIFIED (inclusive boundary, documented) |
| Single candidate one hundredth below threshold | REVIEW |
| Candidate window boundary: SMS exactly at `created_at + window` | included; one second later → excluded |
| SMS with a TrxID, no exact match, heuristic candidate available | VERIFIED with the `DESPITE_TRXID` flag, or REVIEW if below threshold — never silent |
| Exact-mode order (has TrxID) with a matching amount | **never** heuristically verified |
| `heuristic_enabled = false` | UNMATCHED, guard recorded |
| 60 candidates (cap 50) | REVIEW + `candidate_cap_hit` metric — never an arbitrary pick |
| Two SMS, one order, both in tolerance | exactly one verification; the other stays `UNMATCHED` |
| Duplicate customer paying twice for one order | one verifies, the second → REVIEW/`UNMATCHED`, never a second credit |

Plus a randomised soak: 500 orders and 500 SMS with deliberately colliding amounts over 2 h of
simulated time, run concurrently; assertions — zero invariant violations, every verification's
`amount_delta` within tolerance, and every verified pair independently re-derivable from the trace.

### 6.3 Review flow
Creation for all five reasons; the Task 02 open-review unique index prevents duplicates across
rescans; resolve-by-link verifies and emits a webhook with `MANUAL_ADMIN`; resolve-by-dismiss leaves
the SMS re-matchable; double resolve → 409; resolving a review whose order was cancelled in the
meantime → conflict, no verification; every resolution audited with a note; SLA metric increments.

### 6.4 Analytics
Each query reconciled against a naive computation over seeded data (including a day-boundary case at
23:59 and 00:01 Dhaka); `as_of` present; cache returns consistent values within its TTL and refreshes
after; `EXPLAIN` recorded for each query at 1M `sms_logs` / 200k orders; any query >500 ms is
pre-aggregated and the rollup path is tested for correctness against the live query.

**Smoke demo:** register two orders for the identical amount within a minute, upload one matching SMS,
show it landing in the review queue with both candidates and their score breakdowns; resolve it to the
right order and show the webhook delivered with `verification_method: MANUAL_ADMIN`; then repeat with
a distinguishing `sender_msisdn` and show it auto-verifying.

---

## 7. Acceptance criteria

- [ ] Candidate query implements the `architecture.md §9.2` predicate exactly, including `transaction_id IS NULL`, and uses the intended index (plan recorded).
- [ ] Scoring implements `architecture.md §9.3` weights and both penalties, returns a per-signal breakdown plus human-readable `why` strings, and is pure.
- [ ] Decision rules implement the threshold and 0.25-gap logic; boundaries tested and documented as inclusive/exclusive.
- [ ] **An exact-mode order can never be verified by a heuristic match** — asserted directly.
- [ ] Every scenario in the adversarial suite produces the expected outcome with **zero false verifications**.
- [ ] The randomised colliding-traffic soak ends with clean invariants and fully re-derivable verifications.
- [ ] Reverse heuristic matching works at register time within the same bounds.
- [ ] Review rows are created for all five reasons; duplicates prevented; unparsed-message reviews open after the documented delay.
- [ ] Review resolution (link/dismiss) works, requires a note, is audited, is idempotent, re-validates state inside the transaction, and emits the correct webhook.
- [ ] Review SLA metric and P2 alert wired; `reviews/stats` matches raw SQL.
- [ ] All analytics endpoints implemented, reconciled against naive computation, timezone-correct at Dhaka day boundaries, with `as_of` and caching.
- [ ] Any analytics query exceeding 500 ms at target volume is pre-aggregated, with rollup correctness tested.
- [ ] `docs/matching.md` documents the heuristic path and per-client tuning guidance; `docs/runbook.md` documents working the review queue.

---

## 8. Risks & notes

- **This is where the platform can lose a client's money.** The default posture
  (`auto_verify_min_confidence = 0.90`) means that without a sender match, an amount match plus a
  tight window is usually *not* enough on its own. That is intentional. Resist lowering the default to
  reduce review volume — instead, get the client to collect `sender_msisdn` or the TrxID at checkout,
  which is a one-field change on their side and eliminates the ambiguity at the source.
- Recommend in `docs/integration-guide.md` that clients send `sender_msisdn` even when they collect a
  TrxID: it makes heuristic fallback safe when the customer mistypes the TrxID, which is the single
  most common real-world failure.
- The collision penalty is what prevents the classic disaster: two customers paying 500 BDT within a
  minute. Test it as if it were the only safety mechanism, because in that scenario it is.
- Keep `heuristic_enabled` as a per-tenant kill switch and mention it in the runbook. If a client
  reports a wrong verification, turning heuristics off for them is a 10-second mitigation while you
  investigate.
- Analytics is where scope creep hides. Ship the seven endpoints listed and no more; a merchant-facing
  dashboard is explicitly post-v1.
