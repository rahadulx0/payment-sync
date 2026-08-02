# Android app — setup & build (draft)

The merchant capture app. **Google Play cannot distribute it** — `READ_SMS`/`RECEIVE_SMS` are
restricted permissions granted essentially only to default SMS handlers, so distribution is a directly
signed APK with an in-app update channel (finalised in Task 15). This guide is a draft; the merchant
onboarding walkthrough (EN/BN) is completed in Task 15.

## Build (developer)

Requirements: JDK 21, the Android SDK (platform 35, build-tools 35). No Android Studio required.

```bash
# Keep the app's bundled parser rules + fixtures in lockstep with the server parser:
pnpm --filter @paysync/parsers export:android

cd apps/android
./gradlew :app:testDebugUnitTest   # incl. the parser-parity / hash / allowlist gates
./gradlew :app:assembleDebug       # → app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` (git-ignored) must point `sdk.dir` at your Android SDK. The debug flavour talks to
`http://10.0.2.2:3000` (the host loopback from an emulator); a real device needs the LAN/staging URL.

## What this task delivers (Task 13)

- **Capture pipeline**: `SmsReceiver` → `AddressAllowlist` (the privacy control — exact match, fails
  closed, non-provider messages leave no trace) → `CaptureSms` (hash, local parse, durable Room insert,
  enqueue upload port). `onReceive` does no network and hands off in milliseconds.
- **Kotlin `ParserEngine`** provably equivalent to the server parser — asserted against the exported
  fixtures by `ParserParityTest` (a release blocker). A Cash Out is classified `IGNORED` locally too,
  so the app never shows "payment received" for an outgoing payment.
- **Money as `Long` paisa** end to end (never `Double`).
- **Secure storage**: device token in `EncryptedSharedPreferences`; the enrollment key is used once
  and never persisted.
- **Consent-first onboarding** (EN + বাংলা): welcome → SMS rationale + consent → permission request →
  enrollment. The permission dialog never appears before consent is recorded.
- **Room** schema (`sms_message`, `event_log`, `config_cache`) with committed schema JSON.

## Verified

`./gradlew :app:testDebugUnitTest :app:assembleDebug` is green on JDK 21 + SDK 35. Instrumented tests
(`SmsReceiver`, Room migration, enroll flow, credential store) require an emulator and run in the
`android.yml` CI job; the real-device OEM-reliability matrix is Task 15.

## Sync engine (Task 14)

**The guarantee: a captured SMS always reaches the server eventually** — across airplane mode,
force-close, reboot, and OEM battery kills.

- **One queue drainer** (`UploadWorker`, unique work `upload-queue`) batches ≤50 messages oldest-first
  (Task 08's matching depends on that ordering). Never one worker per message — that bursts requests
  and trips the rate limit.
- **Rows are the source of truth.** Each carries `syncStatus`, `attemptCount` and `nextAttemptAt`; the
  worker is just a pump. The state machine is a pure function, unit-tested over the whole
  (state × event) table.
- `DUPLICATE` is **success**, not an error — it is how a reinstalled app re-learns its server ids.
- `401` → the device is marked as needing re-enrollment and uploads stop; the rows stay `PENDING` and
  lose nothing. `429` honours `Retry-After`. `5xx`/network back off exponentially; past the attempt
  budget a row goes `FAILED` — still recoverable by Manual Sync and Reconcile, never dropped.

### Manual Sync (the recovery path)

`Sync now` on the Dashboard re-scans the inbox, re-queues everything not `UPLOADED`, uploads with
`upload_source = MANUAL_SYNC` (which triggers the server-side rescan), and heals local state from
duplicate responses. It reports a **truthful** summary — scanned / newly found / uploaded / duplicates /
rejected / **still pending**. It never says "complete" while messages are waiting.

### Background work

| Work           | Interval  | Purpose                                                                        |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `upload-queue` | on demand | drain the queue (expedited when quota allows)                                  |
| `heartbeat`    | 15 min    | liveness + telemetry + server directives; runs even when the queue is empty    |
| `reconcile`    | 6 h       | automatic Manual Sync — the reason correctness doesn't depend on the broadcast |
| `purge`        | daily     | delete `UPLOADED` rows past retention; never touches an unsent message         |

`BootReceiver` re-registers all of it after a reboot or app update and runs a reconcile immediately —
the boot gap is exactly when messages get missed.

## Troubleshooting

1. **"Payments aren't being captured"** → Diagnostics: check `sms permission` and
   `battery optimisation exempt`. If the latter is `NO`, exempt the app (Task 15 adds the guided flow).
2. **"It says messages are waiting"** → tap **Sync now**; the summary states exactly what is still
   unsent and why.
3. **Anything else** → Diagnostics → **Copy diagnostics for support** and send the block. It is safe to
   share by construction: no message bodies, no device token, no customer numbers.

## Hardening & release channel (Task 15)

### Installing the app (there is no Play Store listing)

Google Play **cannot** distribute this app: `READ_SMS`/`RECEIVE_SMS` are restricted permissions granted
essentially only to default SMS handlers (`architecture.md §17.1`). Distribution is a directly signed
APK plus an in-app update channel.

1. Open the download link supplied with your onboarding pack.
2. Android will ask to allow installs from that browser/file manager — this is expected for a directly
   distributed app. Allow it, then install.
3. Updates arrive **inside the app**: it checks `latest.json`, verifies the APK's SHA-256 before
   installing, and refuses a file whose checksum does not match. Mandatory updates cannot be dismissed.

### Making the phone reliable (the part that actually matters)

Diagnostics shows a plain-language **Reliability** readout with the exact fix for anything unmet:

- **Allow background activity** — battery-optimisation exemption. Without it, the phone may stop the
  app and payments will only be captured when the merchant opens it.
- **Open autostart settings** — Xiaomi/Redmi/Poco, Oppo/Realme, vivo/iQOO, Huawei/Honor and Samsung get
  a direct deep link; unknown ROMs fall back to the app settings page rather than crashing.
- **Payment monitoring** (optional foreground service, off by default) — keeps the process warm on the
  most aggressive ROMs. It does not upload anything itself; it only prevents the process being killed.

### Privacy controls

`docs/privacy-policy.md` ships in-app. **Disconnect and erase data** clears the credentials and all
local messages — it shows the count of undelivered payments first and offers a Sync now, because
wiping is irreversible.

### Not yet done (needs physical hardware / people)

- `docs/device-matrix.md` is **not executed** — it needs real Xiaomi / Oppo / Samsung / stock handsets.
- Certificate pin values are placeholders until staging has its real certificate; the MITM-proxy test
  and the pin-rotation rehearsal need a device and that certificate.
- Bengali review by a native speaker, and the 24 h battery measurement per device class.
