# Matching engine

How a credit SMS becomes a verified payment, what guarantees hold, and how to read a decision trace.

## The pipeline

```
SMS ingested (Task 06)  ─┐
                         ├─►  MatchingService.matchBySms()  ─►  decide()  ─►  applyDecision()  ─►  COMMIT
order registered (07)  ──┘        (advisory lock)              (pure core)      (same tx)
                                                                                    │
                                                          webhook_events (PENDING) ─┘  → Task 09 sweeper delivers
```

Two entry points, one core:

- **Forward** — `matchBySms(smsLogId)` runs when an SMS is ingested or rescanned.
- **Reverse** — `reverseMatchOrder(paymentRequestId)` runs when an order is registered or its
  TrxID is corrected; it scans UNMATCHED SMS that already carry the order's TrxID, so a register can
  return `VERIFIED` synchronously.

## The pure core (`modules/matching/core/`)

`decide(input)` is a pure function — no I/O, no clock (`now` is an input), no Prisma. It is the only
place matching logic lives, and it is exhaustively unit- and property-tested. Order of evaluation:

1. **Guards** (`guards.ts`), in order: `COMPANY_NOT_ACTIVE` (DISABLED only — SUSPENDED still matches),
   `DEVICE_NOT_ACTIVE`, `DIRECTION_NOT_CREDIT`, `PROVIDER_NOT_ALLOWED`, `PARSE_STATUS_UNUSABLE`,
   `AMOUNT_MISSING_OR_ZERO`. A hard guard → `GUARD_REJECTED`.
2. **Future-timestamp** — a credit dated >5 min ahead is suspicious → `REVIEW (SUSPICIOUS_SMS)`,
   never a silent drop.
3. **Exact pass** (`exact-pass.ts`) — match the SMS TrxID against a live order:
   - within tolerance → `VERIFIED` (delta recorded, in integer paisa via `Money`);
   - overpaid beyond tolerance → `VERIFIED` + `AMOUNT_OVERPAID` flag;
   - **underpaid beyond tolerance → `REVIEW (AMOUNT_MISMATCH)`, never verified**;
   - no live order but TrxID already spent → `DUPLICATE`;
   - no live order, unspent → `UNMATCHED` (waits for a register / the reverse path);
   - an `EXPIRED` order is eligible only inside `late_match_grace_hours` → sets `was_late`.
4. **Heuristic port** (`heuristic-port.ts`) — the injected second pass. `NoopHeuristic` here
   (returns `UNMATCHED`); Task 10 supplies the real amount+window+sender strategy.

## Correctness guarantees

The database constraints are the guarantee; the application logic is the optimisation
(`architecture.md §14`):

- `verified_transactions` has a UNIQUE on **both** `payment_request_id` and `sms_log_id` — one order
  is verified once, one SMS verifies once.
- A partial unique index stops two live orders (`PENDING`/`VERIFIED`) sharing a TrxID.
- The runner takes a **per-company advisory lock inside the transaction**, so matching within one
  tenant is serialised while other tenants run in parallel.
- A unique-violation during `applyDecision` is not an error — it means a concurrent path already did
  the work. The runner increments `matching_conflicts_total`, reconciles, and returns the existing
  outcome as a no-op success. **Money never moves twice**, whatever the interleaving.

## Reading a decision trace

Every run writes exactly one `match_attempts` row — including `UNMATCHED` and `GUARD_REJECTED` — so
"why wasn't this verified?" is answerable from one table:

| Column         | Meaning                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `trigger`      | `SMS_UPLOAD` / `ORDER_REGISTER` / `RESCAN` / `REPARSE` / `ADMIN`                 |
| `result`       | `VERIFIED` / `REVIEW` / `DUPLICATE` / `IGNORED` / `GUARD_REJECTED` / `UNMATCHED` |
| `pass`         | `EXACT` / `HEURISTIC` / `NONE`                                                   |
| `guard_failed` | the named guard, when `result = GUARD_REJECTED`                                  |
| `candidates`   | ranked snapshot (TrxID equality + amount delta; scores in Task 10)               |
| `duration_ms`  | wall-clock of the run                                                            |

Trace writes are wrapped: a trace failure is logged, never allowed to fail a match.

## Rescan

`RescanService.rescanCompany()` re-runs matching over a company's UNMATCHED SMS (manual sync,
re-parse, admin action, periodic sweep). It is deduplicated by a short-lived Redis key, so a burst of
manual syncs collapses to one rescan rather than stacking dozens.

## Metrics

`match_decisions_total{result,pass}`, `matching_duration_seconds`, `verification_latency_seconds`
(sms_timestamp → verified_at), `matching_conflicts_total`, `matching_lock_wait_seconds`,
`duplicate_txn_total`, `unmatched_sms_gauge{company}`, `invariant_violations_total{check}`.
