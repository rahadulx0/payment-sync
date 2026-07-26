# Task 13 — Android I: Foundation, Consent, Enrollment & Capture

| | |
|---|---|
| **Track** | Android (parallelizable after Task 06) |
| **Depends on** | 05 (rules + fixtures), 06 (device API contract) |
| **Unblocks** | 14 |
| **Est. effort** | 5–7 days |
| **Risk** | Medium-high — the capture path runs on hardware you don't control, and the consent/privacy design is a legal requirement, not a feature |

---

## 1. Objective

Build the Android app's foundation from `architecture.md §11`: project structure, secure credential
storage, Room persistence, the consent and permission flow, device enrollment, and the **SMS capture
pipeline** with the provider-address allowlist and a Kotlin parser that is provably equivalent to the
server's.

At the end of this task, a payment SMS arriving on the phone is filtered, parsed locally, and stored
durably in Room. Uploading it is Task 14.

---

## 2. Scope of work

### In scope
- Gradle project, module structure, DI, base architecture (`architecture.md §11.1`).
- Room schema (`architecture.md §11.2`), DAOs, migrations, retention-aware queries.
- `EncryptedSharedPreferences` credential store; Retrofit/OkHttp client with interceptors.
- Consent + permission-rationale flow in **English and Bengali**; consent recorded and reported.
- Enrollment screen → `POST /device/register`; config fetch + cache.
- `SmsReceiver` + `AddressAllowlist` + `InboxScanner` + Kotlin `ParserEngine`.
- Parser parity tests against the shared fixtures exported by Task 05.
- Minimal UI shell: onboarding, dashboard placeholder, settings placeholder.

### Out of scope
- Upload workers, manual sync, heartbeat, diagnostics UI → Task 14.
- Cert pinning, R8 rules, OEM autostart flows, release signing, update channel → Task 15.
- Notification-listener / OCR capture adapters → post-v1 (but the capture interface is designed for them).

---

## 3. Prerequisites

- Task 06: device API frozen in `docs/openapi.yaml` + `docs/device-api.md`.
- Task 05: `parser-rules-bundled.json` and `parser-fixtures.json` generated into the Android source tree.
- A reachable dev API (local LAN or staging from Task 16's early slice) and a seeded `DEVICE_ENROLL` key.
- At least one physical Android device (emulator SMS injection works for tests but not for OEM behaviour).

---

## 4. Implementation steps

### 4.1 Project setup
1. `apps/android` Gradle project (Kotlin 2.x, AGP current, `minSdk 26`, `targetSdk 35`, version
   catalog in `gradle/libs.versions.toml`, Compose BOM).
2. Dependencies: Compose + Material3, Hilt, Room (KSP), Retrofit + OkHttp + kotlinx.serialization,
   WorkManager, `security-crypto` (EncryptedSharedPreferences), DataStore (non-secret prefs),
   Timber, Turbine + MockWebServer + Robolectric + AndroidX Test.
3. Build types: `debug` (local API, verbose logs, cleartext allowed **only** for the dev flavour),
   `staging`, `release`. Flavours keep the base URL out of code.
4. Package layout mirrors `architecture.md §11.1` exactly (`ui/`, `domain/`, `data/{local,remote,secure,sms}`,
   `work/`, `di/`).
5. Strict mode in debug; `kotlinOptions.allWarningsAsErrors` for the `domain` and `data/sms` packages
   (the correctness-critical ones).
6. CI: `./gradlew lint testDebugUnitTest assembleDebug` on PR; instrumented tests on an emulator job.

### 4.2 Manifest, permissions & privacy posture
- Permissions: `RECEIVE_SMS`, `READ_SMS`, `INTERNET`, `ACCESS_NETWORK_STATE`,
  `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS` (33+), `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_DATA_SYNC` (declared now, used in Task 15),
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- `android:allowBackup="false"`, `usesCleartextTraffic="false"` (release), no exported components
  except `SmsReceiver` (`android:exported="true"` with the `SMS_RECEIVED` filter and
  `android:permission="android.permission.BROADCAST_SMS"`) and `BootReceiver`.
- No analytics SDK, no ad SDK, no third-party network calls of any kind — the app talks to exactly one
  host. This is both a privacy commitment and what makes the Task 15 cert-pinning story simple.

### 4.3 Room (`data/local/`)
Schema from `architecture.md §11.2`:
- `sms_message`: `id`, `clientMsgHash` (**unique index**), `address`, `body`, `smsTimestamp`,
  `receivedAt`, `provider`, `parsedAmountMinor` (Long paisa — never Double), `parsedTrxId`,
  `parseStatus`, `syncStatus`, `attemptCount`, `lastError`, `nextAttemptAt`, `serverSmsLogId`,
  `serverMatchStatus`, `uploadSource`, `createdAt`.
- `event_log`: ring buffer (`id`, `type`, `at`, `detail`, `synced`) capped at 500 rows via a trimming
  trigger/DAO call.
- `config_cache`: `configVersion`, `json`, `fetchedAt`.
- Indices: `(syncStatus, nextAttemptAt)`, `(smsTimestamp DESC)`, `(serverMatchStatus)`.
- `exportSchema = true` with committed schema JSONs; migration tests from every released version.
- **Money as `Long` paisa** throughout the app; a `Money` value class wraps it with `fromDecimalString`
  / `toDisplayString` mirroring `packages/shared` semantics. No `Double` anywhere near an amount
  (enforced by a lint/detekt rule).

### 4.4 Secure storage (`data/secure/`)
- `CredentialStore` over `EncryptedSharedPreferences` (AES-256-GCM, MasterKey in Keystore):
  `deviceToken`, `companyCode`, `installId`, `deviceId`, `tokenIssuedAt`, `prevDeviceToken`.
- `installId` generated once (UUID) and persisted; survives updates, regenerates on data clear
  (documented as re-enrollment, handled by Task 06's re-enroll semantics).
- The **enrollment key is used once and never persisted** (`architecture.md §11.5`) — a test asserts it
  is absent from prefs, Room, and logs after enrollment.
- `wipeAll()` for the Task 15 revoke-and-wipe action.
- Keystore-failure fallback: if EncryptedSharedPreferences can't initialise (a real issue on some
  broken OEM images), fail loudly with a support screen rather than silently storing in plaintext.

### 4.5 Network (`data/remote/`)
- Retrofit service mirroring the frozen device API; DTOs mirror `packages/shared/dto` field-for-field
  (**amounts as strings**, timestamps as ISO-8601 with offset).
- OkHttp interceptors: auth (`Authorization: Bearer <token>`, `X-Install-Id`), `X-Request-Id`
  (client-generated UUID, echoed in logs so a support case can be traced across app and server),
  gzip, a `Retry-After`-aware 429 handler, and a logging interceptor that redacts the token
  (redaction asserted by test).
- Timeouts: connect 10 s, read 30 s, write 30 s, call 60 s. No global retries — retry policy belongs to
  WorkManager (Task 14), and doubling it here causes duplicate uploads.
- Error mapping: server envelope → sealed `ApiError` (`Unauthenticated`, `DeviceBlocked`,
  `CompanySuspended`, `RateLimited(retryAfter)`, `Validation`, `Server`, `Network`) so the UI and the
  sync engine can react differently to each.

### 4.6 Consent & permission flow (`ui/onboarding/`) — legal requirement (`architecture.md §17.2`)
Screen order is deliberate and must not be reordered:
1. **Welcome** — what the app does in one sentence.
2. **Why SMS access** — plain-language rationale in EN/BN: which messages are read (only from
   bKash/Nagad/Upay addresses), what leaves the phone (payment fields + the message text of those
   messages only), what never leaves (all other SMS), who can see it, and how to revoke. Link to the
   hosted privacy policy. A checkbox ("I understand and consent") is required to continue —
   **no permission dialog before this screen**.
3. **Consent recorded**: timestamp, app version, policy version, locale, stored locally and reported to
   the server as a `device_events` entry (Task 06) so consent is auditable.
4. **Permissions** — request `RECEIVE_SMS`/`READ_SMS`; handle "denied", "denied permanently"
   (deep-link to app settings), and partial grants; explain again on re-ask, never nag in a loop.
5. **Enrollment** — company code + enrollment key (paste-friendly, QR-scan optional deferred to
   Task 15), device name, wallet number; validation and clear server-error mapping
   (`DEVICE_LIMIT_REACHED` lists existing devices; `DEVICE_RETIRED` tells the merchant to contact support).
6. **Verify capture** — asks the merchant to make a small real payment (or waits for the next one) and
   shows the captured message, proving the whole chain before they rely on it. Skippable, but offered.
7. Battery-optimisation and autostart guidance screens are stubbed here and completed in Task 15.

Localisation: all strings in `values/strings.xml` + `values-bn/strings.xml` from day one
(`architecture.md §20.8`); a lint check fails on hardcoded UI strings.

### 4.7 Capture pipeline (`data/sms/`)
```
SmsReceiver.onReceive
  → assemble multipart PDUs into one body (getMessagesFromIntent, concatenated in order)
  → AddressAllowlist.matches(address)?        // from cached config; bundled fallback
        no  → return immediately. Nothing logged, nothing stored, no trace of the message.
        yes → CaptureUseCase.handle(address, body, timestampMillis)
```
`CaptureUseCase`:
1. `clientMsgHash = SHA256("$companyCode|$address|$normalisedBody|$smsTimestampMillis")` —
   **exactly** the recipe the server expects (documented in `docs/device-api.md`; a cross-language test
   asserts the same inputs produce the same digest in Kotlin and TypeScript).
2. Local parse via `ParserEngine` (best-effort, for instant merchant feedback and for the `parsed_hint`).
3. Insert into Room with `syncStatus = PENDING` (ignore-on-conflict for the unique hash).
4. Enqueue upload work (implemented in Task 14; here it's an injected no-op port so this task is
   testable on its own).
5. Write an `event_log` entry.
`onReceive` does no network and no heavy work — it hands off within milliseconds (a test asserts the
callback returns in <50 ms).

**`AddressAllowlist`** — the privacy control (`architecture.md §17.2`): case-insensitive match against
the cached config's `sender_addresses`, plus documented handling of numeric shortcodes and the
`+880`-prefixed variants some operators deliver. Fails **closed** (drops) on an unknown address; a
counter of dropped-unknown addresses (count only, never content) is reported via heartbeat so genuinely
new provider addresses can be discovered without ever collecting personal SMS.

**`InboxScanner`** — `ContentResolver` query over `Telephony.Sms.Inbox` for the last
`inbox_scan_days`, filtered by the allowlist, projecting only `address`, `body`, `date`. Used by manual
sync and reconcile in Task 14; built and tested here.

### 4.8 Kotlin `ParserEngine` — parity with the server
- Consumes the **same rule JSON** (`parser-rules-bundled.json`, refreshed from `/device/config`).
- Same evaluation order, same `must_contain`/`must_not_contain`, same direction handling: a
  `DEBIT` message is classified `IGNORED` locally too, so the app never shows "payment received" for a
  Cash Out (that would be a trust-destroying UI bug even though the server is authoritative).
- Same normalisation: amount (commas, `Tk`/`BDT`, Bengali digits) → `Long` paisa; MSISDN → `+8801…`;
  TrxID uppercase; timestamps via `Asia/Dhaka`.
- Robust to unknown rule fields (forward compatibility — a newer server rule must not crash an older app).
- **Parity test**: `androidTest` (and a Robolectric unit variant) iterates the exported
  `parser-fixtures.json` and asserts the Kotlin result matches `expected` for every fixture, including
  the debit/promotional/adversarial cases. **This test failing is a release blocker.**

### 4.9 Minimal UI shell (`ui/`)
- `MainActivity` + Compose navigation; onboarding vs main decided by `CredentialStore` state.
- Dashboard placeholder: connection state, last captured message, counts from Room (fleshed out in Task 14).
- Settings placeholder: device name, wallet number, language toggle, privacy policy link, app version.
- ViewModels expose immutable `UiState` via `StateFlow`; no Android SMS APIs above the `data` layer.

---

## 5. Files created / modified

```
apps/android/{settings.gradle.kts,build.gradle.kts,gradle/libs.versions.toml,gradle.properties}
apps/android/app/build.gradle.kts
apps/android/app/src/main/AndroidManifest.xml
apps/android/app/src/main/kotlin/com/inovisolutions/paymentsync/
  PaymentSyncApp.kt  MainActivity.kt
  di/{AppModule.kt,NetworkModule.kt,DatabaseModule.kt,SmsModule.kt}
  data/local/{AppDatabase.kt,SmsMessageEntity.kt,SmsMessageDao.kt,EventLogEntity.kt,EventLogDao.kt,
              ConfigCacheEntity.kt,ConfigDao.kt,Converters.kt,Migrations.kt}
  data/secure/{CredentialStore.kt,KeystoreGuard.kt}
  data/remote/{DeviceApi.kt,dto/*.kt,AuthInterceptor.kt,RequestIdInterceptor.kt,
               RedactingLogger.kt,ApiError.kt,ErrorMapper.kt}
  data/sms/{SmsReceiver.kt,AddressAllowlist.kt,InboxScanner.kt,ParserEngine.kt,
            RuleRepository.kt,Normalize.kt,MessageHash.kt,PduAssembler.kt}
  domain/{model/*.kt,usecase/{CaptureSms.kt,EnrollDevice.kt,RefreshConfig.kt,RecordConsent.kt},
          port/{UploadScheduler.kt}}
  ui/onboarding/{WelcomeScreen.kt,RationaleScreen.kt,PermissionsScreen.kt,EnrollScreen.kt,
                 VerifyCaptureScreen.kt,OnboardingViewModel.kt}
  ui/dashboard/{DashboardScreen.kt,DashboardViewModel.kt}
  ui/settings/{SettingsScreen.kt,SettingsViewModel.kt}
  ui/theme/*  ui/components/*
apps/android/app/src/main/res/values/strings.xml
apps/android/app/src/main/res/values-bn/strings.xml
apps/android/app/src/main/assets/parser-rules-bundled.json          # generated by Task 05
apps/android/app/src/test/kotlin/.../{ParserParityTest.kt,NormalizeTest.kt,MessageHashTest.kt,
                                      ErrorMapperTest.kt,MoneyTest.kt}
apps/android/app/src/androidTest/kotlin/.../{SmsReceiverTest.kt,RoomMigrationTest.kt,
                                             EnrollFlowTest.kt,InboxScannerTest.kt,
                                             CredentialStoreTest.kt}
apps/android/app/src/androidTest/assets/parser-fixtures.json        # generated by Task 05
docs/android-setup-guide.md          # draft (EN/BN), completed in Task 15
.github/workflows/android.yml
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Parser parity** (release blocker) | Every exported fixture asserted in Kotlin, whole-result comparison. A deliberate rule-field mismatch must fail the test, proving it's actually comparing. |
| **Hash parity** | A shared vector file (`{companyCode, address, body, timestamp} → sha256`) asserted in both Kotlin and TypeScript. A mismatch here would break server dedupe silently, so it is tested from both sides. |
| **Allowlist / privacy** | Inject SMS from `bKash` (stored), from a personal number (**nothing** stored — assert Room row count unchanged, `event_log` unchanged, and no body substring anywhere in logs), from an unknown shortcode (dropped, counter incremented), and from a spoofed address containing "bKash" as a substring (dropped — matching is exact, not `contains`). |
| Debit classification | A Cash Out SMS is stored as `IGNORED` locally and the dashboard never labels it "received". |
| Multipart SMS | A 2-part concatenated message reassembles into one body in the correct order with one hash; out-of-order PDU delivery still yields the same body. |
| `onReceive` speed | Assert return within 50 ms with the upload port stubbed. |
| Room | Migration tests from every committed schema version; unique-hash conflict ignored; `Long` paisa round-trip; retention query deletes only `UPLOADED` rows older than the window. |
| Credential store | Token persists across process death; enrollment key absent from prefs/Room/logs; `wipeAll` clears everything; Keystore failure shows the support screen instead of falling back to plaintext. |
| Enrollment | MockWebServer: success stores token + config; wrong key → mapped error message; `DEVICE_LIMIT_REACHED` renders the device list; suspended company message; network failure retriable without duplicating the device (same `install_id`). |
| Config | Fetched and cached; ETag/304 handled; bundled rules used when the cache is empty; a newer rule JSON with unknown fields parses without crashing. |
| Consent | Cannot reach the permission dialog without consenting (instrumented navigation assertion); consent recorded with version + timestamp and reported as a device event. |
| Localisation | Every user-facing string resolves in `bn`; a lint check fails on hardcoded strings; the rationale screen renders correctly in Bengali at large font scales. |
| Inbox scanner | Returns only allowlisted messages within the window; handles an empty inbox and a permission-revoked state without crashing. |
| Real-device smoke | On a physical phone: install, onboard, receive a real (or SMS-gateway-simulated) payment message, and see it stored — verified via the debug screen or `adb` Room inspection. |

**Smoke demo:** on a real phone, complete onboarding in Bengali, send a bKash-formatted SMS from a test
sender named `bKash` (or use `adb emu sms send` on an emulator), and show the parsed message in the app
plus a personal SMS from a normal number producing **no** stored row.

---

## 7. Acceptance criteria

- [ ] Project builds `debug`/`staging`/`release`; CI runs lint + unit tests + `assembleDebug`.
- [ ] Package structure matches `architecture.md §11.1`; no Android SMS API used above the data layer.
- [ ] Room schema matches `architecture.md §11.2` with committed schema JSONs and passing migration tests; amounts stored as `Long` paisa with no `Double` on the money path.
- [ ] Device token stored in `EncryptedSharedPreferences`; enrollment key provably never persisted; Keystore failure fails loudly.
- [ ] Consent screen precedes any permission request, is available in EN and BN, and records + reports consent with version and timestamp.
- [ ] Enrollment works against the real API and maps every documented error to a clear message.
- [ ] `AddressAllowlist` fails closed and is exact-match; non-provider SMS leave **no trace** in Room, logs, or event log — asserted by test.
- [ ] `clientMsgHash` is byte-identical to the server's expectation, proven by a cross-language vector test.
- [ ] Multipart SMS reassembly is correct and order-independent.
- [ ] Kotlin `ParserEngine` passes 100% of the exported fixtures including debit/promotional/adversarial cases; a rule mismatch fails the build.
- [ ] `onReceive` completes in <50 ms and performs no network I/O.
- [ ] `InboxScanner` works and respects the allowlist and scan window.
- [ ] All strings localised EN/BN; hardcoded-string lint passes.
- [ ] Real-device smoke test recorded in the PR (screenshot or short video).

---

## 8. Risks & notes

- **The allowlist is the privacy architecture.** Everything in `architecture.md §17.2` and the promise
  to clients rests on it dropping non-provider messages before anything is stored or logged. Test it as
  a security control, not a filter — including the substring-spoof case.
- Hash parity is a silent failure mode: if Kotlin and the server disagree, dedupe breaks and every
  reinstall re-uploads the inbox. The cross-language vector test is cheap insurance.
- Keep `parsed_hint` clearly labelled as advisory in the code (a KDoc note referencing
  `architecture.md ADR-5`). A future developer "fixing" the server to trust it would remove a security
  control.
- Don't skip the "verify capture" onboarding step. A merchant discovering three days later that
  capture never worked is the worst possible first experience, and it's exactly what OEM battery
  behaviour (Task 15) causes.
- Emulators do not reproduce OEM process-killing. Everything about reliability is provisional until the
  Task 15 device-lab matrix runs on real Xiaomi/Oppo hardware.
