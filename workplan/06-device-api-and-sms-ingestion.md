# Task 06 — Device API & SMS Ingestion

| | |
|---|---|
| **Track** | Core |
| **Depends on** | 04, 05 |
| **Unblocks** | 08, 13 |
| **Est. effort** | 4–5 days |
| **Risk** | Medium — this contract is consumed by an app on hardware you don't control; breaking it later means an APK re-release per client |

---

## 1. Objective

Implement the complete device-facing API from `architecture.md §7.2`: enrollment, heartbeat with
server directives, config distribution, and the **SMS ingestion pipeline** with exact-once semantics.

This is the contract the Android app is built against, so it must be finalized and published in
`docs/openapi.yaml` before Task 13 starts.

---

## 2. Scope of work

### In scope
- `POST /device/register` — enroll key → device row + device token.
- `POST /device/heartbeat` — telemetry in, directives out, clock-skew computation.
- `GET /device/config` — provider allowlist + parser rules + tunables, ETag-cached.
- `POST /sms/upload` — batch ingestion with per-message results and dedupe.
- `POST /device/token/rotate`, `POST /device/events`.
- Ingestion pipeline: validate → dedupe → persist → parse → **matching hook (stub)** → results.
- Device health derivation, offline-detection data, `last_sms_at` tracking.
- Rate limits and payload caps per device.

### Out of scope
- Matching logic → Task 08 wires into the hook this task leaves.
- Android client → Tasks 13–15.
- Push notifications — deliberately none; directives ride on heartbeat responses.

---

## 3. Prerequisites

- Task 04: `DEVICE_ENROLL` keys issued, device admin views, directive service.
- Task 05: `ParserService`, rule repository, `config_version`.
- Task 03: `DeviceTokenGuard`, rate limiting, idempotency, metrics.

---

## 4. Implementation steps

### 4.1 Enrollment — `POST /device/register`
Request: `{company_code, enroll_key, install_id, device_name?, model, manufacturer,
android_version, app_version, wallet_msisdn?}`.

1. Rate limited 5/hour/company (Task 03) and 10/day/`install_id`.
2. Verify `enroll_key` is an active `DEVICE_ENROLL` key for `company_code`; company `ACTIVE`.
3. **Re-enrollment semantics** (must be explicit, it happens constantly in the field):
   - unknown `install_id` → create device;
   - known `install_id`, `ACTIVE`/`BLOCKED` → **rotate the token on the existing row**, keep history
     and `device_name`; `BLOCKED` returns 403 without issuing;
   - `RETIRED` → 403 `DEVICE_RETIRED` (admin must un-retire).
4. Optional device cap per company (`company_settings.max_devices`, default 1 for v1 per
   `architecture.md §20.5`; schema and code support n): exceeding it → 409 `DEVICE_LIMIT_REACHED`
   listing existing devices so the merchant/admin can retire the old phone.
5. Issue a device token (`randomToken(32)`, `pdt_` prefix), store Argon2id hash, set
   `token_issued_at`.
6. Response: `{device_id, device_token, device_name, config, server_time}`.
   `server_time` lets the app compute skew immediately.
7. Audit row + `auth_attempts` entry; metric `device_enrollments_total{result}`.

### 4.2 Heartbeat — `POST /device/heartbeat`
Request: `{app_version, android_version, battery_pct, is_charging, is_ignoring_battery_opt,
has_sms_permission, network_type, pending_upload_count, failed_upload_count, last_sms_local_at,
device_now, config_version, flags:{is_rooted?, is_emulator?}}`.

1. Rate limited 10/min/device (normal cadence is 15 min; allow burst after reconnect).
2. Persist telemetry; `last_heartbeat_at = now`;
   `clock_skew_seconds = round(server_now − device_now)`; flag `CLOCK_SKEW_HIGH` when `|skew| > 300`.
3. **Directives out** (consumed and cleared atomically):
   `{force_full_sync, rotate_token, config_version, config_changed, message_for_user,
     requested_heartbeat_interval_sec, pause_uploads}`.
   - `config_changed` is derived by comparing the device's `config_version` to the server's — the app
     then calls `/device/config`, so config never rides on the heartbeat payload.
   - `message_for_user` is how support reaches a merchant without a phone call ("Please re-enable SMS
     permission").
4. Health signals for Task 16 alerts: gauges `devices_online`, `device_queue_depth{device}`,
   counters for permission-lost and battery-opt-disabled states.
5. Response: `{server_time, directives, next_heartbeat_after_sec}`.

### 4.3 Config — `GET /device/config`
- Response: `{config_version, providers:[{provider, sender_addresses[]}],
  parser_rules:{bkash|nagad|upay: <rule json>}, upload:{max_batch, max_body_bytes,
  retry_base_sec, max_attempts}, heartbeat_interval_sec, reconcile_interval_hours,
  inbox_scan_days, retention_days, min_supported_app_version}`.
- `ETag: W/"<config_version>"`; `If-None-Match` → `304`. Cache-Control private, short.
- `min_supported_app_version` gives a documented kill-switch: an app below it shows a mandatory
  update screen (Task 15) instead of silently failing against a changed contract.
- Served from the Task 05 in-memory cache; no per-request DB read for rules.

### 4.4 Ingestion — `POST /sms/upload`
Request per `architecture.md §7.2`: `{upload_source, messages[]}`, `max_batch = 50`,
body ≤ 256 KB, each message `{client_msg_hash, sms_address, raw_message, device_received_at,
device_sms_timestamp?, parsed_hint?}`.

Pipeline — **per message, independently, never failing the batch**:
1. **Validate**: `client_msg_hash` is 64 hex chars; `sms_address` ≤32 chars, non-empty;
   `raw_message` 1–1000 chars; timestamps parseable and not >24 h future (clock-skew corrected using
   the stored `clock_skew_seconds`, with the raw device value kept). Invalid → `REJECTED` +
   `reason` (never a 400 for the whole batch — one malformed message must not block 49 good ones).
2. **Dedupe** — `INSERT … ON CONFLICT (company_id, client_msg_hash) DO NOTHING` then read back.
   - Conflict → `status: DUPLICATE` with the existing `sms_log_id`, existing `parse_status`/
     `match_status`. **2xx, not an error** (`architecture.md §7.2`).
   - Secondary dedupe: `content_hash` (server-normalised body + address + company). A different
     `client_msg_hash` with a matching `content_hash` within 7 days → `DUPLICATE` with
     `reason: CONTENT_MATCH`, which is what catches re-uploads after an app reinstall (new hash salt,
     same message). Log both ids for auditability.
3. **Persist**: `sms_logs` row with `device_id`, `upload_source`, `uploaded_at = now`, raw body.
4. **Parse** via Task 05 `ParserService` (server-authoritative; hint stored and compared).
5. **Match hook**: `await this.matchingHook.onSmsIngested(smsLog)` — in this task a no-op
   implementation that returns `match_status: 'UNMATCHED'`; Task 08 replaces it. Keep the interface
   narrow (`{onSmsIngested(smsLog): Promise<MatchOutcome>}`) so Task 08 is a drop-in.
6. **Result**: `{client_msg_hash, status, sms_log_id, parse_status, match_status,
   server_extraction:{transaction_id, amount, provider}}`.
7. Batch response adds `summary:{accepted, duplicates, rejected, matched}` and `config_version`.
8. Update `devices.last_sms_at`; metrics `sms_uploads_total{provider,source,status}`,
   `sms_upload_batch_size`, `sms_ingest_duration_seconds`.

**Transaction boundaries:** each message is its own short transaction (persist + parse), so one
failure can't roll back the batch. Matching opens its own transaction in Task 08. Never wrap 50
messages in one long transaction — it would hold locks across the whole batch.

**Ordering:** messages within a batch are processed in ascending `device_sms_timestamp` so that when
two SMS could match one order, the earlier payment wins deterministically.

### 4.5 Token rotation & events
- `POST /device/token/rotate` — authenticated with the current token; issues a new one, keeps the old
  valid for 24 h (`token_rotated_at` + a `prev_token_hash` column, added in this task's migration),
  so a crash mid-rotation can't brick a device.
- `POST /device/events` — batch of `{type, at, detail}`; types:
  `PERMISSION_GRANTED|PERMISSION_REVOKED|BOOT_COMPLETED|BATTERY_OPT_CHANGED|
   UPLOAD_FAILED|PARSE_FAILED_LOCAL|MANUAL_SYNC_RUN|FOREGROUND_SERVICE_TOGGLED|APP_UPDATED`.
  Stored in a `device_events` table (added here: `id, device_id, company_id, type, at, detail jsonb,
  created_at`, retention 30 days). Surfaced in Task 12's device detail screen — this is the
  remote-diagnostics channel that makes supporting a merchant's phone possible without touching it.

### 4.6 Ingestion safety rails
- Per-device daily message cap (`company_settings.max_sms_per_day`, default 2000) → beyond it,
  `REJECTED` with `reason: DAILY_CAP` + a P2 alert. Protects against a runaway loop or a hostile
  device flooding storage (`architecture.md §13.1 T11`).
- `SUSPENDED` company: uploads accepted (per the Task 04 decision), matching still runs, webhook
  delivery paused in Task 09 — assert this end-to-end here.
- `DISABLED` company or `BLOCKED` device: 403 at the guard.
- Duplicate `client_msg_hash` **within the same batch** → first processed, rest `DUPLICATE`.

---

## 5. Files created / modified

```
apps/api/src/modules/devices/{devices.module.ts,device-enroll.controller.ts,device-enroll.service.ts,
                              heartbeat.controller.ts,heartbeat.service.ts,
                              device-config.controller.ts,device-config.service.ts,
                              device-token.service.ts,device-events.controller.ts,
                              device-health.ts,dto/*.ts}
apps/api/src/modules/sms/{sms.module.ts,sms-upload.controller.ts,ingestion.service.ts,
                          dedupe.service.ts,matching.hook.ts,dto/*.ts}
apps/api/prisma/migrations/000X_device_events_and_prev_token/migration.sql
apps/api/test/e2e/{device-enroll.e2e-spec.ts,heartbeat.e2e-spec.ts,device-config.e2e-spec.ts,
                   sms-upload.e2e-spec.ts,sms-dedupe.e2e-spec.ts,ingest-caps.e2e-spec.ts}
apps/api/test/perf/sms-upload.bench.ts
docs/openapi.yaml            # device API frozen here — Task 13 builds against it
docs/device-api.md           # sequence diagrams + field semantics for the Android developer
```

---

## 6. Testing & validation

| What | How |
|---|---|
| Enrollment | Valid key → device + token that authenticates; wrong/revoked key → 401; suspended company → 403; re-enroll same `install_id` → same device row, new token, old token dead; `BLOCKED` → 403; `RETIRED` → 403; device cap → 409 listing existing devices; rate limit at the 6th attempt in an hour. |
| **Dedupe (critical)** | Same message twice → one `sms_logs` row, second returns `DUPLICATE` + same id + **2xx**; 50 identical messages in one batch → 1 accepted, 49 duplicates; same body with a different `client_msg_hash` (simulated reinstall) → `DUPLICATE` via `content_hash`; concurrent duplicate batches from two connections → still exactly one row (unique index proves it). |
| Batch resilience | A batch of 50 with 3 malformed and 2 duplicates returns 50 results with correct statuses, HTTP 202, and persists 45 rows. |
| Ordering | Two credit SMS for the same amount in one batch are processed oldest-first (assert `sms_logs` creation order and, once Task 08 lands, that the earlier one matches). |
| Parse integration | Credit message → `PARSED` + extraction; Cash Out message → `IGNORED`; unknown address → `UNPARSED` + `SUSPICIOUS_ADDRESS` flag; hint mismatch recorded without changing the result. |
| Heartbeat | Skew computed with correct sign; `CLOCK_SKEW_HIGH` flag at >300 s; directives delivered exactly once then cleared; `config_changed` flips after a rule activation; `devices_online` gauge reflects reality at the interval boundary. |
| Config | ETag → 304 on repeat; `config_version` bumps after activating a rule (Task 05) and the response changes; malformed `If-None-Match` handled. |
| Token rotation | New token works, old token works for 24 h then 401; rotation directive round-trips through heartbeat. |
| Caps | Daily cap enforced and alert-metric incremented; body >256 KB → 413 `PAYLOAD_TOO_LARGE`; batch >50 → 400 `VALIDATION_ERROR`. |
| Suspended company | Upload accepted, order register rejected — asserted in one test to lock the documented behaviour. |
| Cross-tenant | Device token of company A cannot upload under `X-Company-Id: B`; cannot read B's config. |
| Performance | 50-message batch p95 < 400 ms with parse enabled (Testcontainers, warm); 1000 messages sequentially without connection-pool exhaustion; Argon2 auth cost measured against the Task 03 note. |
| Contract freeze | `docs/openapi.yaml` reviewed field-by-field with the Android work in mind; `oasdiff` baseline tagged `device-api-v1`. |

**Smoke demo:** with `curl` only — enroll a device using the seeded enroll key, fetch config, upload
the three `plan.md` sample messages plus one Cash Out in a single batch, show the four differing
results, re-upload the same batch and show four `DUPLICATE`s, then send a heartbeat and show it in
`GET /admin/devices`.

---

## 7. Acceptance criteria

- [ ] Device enrolls with a `DEVICE_ENROLL` key and receives a working device token; every re-enrollment case behaves as documented.
- [ ] Duplicate uploads are impossible to double-store and always return 2xx with the original `sms_log_id`; both hash paths (`client_msg_hash`, `content_hash`) tested including concurrency.
- [ ] A batch never fails as a whole: per-message results with `ACCEPTED|DUPLICATE|REJECTED` and reasons.
- [ ] Messages are ingested oldest-first within a batch.
- [ ] Server-side parse runs on ingest; device hints are recorded but provably non-authoritative.
- [ ] Heartbeat records telemetry, computes clock skew, and delivers-then-clears directives exactly once.
- [ ] `/device/config` is ETag-cached and reflects rule/profile changes via `config_version`.
- [ ] Token rotation supports a 24 h overlap; `device_events` recorded and queryable.
- [ ] Caps enforced: batch size, body size, daily message cap, per-device rate limit.
- [ ] `SUSPENDED` company still ingests; `DISABLED`/`BLOCKED` are rejected at the guard.
- [ ] `matching.hook.ts` interface in place, no-op implementation, documented as Task 08's insertion point.
- [ ] Device API section of `docs/openapi.yaml` frozen and tagged; `docs/device-api.md` written for the Android developer.

---

## 8. Risks & notes

- **This contract is expensive to change.** Once clients have the APK, a breaking device-API change
  means coordinating an update across every merchant phone. Hence: `config_version` for tunables,
  `min_supported_app_version` as a kill switch, additive-only DTO evolution, and the `oasdiff`
  baseline tag. Spend the extra hour on field review now.
- `DUPLICATE` returning 2xx is not a style choice — if duplicates were errors, the app's retry loop
  (Task 14) would never settle a message that the server already has, and the queue would grow forever.
- The `content_hash` secondary dedupe matters more than it looks: reinstalls are common (merchant
  changes phone, clears data), and without it every reinstall re-uploads the entire inbox as "new".
- Keep the matching hook a **no-op that returns a value**, not a `TODO`. Task 08 then only swaps the
  implementation, and the ingestion tests written here stay valid.
