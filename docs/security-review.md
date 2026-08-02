# Security review

Walkthrough of the `architecture.md §13` threat model, recording for each threat the **implemented
control**, the **test that proves it**, and any **residual risk**.

Status legend: ✅ proven by an automated test · 🔍 implemented, needs a live/manual check · ⚠️ residual
risk accepted and documented.

## T1–T13

| #       | Threat                                 | Control                                                                                                                                                                                           | Proof                                                                                                                                             | Status                                                                                                  |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **T1**  | Fake SMS injected on a rooted phone    | Server-side re-parse is authoritative (ADR-5); `sms_address` allowlist; `direction=CREDIT` guard; TrxID must match a real PENDING order registered by the _website_; full raw-message audit trail | `decide.spec.ts` (guards, DEBIT rejected), `adversarial.spec.ts` (no order ⇒ no verification), parser fixtures                                    | ⚠️ Accepted: the merchant owns the phone, so this is self-harm, not cross-tenant harm                   |
| **T2**  | APK decompiled, credentials extracted  | Device token ≠ server key (ADR-4): a device credential can only _submit_ SMS, never register or read orders; per-device revocation; rate limits                                                   | `system/journeys.spec.ts` — a device token is rejected (401) for both register and read                                                           | ✅ + 🔍 decompile the signed APK once to confirm no server key/enroll key/webhook secret is recoverable |
| **T3**  | Replayed webhook                       | Timestamped HMAC over the raw body, 5-minute tolerance, `event_id` idempotency                                                                                                                    | `signer.spec.ts` (tamper rejected), `hmac` tolerance in `verifyWebhook`, published verifiers enforce all three                                    | ✅                                                                                                      |
| **T4**  | Webhook secret leaked                  | Per-company secrets, encrypted at rest, rotation with a 7-day dual-signing window, redacted in delivery history                                                                                   | `delivery.spec.ts` (dual-sign accepted, signature header redacted), `maintenance.spec.ts` (prev secret dropped after 7 days)                      | ✅                                                                                                      |
| **T5**  | Cross-tenant data access               | `company_id` on every tenant table + tenant-scoped Prisma client; default-deny audience guard                                                                                                     | `system/journeys.spec.ts` — B cannot read A's order (404), mismatched key/company pair rejected (401), B's order cannot be verified by A's device | ✅                                                                                                      |
| **T6**  | TrxID reuse / double spend             | Partial unique index on live `(company_id, transaction_id)`; `verified_transactions` double-UNIQUE; duplicate ⇒ review                                                                            | `runner.spec.ts` (2nd SMS ⇒ DUPLICATE_TXN, one verification), 20×20 concurrency ⇒ exactly one verification                                        | ✅                                                                                                      |
| **T7**  | SSRF via `callback_url`                | HTTPS-only, private-range denylist, DNS resolution **at register and again at send time**, no redirect following                                                                                  | `payments.e2e` (register rejects private/non-https), `delivery.spec.ts` (send-time revalidation blocks and never sends; redirect ⇒ FAILED)        | ✅                                                                                                      |
| **T8**  | Admin account takeover                 | Argon2id, mandatory TOTP, refresh rotation with reuse detection, lockout, optional IP allowlist, every action audited                                                                             | `control-plane.e2e` (bad password, TOTP reuse rejected, lockout), audit rows asserted                                                             | ✅                                                                                                      |
| **T9**  | Brute force on API keys                | 32-byte random keys, prefix-indexed lookup + Argon2id verify with a constant-cost dummy path, per-IP/company rate limits, `auth_attempts` logging                                                 | `api-core.e2e` (revoked key 401, rate limit 429), `credential.service.ts` dummy verify                                                            | ✅                                                                                                      |
| **T10** | DB dump exfiltration                   | Postgres on the internal Docker network only; keys hashed; webhook/TOTP secrets envelope-encrypted with a KEK held outside the DB; backups encrypted before upload                                | `infra/docker-compose.yml` (no published port), `crypto.service.ts`, `pg_backup.sh`                                                               | 🔍 external port scan pending a VPS                                                                     |
| **T11** | Malicious client floods register       | Per-company rate limits, `metadata` ≤ 4 KB, batch ≤ 50, order TTL + purge                                                                                                                         | `payments.e2e` (metadata cap), rate-limit e2e, `expiry.service`                                                                                   | ✅                                                                                                      |
| **T12** | Amount manipulation                    | Amount compared server-side against `expected_amount` in integer paisa; **underpay never auto-verifies**; `amount_delta` recorded                                                                 | `decide.spec.ts` (underpay ⇒ REVIEW across 2000 randomised amounts), `system/journeys.spec.ts` (overpay verifies with delta)                      | ✅                                                                                                      |
| **T13** | Late/duplicate SMS ⇒ double fulfilment | `event_id` idempotency contract, `was_late` flag, one-verification-per-order invariant                                                                                                            | `runner.spec.ts` (late match sets `was_late`), invariant checks clean after every suite                                                           | ✅                                                                                                      |

## Attempted attacks

| Attempt                                              | Result                                | Where                     |
| ---------------------------------------------------- | ------------------------------------- | ------------------------- |
| Register an order with a device token                | Rejected 401                          | `system/journeys.spec.ts` |
| Read another tenant's order with a valid server key  | 404, no existence leak                | `system/journeys.spec.ts` |
| Pair a valid server key with another company's code  | Rejected 401                          | `system/journeys.spec.ts` |
| Reach `/admin/*` with a server key                   | Rejected 401                          | `system/journeys.spec.ts` |
| Verify tenant B's order using tenant A's device SMS  | Not matched; zero verifications for B | `system/journeys.spec.ts` |
| Tamper one byte of a webhook body                    | Signature rejected                    | `signer.spec.ts`          |
| Callback resolving to a private address at send time | Blocked, request never sent           | `delivery.spec.ts`        |
| Webhook endpoint issuing a redirect                  | Not followed, marked FAILED           | `delivery.spec.ts`        |
| Rotate the KEK with the wrong old key                | Throws; never writes corrupted data   | `alerting.spec.ts`        |
| Reuse a TOTP code                                    | Rejected                              | `control-plane.e2e`       |

## Still to do before go-live (needs artefacts this environment cannot produce)

These are real gaps, not formalities:

1. **Decompile the signed release APK** (`jadx`/`apktool`) and confirm the only credential present is a
   device-scoped token. Requires the CI-signed APK from Task 15.
2. **MITM proxy against a pinned release build** — confirm the connection fails with the interception
   message, and that the backup pin alone suffices. Requires a device and the real staging certificate.
3. **External port scan** of the VPS (expect only 22/80/443) and `testssl.sh` grading of both hosts.
4. **Dependency audit**: `pnpm audit`, Gradle dependency review, base-image CVE scan; triage findings.
5. **Forge an SMS on a rooted device** and confirm it verifies nothing without a matching registered
   order (T1's residual-risk boundary, demonstrated rather than argued).

## Findings

None open at P1/P2 from the automated review. P3 backlog:

- Postgres RLS as defence-in-depth for T5 is deferred to post-v1 (`architecture.md §19`); the
  repository-level guard plus the tests above are the v1 control.
- Certificate pin values are placeholders until staging has its real certificate (Task 15).
