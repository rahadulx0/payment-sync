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

## Working the review queue

Reviews (`GET /admin/reviews?status=OPEN`, oldest first) carry an `age_minutes` and the full scored
candidate snapshot with per-signal `why` strings. Resolve each with `POST /admin/reviews/:id/resolve`:

- **Link** (`{link_sms_log_id, link_payment_request_id, note}`) — verifies the SMS against the chosen
  order via `MANUAL_ADMIN` and emits `payment.verified`. Re-validates the order state inside the
  transaction, so it can never double-credit; resolving twice returns a conflict.
- **Dismiss** (`{dismiss_reason, note}`) — closes the review; the SMS returns to `UNMATCHED` (still
  re-matchable) or `IGNORED` if `not_a_payment: true`.

`note` is mandatory and every resolution is audited. `GET /admin/reviews/stats` drives the dashboard
tile and the P3 alert at >10 open. A review older than `review_sla_minutes` is a merchant with an
unfulfilled paid order — treat the SLA breach as a real incident, not a backlog item.

If a client reports a _wrong_ verification, set `heuristic_enabled = false` for them (10-second
mitigation) while you investigate, and use the void-verification procedure above if a bad verification
already went out.

## Android keystore custody (highest-consequence artifact)

The release keystore signs every APK. **If it is lost, no merchant can ever install an update again** —
a differently-signed APK will not upgrade an existing install; every phone would need a manual uninstall
(losing un-uploaded messages) and re-enrollment.

- Generated **once**. Stored offline in **two** separate physical locations, plus base64 in CI secrets
  (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
- Record the custody locations and who holds them. Verify the backups restore, once, on purpose.
- The release build reads signing from env and **fails loudly** if it is missing, rather than silently
  falling back to a debug key (which would produce an APK that cannot upgrade anything).
- `mapping.txt` is archived per release by CI — without it a crash report from a minified build is
  unreadable.

## Certificate pin rotation (the pinning trap)

Pins are on the **intermediate CA**, never the leaf (pinning a leaf guarantees an outage at renewal),
and a **backup pin** always ships alongside the primary.

Order of operations — getting this backwards takes every device offline:

1. Ship an app release containing the **new** pin (as the backup) **before** the certificate changes.
2. Wait until the fleet has updated (watch the heartbeat version spread in the dashboard).
3. Only then rotate the certificate.
4. In the next release, drop the retired pin.

**If devices can no longer connect:** publish a rescue APK with corrected pins and set
`min_supported_app_version` above the broken build, so the in-app blocking screen points every device
at the rescue download. Verify this rescue path once, deliberately, in staging — not for the first time
during an incident.

## Emergency: pulling a bad app release

1. Set `min_supported_app_version` above the bad version → every device shows the blocking update screen.
2. Publish the fixed APK and update `latest.json` (version code, URL, **sha256**).
3. Devices update on next check; the SHA-256 is verified before install, so a corrupted or swapped file
   is rejected rather than installed.
