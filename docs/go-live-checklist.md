# Go-live checklist

Sign-off is a **dated entry with evidence links**, not a set of ticks. Anything unticked below is a
reason not to onboard a paying client yet.

## Engineering — done and verified

- [x] Money path implemented end to end: register → capture → parse → match → verify → signed webhook
- [x] **343 automated tests green** (`pnpm test`), including the adversarial zero-false-verification
      suite and 20×20 concurrency proving exactly one verification
- [x] Correctness invariants clean after every suite, including the full system-journey run
- [x] Cross-tenant isolation attempted and rejected (`apps/api/test/system/journeys.spec.ts`)
- [x] Android app builds (debug, release-minified, instrumented) with the parser-parity gate green
- [x] Admin dashboard builds (21 routes)
- [x] `docs/openapi.yaml` regenerated from the running API
- [x] Documentation: integration guide, error codes, webhook verifiers, admin guide, runbook,
      operations, support playbook, privacy policy, onboarding checklist, limitations one-pager

## Infrastructure — blocked on a VPS

- [ ] Production + staging stacks deployed; TLS issued; only 80/443 reachable (external scan)
- [ ] CI deploy exercised: migration-abort, health-gate rollback, and smoke-fail paths each demonstrated
- [ ] Zero failed requests during a rolling deploy under load
- [ ] Prometheus scraping; all four dashboards populated with no empty panels
- [ ] **Every P1/P2/P3 alert induced** and confirmed on both channels with a working runbook link
- [ ] Nightly encrypted backup running; corrupted-artifact detection verified
- [ ] **Timed restore drill performed**, ending with invariants clean and the journey test passing on
      restored data; RTO recorded
- [ ] "Redis loss is recoverable" verified by flushing Redis with pending events
- [ ] `KEY_ENCRYPTION_KEY` rotation proven on staging

## Android — blocked on hardware

- [ ] `docs/device-matrix.md` executed on Xiaomi / Oppo / Samsung / stock with **zero "lost"** outcomes
- [ ] MITM proxy blocked by pinning; backup pin alone sufficient; rotation rehearsed
- [ ] Release APK decompiled — no server key, enroll key, or webhook secret recoverable
- [ ] Signed APK from CI installs and updates over a previous CI release
- [ ] 24 h battery measurement per device class within budget
- [ ] Bengali reviewed by a native speaker; large font scales render correctly

## Security — mostly done

- [x] `docs/security-review.md` walks T1–T13 with a named test or documented residual risk
- [x] Attempted attacks fail: device-token privilege escalation, cross-tenant read, key/company
      mismatch, admin surface via server key, webhook tamper, send-time SSRF, redirect following,
      KEK rotation with a wrong key
- [ ] Dependency audit (`pnpm audit`, Gradle review, base-image CVE scan) triaged
- [ ] TLS/header grading (`testssl.sh`) on both hosts
- [ ] No open P1/P2 findings at sign-off

## Pilot — not started

- [ ] One merchant, 2 weeks, conservative settings (`heuristic_enabled = false` to start)
- [ ] **Zero false verifications** — the one non-negotiable metric
- [ ] ≥99% of real payments verified, every discrepancy explained
- [ ] Parser corpus expanded from the merchant's real messages (expect ≥1 rule bump per provider)
- [ ] `docs/pilot-report.md` written, including what surprised you

## Operational readiness

- [ ] Admin TOTP enrolled; recovery codes stored offline
- [ ] Android keystore backed up in **two** places; custody recorded
- [ ] `KEY_ENCRYPTION_KEY` backed up **separately from the database**
- [ ] Invariants clean for 7 consecutive days
- [ ] Restore drill and one deploy rollback re-rehearsed immediately before sign-off

---

## Sign-off

|           |                                                        |
| --------- | ------------------------------------------------------ |
| Date      | _pending_                                              |
| Signed by | _pending_                                              |
| Evidence  | test run, drill timings, pilot report, security review |

**Current status: not ready for a paying client.** The software is built and verified to the limit of
what can be verified without hardware; what remains is deployment, the device matrix, and the pilot —
and the pilot is the real acceptance test of the whole project, because it is the first contact between
provisional parser rules and real SMS traffic.
