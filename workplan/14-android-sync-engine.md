# Task 14 — Android II: Sync Engine, Manual Sync, Heartbeat & Diagnostics

| | |
|---|---|
| **Track** | Android |
| **Depends on** | 13 (+09 deployed for end-to-end visibility) |
| **Unblocks** | 15 |
| **Est. effort** | 5–7 days |
| **Risk** | High — this is the component that makes the platform survive real-world phones (`architecture.md §11.4`) |

---

## 1. Objective

Implement the upload/sync engine from `architecture.md §11.3–§11.4`: durable queue processing with
WorkManager, per-message settlement from batch results, the **Manual Sync** feature, the reconcile
scan, heartbeat with server directives, retention purge, and the Diagnostics screen that makes remote
support possible.

The guarantee this task delivers: **an SMS captured on the phone always reaches the server eventually** —
across airplane mode, force-close, reboot, and battery-optimisation kills.

---

## 2. Scope of work

### In scope
- `UploadWorker` (expedited, batched, unique work) + the sync state machine.
- Per-message settlement of `ACCEPTED` / `DUPLICATE` / `REJECTED` results.
- Error policy: 401 → re-enroll state, 403 blocked, 429 backoff, 5xx/network retry, terminal failures.
- `ManualSyncWorker` + UI with progress and a truthful summary.
- `ReconcileWorker` (6 h inbox re-scan) and `HeartbeatWorker` (15 min) with directive handling.
- `PurgeWorker` (retention) and `BootReceiver` (reschedule).
- Dashboard, Transactions, and Diagnostics screens on real data.
- Local notifications for states the merchant must act on.

### Out of scope
- Cert pinning, R8, OEM autostart, foreground service, release channel → Task 15.
- Server-side changes — everything consumed here exists after Task 06/09.

---

## 3. Prerequisites

- Task 13: capture pipeline, Room, credential store, API client, `UploadScheduler` port (no-op).
- Task 06: `/sms/upload` per-message results, `/device/heartbeat` directives, `/device/events`.
- Task 09 deployed (staging is fine): needed to observe the full chain to webhook delivery.

---

## 4. Implementation steps

### 4.1 Sync state machine (`domain/sync/`)
States per `architecture.md §11.3`: `PENDING → UPLOADING → UPLOADED | DUPLICATE | REJECTED | FAILED`,
plus `NEEDS_REENROLL` as a device-level (not message-level) condition.

Transition rules, implemented as a pure function over `(currentState, event)` so they can be unit-tested
exhaustively:
| Event | Result |
|---|---|
| enqueue | `PENDING`, `nextAttemptAt = now` |
| claim by worker | `UPLOADING` (with a stale-claim timeout of 5 min so a killed worker's rows return to `PENDING`) |
| result `ACCEPTED` | `UPLOADED`, store `serverSmsLogId` + `serverMatchStatus` |
| result `DUPLICATE` | `UPLOADED` (**not** an error — `architecture.md §7.2`), store the returned id |
| result `REJECTED` | `REJECTED`, store reason; no further retries; surfaced in Diagnostics |
| HTTP 401 | leave row `PENDING`, set device `NEEDS_REENROLL`, stop all upload work, notify merchant |
| HTTP 403 blocked/suspended | leave `PENDING`, show a support message, back off to hourly |
| HTTP 429 | `PENDING`, `nextAttemptAt = now + Retry-After` |
| 5xx / network | `PENDING`, `attemptCount++`, exponential backoff |
| `attemptCount > 10` | `FAILED` — still retried by Manual Sync and Reconcile, never dropped |

**Nothing is ever deleted before it is `UPLOADED` and past the retention window** (Task 13's purge query).

### 4.2 `UploadWorker` (`work/UploadWorker.kt`)
- `CoroutineWorker`, `setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)` for the
  realtime path, `NetworkType.CONNECTED` constraint.
- Unique work name `upload-queue` with `ExistingWorkPolicy.APPEND_OR_REPLACE` — one queue drainer, never
  a worker per message (that would burst 50 requests and hit the rate limit).
- Loop: claim up to `max_batch` (config, default 50) `PENDING` rows with `nextAttemptAt <= now`,
  ordered by `smsTimestamp ASC` (oldest first — matching semantics in Task 08 depend on ordering),
  build the batch, POST, settle each result by `clientMsgHash`, repeat until the queue is empty or a
  terminal condition occurs.
- Backoff: `WorkManager` `BackoffPolicy.EXPONENTIAL` (30 s base) for worker-level retries **plus**
  per-row `nextAttemptAt`. Rows are the source of truth; the worker is just a pump.
- Partial batch failure is handled per row from the response; a transport failure leaves the whole batch
  `PENDING` with incremented attempts.
- Result reporting: `Result.success()` when the queue drains, `Result.retry()` on transport failure,
  `Result.failure()` only for `NEEDS_REENROLL` (so WorkManager stops hammering).
- Every upload attempt writes an `event_log` row (counts and error classes only — never message bodies).

### 4.3 `ManualSyncWorker` + UI (`architecture.md §5.3`)
The recovery feature that covers every real-world failure mode. Steps, exactly as specified:
1. `InboxScanner` over the last `inbox_scan_days` (config, default 7; user-selectable up to 30),
   allowlist-filtered.
2. Compute `clientMsgHash` per message; upsert into Room (ignore-on-conflict) so previously-missed
   messages become `PENDING`.
3. Local diff: everything not `UPLOADED` (`PENDING`, `FAILED`, stale `UPLOADING`) is queued.
4. Upload in batches of ≤50 with `upload_source = MANUAL_SYNC` (this is what triggers the server-side
   rescan of all unmatched transactions in Task 08).
5. Settle results, healing local state from `DUPLICATE` responses (a reinstalled app re-learns its
   server ids this way).
6. Report a **truthful** summary: `scanned`, `already known`, `newly found`, `uploaded`,
   `duplicates`, `rejected`, `matched`, `still pending`, plus errors. No "Sync complete ✓" when
   messages remain unsent — the merchant needs to know.
7. Progress via `setProgress` → observed by the ViewModel; cancellable; a second tap while running
   attaches to the existing run instead of starting a duplicate.

UI: a prominent button on the Dashboard, a determinate progress bar with the current phase
("Scanning inbox… 42/120"), the result summary, and a "copy details" action for support.

### 4.4 `ReconcileWorker` (6 h)
- Periodic, `NetworkType.CONNECTED`, flex window: the automatic version of Manual Sync — the mechanism
  that makes correctness independent of the broadcast arriving (`architecture.md §11.4.1`).
- Silent unless it finds something; if it recovers messages, it writes an `event_log` entry and
  (when >0 messages were missed) posts a low-priority notification so the merchant learns their phone
  is dropping broadcasts — that is actionable information (they should enable the Task 15 measures).
- Also reconciles the other direction: rows stuck `UPLOADING` past the stale timeout are returned to
  `PENDING`.

### 4.5 `HeartbeatWorker` (15 min)
- Sends the full telemetry payload from `architecture.md §7.2`: app/Android version, battery + charging,
  `is_ignoring_battery_opt`, `has_sms_permission`, network type, `pending_upload_count`,
  `failed_upload_count`, `last_sms_local_at`, `device_now`, `config_version`, root/emulator advisory flags.
- Handles directives:
  | Directive | Action |
  |---|---|
  | `force_full_sync` | enqueue `ManualSyncWorker` immediately |
  | `rotate_token` | call `/device/token/rotate`, store new token, keep the old as `prevDeviceToken` until confirmed |
  | `config_changed` | fetch `/device/config`, update cache, reload parser rules |
  | `message_for_user` | show a notification + a persistent banner on the Dashboard |
  | `pause_uploads` | stop the queue drainer until the next heartbeat clears it |
  | `requested_heartbeat_interval_sec` | reschedule the periodic work |
  | `min_supported_app_version` breach | show a blocking update screen (wired in Task 15) |
- Clock skew: store the server-reported delta and use it to correct `device_received_at` on upload.
- Runs even when the upload queue is empty — heartbeat is the platform's liveness signal
  (`architecture.md §15.3`), so it must never be skipped as an "optimisation".
- On permission loss detected here: notify the merchant immediately and report the event.

### 4.6 `PurgeWorker` (daily) & `BootReceiver`
- Purge: delete `UPLOADED` rows older than `retention_days` (config, default 30) and trim `event_log`
  to 500 rows. Never touches un-uploaded rows.
- `BootReceiver` (`RECEIVE_BOOT_COMPLETED`): re-enqueue all periodic work (WorkManager mostly survives
  reboot, but not on every OEM), then run one reconcile pass — the boot gap is exactly when messages get
  missed.
- Also re-enqueue on app update (`MY_PACKAGE_REPLACED`) and on app start (idempotent unique work).

### 4.7 Screens on real data
1. **Dashboard**: connection/enrollment state; last sync time (relative); today's captured / uploaded /
   verified counts from Room; pending-upload badge; a **Manual Sync** button; a warning card when
   anything needs attention (permission missing, battery-opt not exempt, `NEEDS_REENROLL`, uploads
   failing, server message).
2. **Transactions**: local list — provider, amount (via `Money`), TrxID, captured time, sync status,
   server match status — with filters (all / pending / failed / matched) and a per-row retry. Detail
   sheet shows the raw message, local parse, sync history, and server ids.
3. **Diagnostics** (`architecture.md §11.6`): permission states, battery-opt state, autostart hint,
   network, queue depth, failed count, clock skew, last heartbeat + response, config version,
   parser rule versions, app/Android/device info, and the `event_log` timeline. A **Copy diagnostics**
   button produces a redacted text block (no message bodies, no token) that a merchant can send over
   WhatsApp. This single button is what makes remote support viable.
4. Notifications (channels: Sync, Attention): permission revoked, `NEEDS_REENROLL`, uploads failing for
   >6 h, server message, manual-sync completion with unsent messages remaining. Rate-limited so the app
   never becomes a nag.

---

## 5. Files created / modified

```
apps/android/app/src/main/kotlin/com/inovisolutions/paymentsync/
  domain/sync/{SyncStateMachine.kt,SyncEvent.kt,SyncPolicy.kt,BackoffCalculator.kt}
  domain/usecase/{UploadPending.kt,RunManualSync.kt,SendHeartbeat.kt,ApplyDirectives.kt,
                  PurgeOldMessages.kt,ReconcileInbox.kt}
  work/{UploadWorker.kt,ManualSyncWorker.kt,ReconcileWorker.kt,HeartbeatWorker.kt,PurgeWorker.kt,
        WorkScheduler.kt,BootReceiver.kt,PackageReplacedReceiver.kt}
  data/remote/{UploadApi.kt,HeartbeatApi.kt,dto/*.kt}
  data/local/SmsMessageDao.kt                   # claim/settle/stale-reclaim queries
  notifications/{NotificationChannels.kt,SyncNotifier.kt}
  ui/dashboard/{DashboardScreen.kt,DashboardViewModel.kt,AttentionCard.kt,ManualSyncSheet.kt}
  ui/transactions/{TransactionsScreen.kt,TransactionsViewModel.kt,TransactionDetailSheet.kt}
  ui/diagnostics/{DiagnosticsScreen.kt,DiagnosticsViewModel.kt,DiagnosticsFormatter.kt}
apps/android/app/src/test/kotlin/.../{SyncStateMachineTest.kt,BackoffCalculatorTest.kt,
                                      SettlementTest.kt,DiagnosticsFormatterTest.kt,
                                      DirectiveHandlerTest.kt}
apps/android/app/src/androidTest/kotlin/.../{UploadWorkerTest.kt,ManualSyncTest.kt,
                                             HeartbeatTest.kt,OfflineRecoveryTest.kt,
                                             ReconcileTest.kt,PurgeTest.kt,BootRescheduleTest.kt}
docs/android-setup-guide.md      # manual sync + troubleshooting sections
```

---

## 6. Testing & validation

### 6.1 Unit
- **State machine**: exhaustive `(state × event)` table including every row in §4.1; `DUPLICATE`
  settles as success; `REJECTED` is terminal; 401 escalates to a device-level state, not per-row failure.
- **Backoff**: schedule matches the documented curve with jitter; `Retry-After` honoured and capped.
- **Settlement**: a 50-message response containing accepted/duplicate/rejected in mixed order settles
  every row correctly by hash, and an unknown hash in the response is logged without crashing.
- **Directives**: each directive triggers exactly the right action; unknown directives are ignored
  (forward compatibility).
- **Diagnostics formatter**: contains no token, no message body, no MSISDN beyond the merchant's own.

### 6.2 Instrumented (the ones that matter)
| Scenario | Assertion |
|---|---|
| **Airplane-mode recovery** | Enable airplane mode → inject 5 SMS → all `PENDING` → disable → within one backoff cycle all `UPLOADED` and present server-side (MockWebServer or the real staging API) |
| **Force-close recovery** | Inject 5 SMS with the app killed (`am force-stop`) → open the app → Manual Sync recovers 100% |
| **Reboot** | Inject SMS while the app is stopped, reboot the device/emulator, assert periodic work re-registered and a reconcile pass recovers everything |
| **Manual sync dedupe** | Run Manual Sync twice back to back → second run reports duplicates and creates no new server rows |
| **Reinstall healing** | Clear app data, re-enroll, Manual Sync → server returns `DUPLICATE` for known messages → local state healed with server ids, zero new `sms_logs` rows |
| **Stale `UPLOADING`** | Kill the worker mid-batch → rows return to `PENDING` after the stale timeout and upload successfully |
| **Duplicate suppression** | Inject the identical SMS twice → one Room row, one server row |
| **429** | Server returns 429 + `Retry-After: 30` → next attempt after ≈30 s, not immediately |
| **401** | Server returns 401 → `NEEDS_REENROLL`, uploads stop, notification shown, re-enrollment restores the queue with nothing lost |
| **Rate-limit safety** | 200 queued messages upload in batches of 50 (4 requests), never 200 requests |
| **Heartbeat directives** | `force_full_sync` runs a sync; `config_changed` reloads rules (assert the parser uses the new version); `message_for_user` shows a notification; `rotate_token` swaps the token and the next upload succeeds |
| **Clock skew** | Set the device clock 10 minutes ahead → skew reported → `device_received_at` corrected on upload |
| **Purge** | `UPLOADED` rows past retention deleted; `PENDING`/`FAILED` rows of any age retained |
| **Battery/doze** | `adb shell dumpsys deviceidle force-idle` → expedited work still runs or queues and drains on idle exit; nothing lost |
| **Long-run soak** | 200 SMS injected over 30 minutes with the network toggled every 2 minutes → 100% uploaded, zero duplicates, queue drains to zero |

### 6.3 End-to-end with the platform
Against staging (Task 16's early slice): register an order via `curl`, inject the matching SMS on the
device, and assert the chain — Room `UPLOADED` → server `sms_logs` `MATCHED` → `verified_transactions`
row → webhook delivered to the test receiver. Then repeat with the device offline for 10 minutes to
prove the late path (and, if it exceeds the order TTL, the `was_late` webhook flag from Task 08).

**Smoke demo:** on a real phone — turn on airplane mode, inject three payment SMS, show them pending;
restore network and show them uploading and the orders verifying in the dashboard; then force-stop the
app, inject two more, reopen, tap Manual Sync, and show the honest summary and the recovered messages.

---

## 7. Acceptance criteria

- [ ] Sync state machine implemented as a pure function with exhaustive unit coverage; `DUPLICATE` treated as success.
- [ ] `UploadWorker` uses one unique queue drainer with batching ≤ config `max_batch`, oldest-first ordering, and per-row `nextAttemptAt` as the source of truth.
- [ ] Per-message settlement is correct for mixed batch results, including unknown-hash tolerance.
- [ ] 401 → `NEEDS_REENROLL` with uploads halted and the merchant notified; re-enrollment loses nothing.
- [ ] 429 honours `Retry-After`; 5xx/network back off exponentially; `attemptCount > 10` → `FAILED` but still recoverable via Manual Sync/Reconcile.
- [ ] **Manual Sync** scans, diffs, uploads with `upload_source = MANUAL_SYNC`, heals local state from duplicates, and reports a truthful summary including anything still unsent.
- [ ] `ReconcileWorker` (6 h) recovers missed broadcasts and reclaims stale `UPLOADING` rows; notifies when it had to recover messages.
- [ ] `HeartbeatWorker` (15 min) reports full telemetry, computes/uses clock skew, and correctly handles every directive including unknown ones.
- [ ] `PurgeWorker` never deletes un-uploaded messages; `BootReceiver` and package-replaced receiver re-register work and run a reconcile.
- [ ] Dashboard, Transactions, and Diagnostics screens work on real data; **Copy diagnostics** produces a redacted, support-ready block.
- [ ] Notifications fire for permission loss, re-enroll, sustained upload failure, and server messages, without nagging.
- [ ] Every instrumented scenario in §6.2 passes, including airplane-mode, force-close, reboot, reinstall-healing, doze, and the 30-minute soak with zero loss and zero duplicates.
- [ ] The end-to-end chain to webhook delivery is demonstrated against staging.

---

## 8. Risks & notes

- **"Eventually" is the guarantee, and Manual Sync + Reconcile are what make it true.** Any design that
  makes correctness depend on the `SMS_RECEIVED` broadcast arriving will fail on real Bangladeshi
  handsets. Treat the broadcast as an optimisation and the inbox scan as the source of truth.
- The honest sync summary matters more than it sounds. An app that says "Sync complete" while messages
  are stuck teaches merchants to distrust it, and then they stop using Manual Sync when it's the one
  thing that would help.
- One queue drainer, not one worker per message. This is easy to get wrong and shows up as
  rate-limit 429 storms in production.
- Keep `event_log` free of message bodies. It is copied into support conversations, so it must be safe
  to share by construction, not by remembering to redact.
- Doze and OEM behaviour cannot be fully validated on emulators. Task 15's device lab is where this
  task's guarantees are actually proven; expect to return here with fixes after that matrix runs.
