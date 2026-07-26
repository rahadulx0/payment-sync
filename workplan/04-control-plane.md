# Task 04 — Control Plane: Admin Identity, Companies, Credentials

| | |
|---|---|
| **Track** | Core |
| **Depends on** | 03 |
| **Unblocks** | 06, 07, 11 |
| **Est. effort** | 4–5 days |
| **Risk** | Medium — this is the only path to full compromise (`architecture.md §13.1 T8`) |

---

## 1. Objective

Build the platform's control plane: admin authentication with mandatory TOTP, company onboarding,
dual-type credential issuance and rotation, per-tenant settings, device administration, and the
audit trail that records every one of these mutations.

At the end of this task **a company can be fully onboarded through the API alone** — no manual SQL —
and the credentials it receives are exactly what the Android app (Task 13) and the client website
(Task 07) will use.

---

## 2. Scope of work

### In scope
- Admin auth: login, TOTP enrolment/verification, recovery codes, JWT access + rotating refresh,
  session listing/revocation, lockout, optional IP allowlist.
- Companies: create, list, get, update, suspend/disable/reactivate.
- Credentials: issue `SERVER` and `DEVICE_ENROLL` keys with one-time reveal, revoke, rotate.
- Webhook secret: generate, rotate with dual-signing window, reveal-once.
- `company_settings`: read/update with validated bounds.
- Devices (admin side): list, detail with health, rename, block/unblock, retire, force-sync directive.
- Audit logging interceptor covering every control-plane mutation.
- Admin bootstrap flow (first-run admin from seed → forced TOTP enrolment).

### Out of scope
- Device *self*-enrollment and heartbeat endpoints → Task 06 (this task creates the credential the
  device presents and the admin views of device state).
- Dashboard UI → Task 11 (this task is API-only, exercised by tests + `curl`).
- Analytics endpoints → Task 10.

---

## 3. Prerequisites

- Task 03: guards, `CredentialService`, `CryptoService`, audit-ready request context, rate limiting.
- Task 02: `admin_users`, `admin_sessions`, `companies`, `company_settings`, `api_keys`, `devices`,
  `audit_logs`, `auth_attempts` tables + seeded admin.

---

## 4. Implementation steps

### 4.1 Admin authentication (`modules/admin/auth/`)
1. **`POST /admin/auth/login`** — email + password.
   - Argon2id verify; dummy-verify on unknown email (no user enumeration, uniform timing).
   - Lockout: 5 consecutive failures → `locked_until = now + 15 min`, exponential on repeats;
     every attempt written to `auth_attempts`; rate limited 10/hour/IP (fail-closed per Task 03).
   - Success with TOTP enrolled → `200 {mfa_required: true, mfa_token}` where `mfa_token` is a
     5-minute single-use JWT with `totp_verified: false` and **no admin scopes**.
   - Success without TOTP enrolled → `200 {enrolment_required: true, mfa_token}`; the only routes
     that token can reach are the TOTP enrolment pair.
2. **`POST /admin/auth/2fa/enroll`** → generates a TOTP secret (`otplib`), stores it
   `CryptoService`-encrypted, returns `otpauth://` URI + QR data URL + 10 single-use recovery codes
   (Argon2-hashed at rest, shown once).
3. **`POST /admin/auth/2fa/verify`** → validates a 6-digit code (±1 step drift) or a recovery code
   (consumed on use); replay of the same code within its step is rejected via a Redis marker.
   Issues the real session.
4. **Sessions**: 15-minute access JWT (`sub`, `jti`, `totp_verified`, `session_family`) +
   30-day refresh token as `httpOnly; Secure; SameSite=Strict; Path=/api/v1/admin/auth` cookie.
   - `POST /admin/auth/refresh` rotates: old token `revoked_at` + `replaced_by` set.
   - **Reuse detection**: presenting an already-rotated refresh token revokes the entire
     `session_family`, writes a `SECURITY` audit row, and raises a P2 alert (Task 16).
   - `POST /admin/auth/logout` (this session) and `POST /admin/auth/logout-all`.
   - `GET /admin/auth/sessions` lists active sessions (IP, UA, created, last used) with revoke.
5. **`POST /admin/auth/password`** — change password (requires current password + a fresh TOTP code),
   revokes all other sessions.
6. IP allowlist middleware for the whole `/admin/*` surface when `ADMIN_IP_ALLOWLIST` is set
   (CIDR list, evaluated against the Caddy-forwarded client IP; misconfiguration must not lock the
   admin out silently — log the rejected IP at warn level).

### 4.2 Audit logging (`modules/admin/audit/`)
- `AuditService.record({actorType, actorId, action, entityType, entityId, before, after, ip, ua})`
  writing to `audit_logs`, with `before`/`after` passed through a **field redactor** (never store a
  key plaintext, TOTP secret, or webhook secret — store `{redacted: true}` markers instead).
- `@Audited('company.suspend')` interceptor for controller methods: captures entity state before and
  after within the same request, writes one row on success only.
- Actions in this task: `company.create|update|suspend|disable|reactivate`,
  `company.settings.update`, `apikey.issue|revoke`, `webhook_secret.rotate`,
  `device.rename|block|unblock|retire|force_sync`, `admin.login|login_failed|2fa_enroll|
  password_change|session_revoke|session_reuse_detected`.
- `GET /admin/audit-logs` with filters (actor, action, entity, company, date range) + cursor paging.
- Append-only in practice: no update/delete endpoints, and a lint restriction on
  `prisma.auditLog.update|delete`.

### 4.3 Companies (`modules/companies/`)
1. **`POST /admin/companies`** — `{name, company_code?, contact_email, contact_phone, notes,
   settings?, default_callback_url?}`.
   - `company_code` auto-generated if omitted (`COMP` + 8 base32 chars, collision-retried).
   - In one transaction: company + `company_settings` (defaults from
     `architecture.md §6.9`, overridable) + webhook secret (generated, encrypted) +
     one `SERVER` key + one `DEVICE_ENROLL` key.
   - Response includes the **one-time reveal** block:
     `{company_code, server_key, device_enroll_key, webhook_secret}` with
     `"warning": "Shown once. Store securely."` — and these values are never retrievable again.
2. `GET /admin/companies` (cursor paging, filters: status, `q` on name/code; each row carries
   counts: devices online/total, pending orders, verified today, open reviews).
3. `GET /admin/companies/:id` — full detail: settings, active keys (prefix + label + last used only),
   webhook config (URL + secret rotation state, **never the secret**), devices, 30-day stats.
4. `PATCH /admin/companies/:id` — name/contacts/notes/`default_callback_url`.
5. `POST /admin/companies/:id/status` — `{status, reason}`:
   - `SUSPENDED` → tenant APIs 403 `COMPANY_SUSPENDED`, **but SMS ingestion continues** (decision in
     `architecture.md §20.6`: nothing is lost on reactivation) and webhook delivery pauses.
   - `DISABLED` → everything rejected including ingestion; device tokens revoked.
   - Reactivation resumes paused webhook events (enqueue sweep) — implemented in Task 09, hook left here.
6. `GET/PUT /admin/companies/:id/settings` — validated bounds:
   `order_ttl_minutes 5–1440`, `late_match_grace_hours 0–168`, `heuristic_window_minutes 1–360`,
   `amount_tolerance 0–1000`, `auto_verify_min_confidence 0.50–1.00`,
   `webhook_timeout_ms 1000–30000`, `webhook_max_attempts 1–12`, `sms_retention_days 30–730`,
   `rate_limit_register_rpm 10–6000`, `allowed_providers` non-empty subset.
   Changing settings **must not** retroactively alter existing orders (Task 02 snapshots tolerance);
   a test asserts this.

### 4.4 Credentials (`modules/credentials/`)
1. `POST /admin/companies/:id/keys` — `{key_type, label, scopes?, expires_at?}` → one-time plaintext.
   Default scopes by type: `SERVER` → `payments:write`, `payments:read`;
   `DEVICE_ENROLL` → `device:enroll`.
2. `DELETE /admin/companies/:id/keys/:keyId` — sets `revoked_at`; effective immediately (guard reads
   `revoked_at`; if Task 03 added a credential cache, revocation must bust it — test covers this).
3. `POST /admin/companies/:id/keys/:keyId/rotate` — issues a replacement of the same type/scopes and
   schedules the old key's revocation after `grace_hours` (default 24, `0` = immediate), so a client
   can deploy the new key without downtime. Grace expiry handled by a Task 16 job; until then, a
   `revoke_at` column read by the guard.
4. `POST /admin/companies/:id/webhook-secret/rotate`:
   - current → `webhook_secret_prev_enc`, new secret generated, `webhook_secret_rotated_at = now`.
   - Task 09 signs with both (`v1` new, `v0` previous) for 7 days; a Task 16 job clears the previous
     secret after the window. Response reveals the new secret once.
5. `GET /admin/companies/:id/keys` — metadata only: `id`, `type`, `prefix`, `label`, `scopes`,
   `last_used_at`, `last_used_ip`, `expires_at`, `revoked_at`, `revoke_at`.
6. **Guard rails**: refuse to revoke the last active `SERVER` key without `?force=true`
   (prevents accidentally cutting off a live client) and warn when revoking a
   `DEVICE_ENROLL` key that devices are currently enrolled against.

### 4.5 Devices — admin views (`modules/devices/admin/`)
- `GET /admin/devices?company_id=&status=&online=` — `online` derived as
  `last_heartbeat_at > now - 2×heartbeat_interval`. Columns: name, company, model/manufacturer,
  Android + app version, last heartbeat, last SMS, battery, permission state, battery-opt state,
  queue depth, clock skew, flags (root/emulator advisory).
- `GET /admin/devices/:id` — detail + recent `device_events` + recent `sms_logs` from that device.
- `PATCH /admin/devices/:id` — `device_name`, `wallet_msisdn`.
- `POST /admin/devices/:id/block` / `/unblock` / `/retire` (retire = revoke token permanently).
- `POST /admin/devices/:id/force-sync` — sets a pending directive consumed by the next heartbeat
  (Task 06). No push infrastructure needed (`architecture.md §11.4.7`).
- `POST /admin/devices/:id/rotate-token` — sets a `rotate_token` directive.

### 4.6 Onboarding ergonomics
- `POST /admin/companies/:id/onboarding-packet` → a **rendered, downloadable** packet (JSON + a
  Markdown/PDF-ready text block) containing: company code, endpoints, the just-issued keys
  (only valid if called in the same request that issues them — otherwise keys are absent and it
  renders the non-secret parts), webhook signature recipe, and Android setup steps.
  This is what gets handed to a client; building it here (rather than assembling it by hand in
  Task 17) makes onboarding repeatable and is the single biggest ops time-saver in the project.
- Sanity endpoint `GET /admin/companies/:id/readiness` → checklist: settings valid, ≥1 active server
  key, ≥1 active device enroll key, webhook secret set, ≥1 device enrolled, ≥1 heartbeat received,
  webhook test succeeded (last two populated by Tasks 06/09). Drives the Task 11 UI checklist.

---

## 5. Files created / modified

```
apps/api/src/modules/admin/auth/{admin-auth.module.ts,admin-auth.controller.ts,admin-auth.service.ts,
                                 totp.service.ts,session.service.ts,recovery-code.service.ts,
                                 ip-allowlist.middleware.ts,dto/*.ts}
apps/api/src/modules/admin/audit/{audit.module.ts,audit.service.ts,audited.interceptor.ts,
                                  audit.controller.ts,redact.ts}
apps/api/src/modules/companies/{companies.module.ts,companies.controller.ts,companies.service.ts,
                                company-settings.service.ts,settings.schema.ts,dto/*.ts}
apps/api/src/modules/credentials/{credentials.module.ts,credentials.controller.ts,
                                  credentials.service.ts,webhook-secret.service.ts,dto/*.ts}
apps/api/src/modules/devices/admin/{devices-admin.controller.ts,devices-admin.service.ts,
                                    device-directive.service.ts}
apps/api/src/modules/companies/onboarding-packet.service.ts
apps/api/prisma/migrations/000X_add_key_revoke_at/migration.sql   # api_keys.revoke_at
apps/api/test/e2e/{admin-auth.e2e-spec.ts,admin-2fa.e2e-spec.ts,companies.e2e-spec.ts,
                   credentials.e2e-spec.ts,settings.e2e-spec.ts,devices-admin.e2e-spec.ts,
                   audit.e2e-spec.ts}
docs/openapi.yaml  docs/runbook.md   # onboarding + rotation procedures
```

---

## 6. Testing & validation

| What | How |
|---|---|
| Login security | Unknown email and wrong password are indistinguishable (status, body, timing within threshold); 5 failures → lockout with correct `locked_until`; lockout clears; every attempt in `auth_attempts`. |
| TOTP | Enrolment returns a working secret (verify with an independent TOTP lib); ±1 step accepted, ±2 rejected; same code twice rejected; recovery code works once then fails; **an access token with `totp_verified:false` cannot reach any `/admin/*` business route**. |
| Session rotation | Refresh rotates and invalidates the old token; reusing a rotated token kills the family, writes the audit row, and logs the security event; `logout-all` invalidates every session. |
| IP allowlist | In-range allowed, out-of-range 403, and the rejected IP is logged; unset = no restriction. |
| Company creation | One transaction creates company + settings + secret + 2 keys; the returned keys authenticate successfully against the Task 03 probe routes; secrets are not retrievable on any subsequent GET (assert absence explicitly). |
| Status transitions | `SUSPENDED`: `/payments/register` 403 but `/sms/upload` still accepted (documented decision); `DISABLED`: both rejected and device tokens revoked; reactivation restores access. |
| Settings | Every bound rejected out of range; valid update persists; an existing PENDING order's `amount_tolerance` unchanged after a settings change. |
| Key lifecycle | Issue → authenticate → revoke → 401 immediately (including through any credential cache); rotate → both keys valid during grace, old dead after; last-server-key revoke blocked without `force`. |
| Webhook secret rotation | `prev` populated; both secrets present; signing behaviour asserted in Task 09 against this state. |
| Devices admin | Online/offline derivation at heartbeat-interval boundaries; block → Task 03 guard 403 `DEVICE_BLOCKED`; directives queued and visible. |
| Audit completeness | Table-driven: perform every mutating endpoint once, assert exactly one audit row each with correct action/entity and **no secret material** in `before`/`after`. A test enumerates control-plane mutating routes and fails if any lacks an audit row — so future endpoints can't silently skip auditing. |
| Onboarding packet | Contains everything a client needs; keys present only on the issuing request; renders without secrets afterwards. |
| Readiness | Reflects true state as prerequisites are satisfied one by one. |

**Smoke demo:** from a clean DB — log in as the seeded admin, enrol TOTP, create a company, download
the onboarding packet, authenticate with the returned server key against `/whoami`, suspend the
company and watch `register` fail while `upload` still works, then show the audit log for the whole session.

---

## 7. Acceptance criteria

- [ ] A company is onboarded end-to-end via API only, producing working `SERVER` + `DEVICE_ENROLL` keys and a webhook secret, each revealed exactly once.
- [ ] TOTP is mandatory: no `/admin/*` business route is reachable without `totp_verified`.
- [ ] Refresh-token rotation with reuse detection works and is audited; lockout and `auth_attempts` logging verified.
- [ ] Key revoke takes effect immediately; rotation supports a grace window; webhook secret rotation stores the previous secret for dual-signing.
- [ ] `company_settings` validated within documented bounds and snapshotted per order (no retroactive effect).
- [ ] Device admin actions work; directives are queued for the next heartbeat; block is enforced by the guard.
- [ ] Every control-plane mutation writes an audit row with no secret material; the "all mutating routes are audited" enumeration test passes.
- [ ] `SUSPENDED` vs `DISABLED` semantics implemented exactly as documented, with tests.
- [ ] Onboarding packet + readiness checklist endpoints work.
- [ ] `docs/runbook.md` documents onboarding, key rotation, webhook-secret rotation, and admin lockout recovery; `docs/openapi.yaml` regenerated.

---

## 8. Risks & notes

- **One-time reveal is a real constraint, not a UX nicety.** Since keys are Argon2-hashed
  (`architecture.md §6.2`), a lost key can only be rotated, never recovered. The onboarding packet
  exists so that reality is workable.
- The `SUSPENDED`-still-ingests decision means a non-paying client's SMS keep accumulating. That is
  deliberate (reactivation loses nothing) but it is also unbounded storage for a client who never
  returns — Task 16's retention purge is what bounds it.
- Admin lockout recovery has no self-service path by design. The runbook procedure (direct DB update
  of `locked_until` / `failed_login_count` on the VPS) must be written down here, or a future lockout
  becomes an outage.
- Do not let the dashboard (Task 11) become the only place these flows are exercised. Every endpoint
  here has an e2e test so a UI bug is never mistaken for a backend bug.
