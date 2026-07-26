# Task 17 — Client Enablement, Documentation & Go-Live

| | |
|---|---|
| **Track** | Release |
| **Depends on** | 12, 15, 16 |
| **Unblocks** | — (this is the finish line) |
| **Est. effort** | 5–7 days + a 2-week pilot observation window |
| **Risk** | Medium — the technical risk is low by now; the risk is shipping to a real merchant before the pilot has proven the parser and the phone |

---

## 1. Objective

Turn a working system into a **deliverable product**: the documentation an external developer can
integrate from unaided, the setup material a merchant can follow, a full-system E2E and load
validation, a security review, and a controlled pilot with one real merchant — ending in a go/no-go
decision with recorded evidence.

---

## 2. Scope of work

### In scope
- `docs/openapi.yaml` finalised and published; `docs/integration-guide.md` completed.
- Webhook verification snippets (PHP, Node, Python, Laravel, WordPress) — CI-executed.
- Client onboarding kit: packet template, checklist, support contact, SLA/limitations statement.
- Merchant-facing Android setup guide (EN/BN) with per-OEM screenshots; privacy policy published.
- Full-system E2E suite covering every journey in `architecture.md §5`.
- Load test (k6) and capacity note against `architecture.md §16.4`.
- Security review against `architecture.md §13` threat model, with findings triaged and fixed.
- Compliance/legal checklist (`architecture.md §17`, `plan.md §17`).
- Pilot: one merchant, low volume, daily reconciliation, parser corpus expansion.
- Go-live checklist and sign-off; post-v1 backlog handover.

### Out of scope
- Post-v1 features (`architecture.md §19`): SDKs, WooCommerce plugin, merchant dashboard, CSV
  export beyond the admin one, fraud rules, OCR, multi-phone UI.

---

## 3. Prerequisites

- Tasks 12, 15, 16 complete: dashboard, signed APK + update channel, production + staging + monitoring.
- A pilot merchant identified, with a real wallet number and a website able to consume webhooks.

---

## 4. Implementation steps

### 4.1 API documentation
1. Finalise `docs/openapi.yaml`: descriptions on every field, realistic examples on every endpoint,
   documented error responses, auth schemes per audience, and a tagged `v1` baseline for `oasdiff`.
2. Publish as a static Redoc/Scalar page served by Caddy at `docs.<domain>` (or a path on `api.<domain>`),
   built in CI so it can never drift from the spec.
3. `docs/error-codes.md`: every code with cause, HTTP status, and **recommended client action**
   (retry / fix payload / contact support). Linked from the guide.

### 4.2 `docs/integration-guide.md` — the deliverable that decides support load
Structure it as the four things an integrator must do, in order, each with runnable code:
1. **Register a pending payment** — request/response, the four idempotency/conflict cases from Task 07,
   and what to store on their side (`payment_request_id`, `expires_at`).
2. **Show payment instructions to the customer** — including the strong recommendation to collect
   **either** the TrxID **or** the sender's mobile number (and ideally both). Explain plainly what
   changes if they collect neither: verification falls back to amount+time matching, which for two
   customers paying the same amount within the window means a manual review and a delay. This one
   paragraph prevents the most common real-world failure (`architecture.md §20` / Task 10 §8).
3. **Receive and verify the webhook** — the signature recipe (raw body, `t.body`, constant-time compare,
   5-minute tolerance, `event_id` idempotency, `v0` during rotation), copy-paste verifiers, and the
   explicit rules: **no redirects**, respond 2xx fast (queue your own work), 4xx stops retries, 410
   cancels.
4. **Reconcile** — the poll fallback (`GET /payments/{order_id}`), the listing endpoint with `summary`
   for end-of-day, and what `was_late` and `verification_method` mean for their business logic.
Plus: a sandbox/staging walkthrough, rate limits, retry schedule table, a troubleshooting section
("webhook never arrived", "signature mismatch", "order still pending"), and a **limitations** section
stating exactly what the platform asserts — *"a credit SMS consistent with this order was received on
the registered device"*, not *"funds are settled"* (`architecture.md §17.4`). Keep that framing; it is a
deliberate liability boundary.

### 4.3 Verification snippets (`docs/webhook-verification/`)
Finalise the Task 09 snippets into copy-paste-ready files with comments a PHP developer at a Dhaka
agency can follow: `verify.php` (plain), `laravel-middleware.php`, `verify.js` (Express, raw-body
middleware note), `verify.py` (Flask/Django), `wordpress.php` (`rest_api_init` handler).
Each shows the raw-body pitfall explicitly, since re-serialising JSON is the #1 cause of signature
mismatch. CI continues to execute PHP/Node/Python against generated payloads.

### 4.4 Client onboarding kit
- `docs/client-onboarding-checklist.md`: create company → issue keys → deliver packet securely (never
  email + chat in the same channel) → client integrates on staging → `POST /webhooks/test` green →
  install APK on the merchant phone → enroll → heartbeat visible → verify capture with a real
  small payment → set settings (TTL, tolerance, heuristics) → go live → 7-day watch period.
- Onboarding packet template (rendered by the Task 04 endpoint) reviewed for completeness and clarity.
- Support expectations: contact channel, response times, what information to send
  (the Task 12 support bundle / Task 14 diagnostics block), and what *you* need from them.
- A short "what this system does and doesn't guarantee" one-pager for the business owner, in EN and BN.

### 4.5 Merchant material
- `docs/android-setup-guide.md` finalised (EN/BN): sideload instructions with per-OEM screenshots,
  permission rationale, battery-optimisation and autostart steps per OEM, what the Dashboard states mean,
  when and how to use Manual Sync, and the "phone must stay on, charged, and connected" expectations.
- Printable one-page quick reference for the shop counter.
- `docs/privacy-policy.md` published at a stable URL and linked in-app (`architecture.md §17.2`).

### 4.6 Full-system E2E suite (`test/system/`)
Automated, run against staging in CI nightly and before any release. Every journey from
`architecture.md §5` plus the failure paths:
1. Exact-match happy path (register → SMS → verified → webhook delivered).
2. Reverse match (SMS first, then register → verified synchronously).
3. Heuristic single-candidate auto-verify (with `sender_msisdn`).
4. Ambiguous heuristic → review → admin resolve → webhook.
5. Debit SMS ignored; promotional SMS unparsed; neither ever verifies.
6. Duplicate TrxID → second attempt reviewed, never double-credited.
7. Underpayment → review; overpayment → verified with flag.
8. Order expiry → late SMS within grace → verified with `was_late`.
9. Webhook failure → retries → manual retry → delivered.
10. Webhook dead → replay from dashboard → delivered.
11. Device offline → Manual Sync → batch upload → rescan → verifications + webhooks.
12. Company suspended → register rejected, ingestion continues → reactivate → queued webhooks released.
13. Key rotation with grace window; webhook secret rotation with dual-sign accepted by the reference verifier.
14. Cross-tenant isolation attempts (server key, device token, admin scoping) all rejected.
15. Invariants clean after the whole suite.
Each assertion checks DB state, API responses, **and** the receiver's view — the client's perspective is
the one that matters.

### 4.7 Load & capacity validation
- k6 scenarios: (a) steady 3× expected peak for 30 min mixed register/upload/poll; (b) burst — 500 SMS
  uploaded in one minute after a simulated outage (the realistic worst case: many phones reconnecting);
  (c) 50 concurrent registers with colliding amounts (heuristic stress); (d) a slow client webhook
  endpoint (8 s) while other tenants are served.
- Assertions: p95 register < 300 ms, p95 upload (50-message batch) < 800 ms, zero 5xx, zero invariant
  violations, webhook p95 time-to-delivery < 30 s under load, no queue growth at steady state.
- Record results and headroom in `docs/capacity.md`, and state the client count this VPS supports with
  the measured numbers — replacing the estimate in `architecture.md §16.4` with evidence.

### 4.8 Security review (`architecture.md §13`)
Walk the threat table T1–T13 and record, for each, the implemented control, the test that proves it, and
any residual risk. Then actively attempt:
- decompile the release APK (`apktool`/`jadx`) and confirm the only credential present is a
  device-scoped token, that it cannot register orders or read order data, and that no server key,
  webhook secret, or enrollment key is recoverable;
- forge an SMS on a rooted device and confirm it cannot verify anything without a matching
  registered order (and that it is visible in the dashboard as suspicious);
- replay a captured webhook beyond tolerance (rejected), tamper one byte (rejected);
- SSRF via `callback_url` at register **and** via post-registration DNS re-pointing (both rejected);
- cross-tenant access with every credential type;
- brute-force admin login and API keys (lockout, rate limits, `auth_attempts` logging);
- TLS/header review (`testssl.sh`, security headers), CSP on the dashboard, cookie flags;
- dependency audit (`pnpm audit`, `gradle dependencies` review, base-image CVE scan) with findings triaged.
Optionally run the repo's `/security-review` over the final diff. Findings triaged P1/P2/P3; **all P1 and
P2 fixed before go-live**, P3 recorded in the backlog with a date.

### 4.9 Compliance & legal checklist (`plan.md §17`, `architecture.md §17`)
- [ ] Consent screen precedes permissions, EN + BN, consent recorded with policy version.
- [ ] Only provider-address messages processed; verified by the Task 13 allowlist tests.
- [ ] Privacy policy published, linked in-app, and accurate about what leaves the phone.
- [ ] Permissions revocable; revoke-and-wipe works; retention enforced (`architecture.md §17.3`).
- [ ] No unrelated personal SMS collected — demonstrated, not asserted.
- [ ] Distribution: direct signed APK, Play restriction documented (`architecture.md §17.1`).
- [ ] Client agreement text states what the platform asserts and the merchant's own reconciliation duty.

### 4.10 Pilot (2 weeks, one merchant, low volume)
1. Onboard per the checklist; set conservative settings (`heuristic_enabled` initially **false** —
   exact TrxID only; `order_ttl_minutes` 60; `amount_tolerance` 0).
2. **Daily** for the first week: review every transaction end to end, every unparsed message, every
   review, webhook health, device liveness, and battery impact. Compare the platform's verdict against
   the merchant's own records for **every** payment — this is the only real test of the parser.
3. Expand the parser corpus from the merchant's actual messages (`architecture.md §20.2`): add fixtures,
   bump rule versions, dry-run, activate, bulk re-parse. Expect at least one rule version per provider.
4. Enable heuristic matching in week 2 **only if** the merchant's checkout cannot collect a TrxID, and
   only with `sender_msisdn` collection in place; watch the review queue closely.
5. Track pilot exit metrics: zero false verifications, ≥99% of real payments verified (allowing for
   delay), median SMS→webhook latency, device uptime %, count of manual interventions, count of parser
   rule bumps.
6. Record everything in `docs/pilot-report.md` including what surprised you — that document is the input
   to onboarding client #2.

### 4.11 Go-live checklist & sign-off (`docs/go-live-checklist.md`)
Production: monitoring green, all alerts tested, backup + **restore drill done**, invariants clean for
7 consecutive days, no P1/P2 security findings open, runbook complete, keystore backed up in two places,
`KEY_ENCRYPTION_KEY` backed up separately, admin TOTP enrolled with recovery codes stored offline,
staging still usable for future client integration tests, docs published, pilot exit metrics met.
Sign-off is a dated entry with the evidence links (test runs, drill timings, pilot report).

---

## 5. Files created / modified

```
docs/openapi.yaml                       # finalised, v1 baseline tagged
docs/integration-guide.md               # complete
docs/error-codes.md                     # complete with client actions
docs/webhook-verification/{verify.php,laravel-middleware.php,verify.js,verify.py,wordpress.php,README.md}
docs/client-onboarding-checklist.md
docs/client-agreement-notes.md          # what the platform asserts / limitations (EN + BN one-pager)
docs/android-setup-guide.md             # final EN/BN with per-OEM screenshots
docs/android-quick-reference.md          # printable one-pager
docs/privacy-policy.md                  # published
docs/capacity.md                        # measured load results
docs/security-review.md                 # T1–T13 walkthrough + attempted attacks + findings
docs/compliance-checklist.md
docs/pilot-report.md
docs/go-live-checklist.md
docs/support-playbook.md                # top 10 support scenarios → resolution steps
test/system/{journeys.spec.ts,failure-paths.spec.ts,tenancy.spec.ts,rotation.spec.ts,helpers/*}
test/load/{steady.js,burst.js,collision.js,slow-client.js}
.github/workflows/{system-e2e.yml,nightly.yml}
infra/Caddyfile                         # docs site + per-company APK download paths
architecture.md                         # reconcile any decisions changed during implementation
plan.md                                 # mark delivered scope vs post-v1
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Integration guide usability** | An external developer (or someone who hasn't read the code) integrates a toy site against staging using **only** `docs/integration-guide.md` — register, receive, verify, reconcile — without asking questions. Time it; every question they must ask is a documentation bug to fix. This is the acceptance test for the guide. |
| Snippets | All five verifiers accept a real signed payload; PHP/Node/Python executed in CI; the WordPress and Laravel snippets manually exercised once on a scratch install; each demonstrates the raw-body pitfall. |
| System E2E | All 15 journeys pass against staging, nightly in CI, asserting DB + API + receiver state and clean invariants at the end. |
| Load | All four k6 scenarios meet their thresholds with results recorded; burst scenario produces no duplicate verifications and no queue backlog after the burst. |
| Security | Every T1–T13 control has a named test or documented residual risk; all attempted attacks in §4.8 fail; APK decompilation yields no usable secret; P1/P2 findings closed. |
| Compliance | Every checklist item evidenced (test name, screenshot, or published URL) — not just ticked. |
| Merchant guide | A non-technical person follows it on a Xiaomi phone and completes setup unaided, including battery-opt and autostart steps; note where they hesitate and fix the guide. |
| Pilot | Two weeks of daily reconciliation with zero false verifications, ≥99% of real payments verified, and every discrepancy explained and documented. |
| Restore & rollback rehearsal | Re-run the Task 16 restore drill on production data and one deploy rollback, timed, immediately before sign-off. |
| Docs freshness | A CI check that `docs/openapi.yaml` matches the running API and that every internal doc link resolves. |

**Smoke demo (the final one):** with a real merchant phone and the pilot client's staging site — place an
order, pay from a real wallet, and watch the order flip to PAID with no human involvement; then repeat
with the phone in airplane mode for 10 minutes to show the recovery path, and show the whole chain in the
admin dashboard afterwards.

---

## 7. Acceptance criteria

- [ ] `docs/openapi.yaml` finalised, published as a docs site built in CI, `v1` baseline tagged.
- [ ] `docs/integration-guide.md` proven by an external developer integrating unaided against staging; all questions they raised are resolved in the doc.
- [ ] All five webhook verification snippets ship and work; PHP/Node/Python executed in CI.
- [ ] Client onboarding kit complete: checklist, packet, support expectations, limitations one-pager (EN/BN).
- [ ] `docs/android-setup-guide.md` (EN/BN, per-OEM screenshots) validated by a non-technical person on a Xiaomi device; quick reference printable; privacy policy published and linked in-app.
- [ ] All 15 system journeys automated and passing nightly against staging, ending with clean invariants.
- [ ] All four load scenarios meet thresholds; `docs/capacity.md` states the supported client count with measured evidence.
- [ ] `docs/security-review.md` covers T1–T13 with proof or documented residual risk; APK decompilation, SMS forgery, webhook replay/tamper, SSRF (both vectors), cross-tenant, and brute-force attempts all fail; no open P1/P2 findings.
- [ ] `docs/compliance-checklist.md` fully evidenced.
- [ ] Pilot completed: 2 weeks, **zero false verifications**, ≥99% verification rate, all discrepancies explained, parser corpus expanded from real messages, `docs/pilot-report.md` written.
- [ ] Restore drill and deploy rollback re-rehearsed and timed immediately before sign-off.
- [ ] `docs/go-live-checklist.md` fully ticked with evidence links and a dated sign-off.
- [ ] `architecture.md` and `plan.md` reconciled with what was actually built; post-v1 backlog recorded.

---

## 8. Risks & notes

- **The pilot is the real acceptance test of the whole project**, because it is the first contact between
  the provisional parser rules and real SMS traffic, and between the reliability design and a real
  merchant's phone. Do not onboard a second client until the pilot exit metrics are met — a parser gap
  discovered across five clients is five angry conversations instead of one collaborative one.
- **Zero false verifications is the one non-negotiable metric.** A missed payment is a support ticket; a
  falsely verified payment is a client losing goods for free, and it destroys the trust the product is
  built on. If the pilot shows even one, stop, turn off heuristics for that client, and find the cause
  before going further.
- The integration guide is a product surface, not an afterthought. Every hour spent making the raw-body
  signature pitfall unmissable saves several support conversations, because every client's developer will
  hit it.
- Keep the limitations framing intact under commercial pressure. The platform asserts a *consistent SMS
  was received*, not that funds settled. Clients will ask for stronger language; the honest version is
  what makes the product defensible.
- Expect to reopen earlier tasks during the pilot — most likely Task 05 (rules), Task 14/15 (device
  reliability on the merchant's specific phone), and Task 10 (tuning). That is the plan working as
  intended, not a failure of it.
