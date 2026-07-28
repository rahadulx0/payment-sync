# Operations runbook

Procedures for the money-critical paths. **Automated self-repair on money data is deliberately not
built** — every correction below is a human decision, taken with a reason and fully audited.

## Invariant violation (P1)

The invariant job (`workers/invariants.processor.ts`) runs every 15 minutes and checks
(`modules/matching/invariants.service.ts`):

| check                                 | meaning if non-zero                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `verified_order_without_verification` | an order is VERIFIED but has no `verified_transactions` row                          |
| `verification_on_unverified_order`    | a verification points at an order that is not VERIFIED                               |
| `matched_sms_without_verification`    | an SMS is MATCHED but has no verification row                                        |
| `duplicate_live_trxid`                | two live orders share a TrxID (the partial unique index should make this impossible) |
| `verification_amount_delta_null`      | a verification is missing its amount delta                                           |

A non-zero count fires a P1: `invariant_violations_total{check}` increments, a SYSTEM `audit_logs`
entry is written, and the job logs at error.

### Inspect

1. `GET /admin/invariants` — returns each check, its count, and up to 5 sample row ids.
2. For each sample id, pull the row and its `match_attempts` trace to reconstruct what happened.
3. Do **not** run any repair before you understand the cause. A single violation is a correctness
   incident, not a cleanup chore.

### Repair

There is exactly one supported repair primitive: **void a verification**.

- `POST /admin/verified/:id/void` with `{ "reason": "..." }` (reason is mandatory, 3–500 chars).
- It deletes the `verified_transactions` row, reverts the order to `PENDING` (clears `verified_at`),
  and reverts the SMS to `UNMATCHED`, all in one transaction. It is audited (`verification.void`).
- After voiding, a correct match can be re-established by a rescan or a corrected register.
- The route is admin-only under the default-deny guard; it is **unreachable by any client
  credential** (asserted in the auth matrix).

When to void: a verification that an invariant flagged as inconsistent, a confirmed chargeback/refund,
or a mis-match discovered in review. When **not** to void: to "retry" a delivery (that is Task 09's
job) or to change an amount (register a new order instead).

## Stuck / unmatched SMS

If credit SMS are piling up UNMATCHED for a company:

1. Check `unmatched_sms_gauge{company}` and the SMS `parse_status` — a spike in `UNPARSED`/`PARTIAL`
   usually means a provider changed its SMS wording; fix the parser rule (Task 05) and re-parse.
2. Trigger a rescan (manual sync from the device, or the admin rescan action) — the periodic sweep
   also covers this every 15 minutes.
3. If an order's TrxID was mistyped by the buyer, use `PATCH /payments/{order_id}/transaction-id`
   (ADR-14) rather than voiding anything.
