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
