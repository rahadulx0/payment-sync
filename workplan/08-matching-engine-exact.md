# Task 08 — Matching Engine: Exact Pass & Correctness Invariants

| | |
|---|---|
| **Track** | Core — **money-critical gate** |
| **Depends on** | 06, 07 |
| **Unblocks** | 09, 10 |
| **Est. effort** | 4–5 days |
| **Risk** | **High** — a bug here credits money that was never received, or fails to credit money that was |

---

## 1. Objective

Implement the matching engine from `architecture.md §9`: the pure decision core, the transactional
runner with concurrency control, the exact-TrxID pass, the decision trace, the rescan job, and the
invariant verification that proves double-crediting is impossible.

**Do not start Task 09 until every acceptance criterion here is green.** This is the gate.

---

## 2. Scope of work

### In scope
- Pure decision core: guards + exact pass, returning a fully-explained `MatchDecision`.
- Transactional runner: advisory lock, `SELECT … FOR UPDATE`, conflict handling, commit boundaries.
- Wiring the hooks left by Tasks 06 and 07 (`onSmsIngested`, `onOrderRegistered` reverse match).
- Late matching within `late_match_grace_hours` (`EXPIRED` → `VERIFIED`, `was_late = true`).
- Duplicate-TrxID detection → `match_reviews` row + `DUPLICATE_TXN` status.
- `match_attempts` decision-trace persistence (every attempt, including non-matches).
- Rescan job (manual sync, re-parse, admin trigger) over all `UNMATCHED` sms_logs.
- Webhook event creation inside the verifying transaction (delivery is Task 09).
- Invariant job + property/concurrency test suites.

### Out of scope
- Heuristic/amount-window matching and scoring → Task 10 (this task leaves the second pass as an
  explicitly-typed extension point that currently returns `UNMATCHED`).
- Webhook delivery, retries, signing → Task 09.
- Review-resolution UI/endpoints → Task 10/12 (rows are created here, resolution comes later).

---

## 3. Prerequisites

- Task 06: ingestion pipeline + `matching.hook.ts` no-op.
- Task 07: `payment_requests` + register reverse-match hook + expiry semantics.
- Task 05: parse results with normalised `transaction_id`/`amount`/`direction`.
- Task 02: `verified_transactions` double-UNIQUE, partial unique TrxID index, `match_attempts`.

---

## 4. Implementation steps

### 4.1 Pure core (`modules/matching/core/`)
No I/O, no clock, no Prisma — inputs in, decision out. This is where all the logic lives and where
the exhaustive tests point.

```ts
type MatchInput = {
  sms: SmsFacts;                    // provider, direction, trxId?, amount, senderMsisdn?, smsAt, flags
  candidates: OrderFacts[];         // pre-fetched by the runner
  settings: MatchSettings;          // tolerance, window, grace, thresholds, allowedProviders
  spentTrxIds: Set<string>;         // TrxIDs already in verified_transactions for this company
  now: Date;
};
type MatchDecision =
  | { result: 'VERIFIED';  pass: 'EXACT'; orderId: string; confidence: 1; amountDelta: Money; wasLate: boolean }
  | { result: 'REVIEW';    reason: ReviewReason; candidates: ScoredCandidate[] }
  | { result: 'DUPLICATE'; existingVerificationId: string }
  | { result: 'IGNORED';   reason: IgnoreReason }
  | { result: 'GUARD_REJECTED'; guard: GuardName }
  | { result: 'UNMATCHED' };
```

**Guards, in order** (`architecture.md §9.2 step 0`) — each returns a named rejection so the trace
explains itself:
`COMPANY_NOT_ACTIVE` (DISABLED only; SUSPENDED still matches), `DEVICE_NOT_ACTIVE`,
`DIRECTION_NOT_CREDIT`, `PROVIDER_NOT_ALLOWED`, `PARSE_STATUS_UNUSABLE` (`UNPARSED`),
`AMOUNT_MISSING_OR_ZERO`, `FUTURE_TIMESTAMP` (>5 min ahead → REVIEW, not silent drop).

**Exact pass:**
1. Require `sms.trxId`. Find the candidate with a matching normalised TrxID and status
   `PENDING`, or `EXPIRED` within grace.
2. Amount comparison **in integer paisa** via `Money`:
   - `|expected − received| ≤ tolerance` → `VERIFIED`, `amountDelta` recorded.
   - `received > expected + tolerance` (overpay) → `VERIFIED` + flag `AMOUNT_OVERPAID`
     (the merchant received *more*; failing this would be absurd, but it must be visible).
   - `received < expected − tolerance` (underpay) → `REVIEW` with `AMOUNT_MISMATCH`. **Never** verify.
3. No candidate + TrxID ∈ `spentTrxIds` → `DUPLICATE`.
4. No candidate, unspent → `UNMATCHED` (waits for a register; the reverse path will find it).
5. Heuristic extension point: `heuristicPass(input)` — injected strategy, `NoopHeuristic` in this task,
   real implementation in Task 10. The core's tests must pass with both.

### 4.2 Transactional runner (`modules/matching/matching.service.ts`)
```
async match(trigger, smsLogId | paymentRequestId):
  attemptStart = hrtime()
  1. advisory lock:  SELECT pg_advisory_xact_lock(hashtext($company_id))   -- inside the tx
  2. load sms facts + settings + spent-trx set
  3. load candidates:
       EXACT: WHERE transaction_id = $trx AND status IN ('PENDING','EXPIRED') FOR UPDATE
       (Task 10 adds the heuristic candidate query here)
  4. decision = core.decide(input)
  5. apply(decision):
       VERIFIED  → INSERT verified_transactions
                   UPDATE payment_requests SET status='VERIFIED', verified_at
                   UPDATE sms_logs        SET match_status='MATCHED'
                   INSERT webhook_events  (payment.verified, frozen payload)
       REVIEW    → INSERT match_reviews (ON CONFLICT DO NOTHING per Task 02's open-review index)
                   UPDATE sms_logs SET match_status='IN_REVIEW'
                   INSERT webhook_events (payment.review_required) if settings.notify_on_review
       DUPLICATE → UPDATE sms_logs SET match_status='DUPLICATE_TXN' + flag; INSERT match_reviews
       IGNORED/GUARD_REJECTED → UPDATE sms_logs SET match_status='IGNORED'
       UNMATCHED → UPDATE sms_logs SET match_status='UNMATCHED'
  6. INSERT match_attempts (trace: trigger, pass, guard, candidates, scores, duration)
  7. COMMIT
  8. post-commit: enqueue webhook delivery for any created events (Task 09)
  on unique-violation (vt_payment_request_unique | vt_sms_log_unique):
     ROLLBACK → re-read state → return the already-existing outcome as a no-op success
     (log at warn with both ids; increment matching_conflicts_total — a nonzero counter here
      means a concurrency path needs review, but never means money moved twice)
```

Rules that must hold:
- The advisory lock is **per company**, taken inside the transaction so it releases on commit/abort.
  It serialises matching per tenant without blocking other tenants.
- `webhook_events` is written **inside** the same transaction as the verification, and enqueued
  **after** commit. If the process dies between the two, the Task 09 sweeper picks it up from
  `next_attempt_at` — at-least-once, never lost (`architecture.md §14`).
- Never open an HTTP call, never `await` a queue inside the transaction.
- Transaction timeout 5 s; on timeout, roll back and retry once with jitter, then leave the SMS
  `UNMATCHED` (the rescan will retry) and raise a P2 metric. Matching must never wedge ingestion.

### 4.3 Wiring the triggers
1. **`onSmsIngested`** (Task 06 hook) — replace the no-op; called per message after parse, inside the
   ingest loop but in its own transaction. The upload response now reports the real `match_status`.
2. **`onOrderRegistered`** (Task 07 hook) — reverse match: scan `sms_logs` where
   `company_id`, `match_status = 'UNMATCHED'`, `transaction_id = order.transaction_id`
   (or, in Task 10, the amount/window candidate set), oldest first. On a hit, run the same
   `apply()` path so the register response can return `status: VERIFIED` synchronously
   (`architecture.md §7.3`). Bounded: examine at most 200 candidates, ordered by `sms_timestamp DESC`.
3. **`rescan` job** (`workers/rescan-unmatched.processor.ts`) — for a company: all `UNMATCHED`
   sms_logs within the retention window × current `PENDING`/in-grace orders. Triggered by:
   manual sync upload (Task 06 `upload_source = MANUAL_SYNC`), re-parse (Task 05), admin action,
   and a periodic safety sweep (every 15 min per active company with unmatched rows).
   Chunked (200 per job), `SKIP LOCKED`, deduplicated by a Redis job key so a burst of manual syncs
   doesn't stack 50 identical rescans.
4. **Late matching** — the candidate query includes `EXPIRED` orders whose
   `expires_at > now - late_match_grace_hours`; verification sets `was_late = true` and the webhook
   payload carries it (`architecture.md §5.4`). An `EXPIRED` order outside grace is never revived.

### 4.4 Decision trace
- Every call writes exactly one `match_attempts` row — including `UNMATCHED` and `GUARD_REJECTED`.
  This is what makes Task 12's "why wasn't this verified?" screen possible.
- `candidates` jsonb holds the ranked snapshot with per-signal detail (in this task: TrxID equality
  and amount delta; Task 10 adds scores).
- Trace writes must never fail the match: wrapped so a serialisation error is logged, not thrown.

### 4.5 Invariant verification
1. `workers/invariants.processor.ts` — runs `sql/invariants.sql` (Task 02) every 15 min; any offending
   row → P1 alert (`architecture.md §15.3`) + `invariant_violations_total{check}` metric + an
   `audit_logs` entry with `actor_type = SYSTEM`.
2. `GET /admin/invariants` returns the current result set (Task 12 dashboard tile).
3. A repair *procedure* — not automated repair — documented in `docs/runbook.md`: how to inspect,
   how to void a verification (audited endpoint `POST /admin/verified/:id/void` with a mandatory
   reason, which reverts the order to `PENDING` and the SMS to `UNMATCHED`), and when that is
   appropriate. Automated self-repair on money data is deliberately not built.

### 4.6 Metrics
`match_decisions_total{result,pass}`, `matching_duration_seconds`,
`verification_latency_seconds` (histogram, `sms_timestamp` → `verified_at`),
`matching_conflicts_total`, `matching_lock_wait_seconds`,
`unmatched_sms_gauge{company}`, `duplicate_txn_total`, `invariant_violations_total{check}`.

---

## 5. Files created / modified

```
apps/api/src/modules/matching/core/{decide.ts,guards.ts,exact-pass.ts,heuristic-port.ts,
                                    types.ts,amount-compare.ts}
apps/api/src/modules/matching/{matching.module.ts,matching.service.ts,candidate.repository.ts,
                               apply-decision.ts,trace.service.ts,reverse-match.service.ts,
                               rescan.service.ts}
apps/api/src/modules/matching/admin/{void-verification.controller.ts,invariants.controller.ts}
apps/api/src/workers/{rescan-unmatched.processor.ts,invariants.processor.ts}
apps/api/src/modules/sms/matching.hook.ts        # no-op → real
apps/api/src/modules/payments/matching.hook.ts   # no-op → real
apps/api/test/unit/matching/{guards.spec.ts,exact-pass.spec.ts,amount-compare.spec.ts,
                             decide.property.spec.ts}
apps/api/test/integration/matching/{runner.spec.ts,concurrency.spec.ts,late-match.spec.ts,
                                    reverse-match.spec.ts,rescan.spec.ts,duplicate-txn.spec.ts}
apps/api/test/e2e/journey-exact-match.e2e-spec.ts
docs/matching.md          # the algorithm, the guarantees, and how to read a decision trace
docs/runbook.md           # invariant violation + void-verification procedures
```

---

## 6. Testing & validation

### 6.1 Unit — pure core (exhaustive, fast)
| Case | Expected |
|---|---|
| TrxID match, exact amount | VERIFIED, confidence 1.0, delta 0 |
| TrxID match, within tolerance (both directions) | VERIFIED, delta recorded |
| TrxID match, overpay beyond tolerance | VERIFIED + `AMOUNT_OVERPAID` |
| TrxID match, underpay beyond tolerance | REVIEW `AMOUNT_MISMATCH` — **never** VERIFIED |
| TrxID match on an `EXPIRED` order inside grace | VERIFIED, `wasLate: true` |
| TrxID match on an `EXPIRED` order outside grace | UNMATCHED |
| TrxID already in `spentTrxIds` | DUPLICATE |
| Debit-direction SMS | GUARD_REJECTED `DIRECTION_NOT_CREDIT` |
| Provider not in `allowed_providers` | GUARD_REJECTED |
| `UNPARSED` / zero amount | GUARD_REJECTED |
| Timestamp 10 min in the future | REVIEW `SUSPICIOUS_SMS` |
| No TrxID on the SMS (v1 core) | UNMATCHED via the noop heuristic port |
| Amount `1250.00` vs `1250` vs `1,250.00` | all equal (paisa comparison) |
| Tolerance boundary at exactly ±tolerance | inclusive, documented, tested |

Property tests (fast-check):
- For any generated input sequence, applying decisions never yields two verifications for one order
  or one SMS.
- `decide` is deterministic and side-effect free (same input 1000× → identical output).
- Amount comparison is symmetric and transitive within tolerance semantics.

### 6.2 Integration — the runner (Testcontainers)
| Case | Expected |
|---|---|
| Ingest → verify | `verified_transactions` row, order `VERIFIED`, sms `MATCHED`, one `webhook_events` row, one `match_attempts` row |
| **Two identical SMS uploaded concurrently** | exactly one verification; second is a no-op success; `matching_conflicts_total` may increment; no error surfaced to the device |
| **Two different SMS with the same TrxID** | first verifies, second → `DUPLICATE_TXN` + review row |
| **Two orders racing one SMS** (only possible pre-Task-10 via manual construction) | exactly one verification |
| Register-then-SMS | verified on ingest |
| **SMS-then-register (reverse match)** | register returns `VERIFIED` synchronously, webhook event created |
| Concurrent register + ingest of the matching pair | exactly one verification, whichever path wins |
| Expire racing verify | verify wins; order not left `EXPIRED` |
| Manual-sync upload of 100 previously-missed SMS | all matched against pending orders; one rescan job, not 100 |
| Re-parse fixing a `PARTIAL` row | rescan runs, match succeeds |
| Transaction timeout injected | rolls back, retries once, leaves `UNMATCHED`, ingestion still returns 202 |
| Advisory lock behaviour | company A's long match does not block company B (assert wall-clock parallelism) |

### 6.3 E2E journey (`architecture.md §5.1`)
Full flow with the real HTTP surface: register (server key) → upload SMS (device token) →
assert `GET /payments/{order_id}` shows `VERIFIED` with `verification` detail → assert a
`webhook_events` row exists `PENDING` (delivery is Task 09) → assert the decision trace is
retrievable and explains the match.

### 6.4 Invariants
Seed each broken state deliberately (raw SQL), confirm the job detects it, alerts, and records the
metric; then a 10-minute soak with randomised concurrent ingest/register traffic must end with all
invariants clean.

**Smoke demo:** run the E2E journey with logs visible, then run a small script that fires 20 identical
uploads and 20 identical registers concurrently and show that exactly one verification exists and all
invariants are clean.

---

## 7. Acceptance criteria

- [ ] Pure core implemented with named guards; every unit case in §6.1 passes; property tests green.
- [ ] Underpayment beyond tolerance **never** auto-verifies; overpayment verifies with a flag. Both tested.
- [ ] Amount comparison happens in integer paisa via `Money`; no float comparison anywhere on the path (lint + review).
- [ ] Exact matching works for `PENDING` and in-grace `EXPIRED` orders; `was_late` set correctly; outside-grace orders are never revived.
- [ ] Duplicate TrxID reuse produces `DUPLICATE_TXN` + a review row, never a second verification.
- [ ] Both hooks wired: ingest-time matching and register-time reverse matching (register can return `VERIFIED` synchronously).
- [ ] Rescan job covers manual-sync, re-parse, admin, and periodic triggers; deduplicated so bursts don't stack.
- [ ] Every match attempt writes exactly one `match_attempts` row, including guard rejections and non-matches; trace failures never fail a match.
- [ ] `webhook_events` rows are created **inside** the verifying transaction and enqueued only after commit.
- [ ] All concurrency cases in §6.2 pass, including 20×20 concurrent duplicate traffic with exactly one verification.
- [ ] Invariant job runs on schedule, detects every seeded violation, alerts P1, and is clean after a 10-minute randomised soak.
- [ ] `POST /admin/verified/:id/void` exists, requires a reason, is audited, and correctly reverts order + SMS state.
- [ ] `verification_latency_seconds` and all §4.6 metrics emitted with the documented names.
- [ ] `docs/matching.md` explains the algorithm and how to read a trace; runbook covers invariant violations.

---

## 8. Risks & notes

- **The unique constraints are the real guarantee; the application logic is the optimisation.** Treat
  a `matching_conflicts_total` increment as a signal to review a concurrency path, not as a failure —
  the DB did its job. Treat an `invariant_violations_total` increment as a P1 incident.
- Keep the pure core genuinely pure. The temptation to "just query one more thing" inside `decide()`
  destroys the property tests, which are the only tool that can explore the state space adversarially.
- The per-company advisory lock is a deliberate throughput trade: matching within one tenant is
  serialised. At the expected scale (`architecture.md §16.4`) that is far from a bottleneck, and it
  removes an entire class of race conditions. Revisit only with measurements.
- Do not let Task 10's heuristic logic leak in early. The exact path must be provably correct on its
  own, because it is the path that carries the overwhelming majority of real money.
- `POST /admin/verified/:id/void` is dangerous by design (it un-credits money). It requires a reason,
  is audited, and must never be reachable by a client credential — assert that in the auth matrix.
