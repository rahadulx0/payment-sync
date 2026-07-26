# Task 15 — Android III: Hardening, OEM Reliability & Release Channel

| | |
|---|---|
| **Track** | Android |
| **Depends on** | 14 |
| **Unblocks** | 17 |
| **Est. effort** | 4–6 days |
| **Risk** | High — Google Play cannot distribute this app (`architecture.md §17.1`), so the release channel is bespoke and must be right |

---

## 1. Objective

Make the Android app production-ready: transport and storage hardening, OEM battery/autostart
reliability measures, the optional foreground service, revoke-and-wipe, the **signed APK release and
in-app update channel** that replaces Google Play, and validation across a real device matrix.

This task converts "works on my phone" into "works on a merchant's Xiaomi for six months".

---

## 2. Scope of work

### In scope
- Certificate pinning with a backup pin and a documented rotation procedure.
- R8/ProGuard, resource shrinking, manifest hardening, `FLAG_SECURE`, exported-component audit.
- Root/emulator advisory detection (reported, never blocking).
- Battery-optimisation exemption flow + per-OEM autostart deep links and guidance.
- Optional foreground service ("Payment monitoring active") with a user toggle.
- Blocking update screen driven by `min_supported_app_version`; in-app update via `latest.json`.
- Release signing, CI-built signed APK, per-company authenticated download URL.
- Revoke & wipe; privacy policy link; final EN/BN localisation pass.
- Device-lab matrix validation on real hardware.

### Out of scope
- Play Store submission — deliberately not attempted (see §8). The notification-listener capture
  adapter is documented as the compliant fallback but is post-v1.
- Backend changes; anything not shipping in the APK.

---

## 3. Prerequisites

- Task 14 complete: sync engine, heartbeat, diagnostics.
- Task 16's staging environment with a real TLS certificate (pinning needs a real chain).
- Physical devices: at least one Xiaomi/Redmi (MIUI/HyperOS), one Oppo/Realme/Vivo (ColorOS/FuntouchOS),
  one Samsung (OneUI), and one stock/Pixel-like device. Borrowed or cheap second-hand is fine — this
  matrix is not optional given the target market.

---

## 4. Implementation steps

### 4.1 Transport hardening
1. **Certificate pinning** (OkHttp `CertificatePinner`) on the API host:
   - pin the **intermediate CA** SPKI plus a **backup pin** (a second CA or a pre-generated future key)
     — pinning only the leaf guarantees an outage at renewal.
   - pinning active in `release`/`staging`, disabled in `debug` (documented, and asserted by a test so
     it can't silently ship disabled).
   - a pin-failure path that reports a distinct `event_log` entry and a clear user message
     ("Secure connection failed — your network may be intercepted"), not a generic network error.
   - `docs/runbook.md`: pin rotation procedure with the required lead time (ship the new pin in an app
     release **before** the certificate changes) and how to recover if a pin is wrong
     (server-side `min_supported_app_version` + a rescue APK).
2. TLS 1.2+ only, modern cipher suites, `network_security_config.xml` with `cleartextTrafficPermitted="false"`
   and no user-added CA trust for the release build.

### 4.2 Build & storage hardening
- R8 with `minifyEnabled` + `shrinkResources` for release; keep rules for Room entities,
  kotlinx.serialization, Retrofit interfaces, Hilt; verify obfuscation didn't break reflection paths by
  running the **full instrumented suite against a release-minified build** (a real and common failure).
- `allowBackup="false"`, `android:debuggable=false`, no `MODE_WORLD_*`, no logging of bodies in release
  (Timber tree stripped in release; assert with a test that scans for the debug tree).
- `FLAG_SECURE` on the enrollment screen (contains the enrollment key) and Diagnostics (contains ids).
- Exported-component audit: only `SmsReceiver` (with `BROADCAST_SMS` permission) and `BootReceiver`;
  everything else `exported="false"`. A test parses the merged manifest and asserts this.
- Root/emulator detection (advisory): `is_rooted`, `is_emulator` flags in the heartbeat only. Never
  block — false positives would break real merchants (`architecture.md §11.5`).
- `versionCode`/`versionName` derived from CI (monotonic `versionCode`, semver `versionName`).

### 4.3 OEM reliability measures (`architecture.md §11.4`)
1. **Battery-optimisation exemption**: detect `isIgnoringBatteryOptimizations`; if false, an onboarding
   step and a persistent Dashboard warning card that launches
   `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; state reported in every heartbeat so the dashboard
   shows which merchants are at risk.
2. **Autostart guidance**: detect manufacturer and offer a deep link into the OEM's autostart settings
   (MIUI/HyperOS, ColorOS/Realme UI, FuntouchOS/OriginOS, OneUI, and a generic fallback), with
   step-by-step instructions and screenshots in EN/BN. Wrap every deep link in a try/catch — these
   intents differ per ROM version and throwing on an unknown one would be a crash on exactly the
   devices that need the feature. Mark "I've enabled it" to dismiss.
3. **Optional foreground service** (`SmsMonitorService`, `FOREGROUND_SERVICE_DATA_SYNC`):
   user toggle in Settings (off by default), low-priority persistent notification
   ("Payment monitoring active"), keeps the process warm on hostile ROMs. Started via
   `startForegroundService` with correct 34+ type declarations and a graceful stop; must not duplicate
   `UploadWorker`'s job — it only keeps the process alive and triggers a reconcile on connectivity regain.
4. **Reliability score** on Diagnostics: a plain-language readout ("Reliability: needs attention —
   battery optimisation is on for this app") with the exact fix for each unmet item. This is what the
   merchant reads to a support agent.

### 4.4 Update channel (replaces Google Play)
1. **`min_supported_app_version`** from `/device/config`: if the installed version is below it, a
   blocking screen with the download link — the kill switch for a breaking contract change.
2. **In-app update check**: `GET <download_base>/latest.json`
   `{version_code, version_name, apk_url, sha256, size, release_notes_en, release_notes_bn,
     min_android_sdk, mandatory}` — fetched on app start (max daily) and on heartbeat's
   `update_available` hint.
3. Download to app-private storage, **verify the SHA-256 before installing** (and reject on mismatch),
   then install via `FileProvider` + `ACTION_INSTALL_PACKAGE` (or `PackageInstaller` on 26+), requesting
   `REQUEST_INSTALL_PACKAGES` with a clear rationale screen.
4. Release-notes screen in EN/BN; mandatory updates cannot be dismissed.
5. Serving side: per-company authenticated download URL (documented in Task 17 — implemented as a
   signed, expiring URL or a Caddy basic-auth path per company in Task 16), plus `latest.json` and the
   APK's checksum published alongside.

### 4.5 Signing & CI release
- Release keystore generated once, stored **offline** with two backups, and as base64 in CI secrets
  (`ANDROID_KEYSTORE_BASE64`, passwords, alias). Losing this keystore means no merchant can ever update
  again — record its location and backup plan in the runbook.
- `signingConfigs.release` reading from env; the build fails loudly if signing config is missing rather
  than falling back to debug signing.
- `.github/workflows/android-release.yml` on tag `android-v*`: build `assembleRelease` + `bundleRelease`
  (AAB kept for a possible future compliant Play build), run the full test suite, compute SHA-256,
  generate `latest.json`, attach APK + checksum + notes to a GitHub Release, and upload to the download
  host.
- `apksigner verify` and a mapping-file archive step (retain `mapping.txt` per release for
  deobfuscating any future crash report).

### 4.6 Privacy & user control (completing `architecture.md §17.2`)
- **Revoke & wipe** in Settings: typed confirmation → call device revoke (or token rotate + retire via
  the admin path if a self-revoke endpoint isn't exposed) → `CredentialStore.wipeAll()` → clear Room →
  cancel all work → return to onboarding. Explicit warning that pending un-uploaded messages will be lost,
  with the count shown, and an offer to run Manual Sync first.
- Privacy policy: in-app screen (bundled text, so it works offline) plus a link to the hosted URL; the
  policy version shown and recorded with consent.
- Data-access transparency screen: how many messages are stored locally, how many uploaded, what fields
  leave the phone, and the retention window — the concrete version of the consent promise.
- Final localisation pass: every string EN + BN including error messages, notifications, OEM
  instructions, and update notes; reviewed by a Bengali speaker; tested at 1.3× and 2× font scale and in
  RTL-neutral layouts.

### 4.7 Device-lab matrix (validation, not code)
Run the full scenario list on each device class and record results in `docs/device-matrix.md`:

| Scenario | Xiaomi/HyperOS | Oppo/Realme | Samsung | Stock |
|---|---|---|---|---|
| Capture with app in foreground | | | | |
| Capture with app backgrounded 1 h | | | | |
| Capture with app force-stopped | | | | |
| Capture after 24 h idle (doze) | | | | |
| Capture after reboot (no app launch) | | | | |
| Airplane mode 30 min → reconnect | | | | |
| Battery-opt exemption granted vs not | | | | |
| Autostart enabled vs not | | | | |
| Foreground service on vs off | | | | |
| Permission revoked then re-granted | | | | |
| SIM removed / no signal | | | | |
| Storage full | | | | |
| Clock set 10 min off | | | | |
| App update over existing install (data preserved) | | | | |
| Manual Sync recovers everything missed | | | | |

For each cell record: captured immediately / recovered by reconcile / recovered only by Manual Sync /
lost. **"Lost" is a release blocker**; "recovered only by Manual Sync" is acceptable but must be
reflected in the setup guide's recommendations for that OEM.

---

## 5. Files created / modified

```
apps/android/app/build.gradle.kts                     # signing, R8, buildConfig fields
apps/android/app/proguard-rules.pro
apps/android/app/src/main/res/xml/network_security_config.xml
apps/android/app/src/main/AndroidManifest.xml         # FGS, install permission, exported audit
apps/android/app/src/main/kotlin/com/inovisolutions/paymentsync/
  data/remote/{PinningConfig.kt,PinFailureHandler.kt}
  security/{TamperSignals.kt,ExportedComponentsCheck.kt}
  reliability/{BatteryOptimizationHelper.kt,AutostartHelper.kt,OemGuidance.kt,ReliabilityScore.kt}
  service/SmsMonitorService.kt
  update/{UpdateChecker.kt,ApkDownloader.kt,ChecksumVerifier.kt,UpdateScreen.kt,
          MandatoryUpdateScreen.kt}
  ui/settings/{ForegroundServiceToggle.kt,RevokeAndWipeFlow.kt,PrivacyPolicyScreen.kt,
               DataTransparencyScreen.kt}
apps/android/app/src/test/kotlin/.../{PinningConfigTest.kt,UpdateCheckerTest.kt,
                                      ChecksumVerifierTest.kt,ReliabilityScoreTest.kt,
                                      ManifestAuditTest.kt,ReleaseLoggingTest.kt}
apps/android/app/src/androidTest/kotlin/.../{ReleaseBuildSmokeTest.kt,ForegroundServiceTest.kt,
                                             RevokeWipeTest.kt,UpdateInstallTest.kt}
.github/workflows/android-release.yml
docs/android-setup-guide.md      # final EN/BN, per-OEM screenshots
docs/device-matrix.md            # filled-in results
docs/runbook.md                  # pin rotation, keystore custody, emergency APK
docs/privacy-policy.md           # final
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Pinning** | With mitmproxy/Charles and its CA installed on the device, a release build **fails** to connect and shows the interception message; the debug build connects (proving the test exercises the right path); a wrong-pin build fails closed; the backup pin alone is sufficient to connect (simulate by removing the primary). |
| **Release-minified suite** | The entire Task 13/14 instrumented suite runs against a release-signed, minified APK — not just debug. Any reflection/serialization breakage caught here. |
| Manifest audit | Automated test over the merged manifest: only the two intended exported receivers; `allowBackup=false`; no cleartext; `FLAG_SECURE` present on the two screens. |
| Release logging | Automated assertion that no body/token logging tree is installed in release; `adb logcat` during a manual run shows no message content. |
| Update flow | `latest.json` with a higher version → prompt; download → checksum verified → install; corrupted APK (flipped byte) → **rejected**, clear error, no install attempt; mandatory flag → non-dismissible; `min_supported_app_version` breach → blocking screen even without `latest.json`; update preserves Room data and credentials (assert un-uploaded messages survive). |
| Foreground service | Toggle on → notification present, process survives 30 min of aggressive background pressure; toggle off → notification gone, work still scheduled; no duplicate uploads with `UploadWorker`. |
| Battery/autostart helpers | Every OEM deep link either opens or fails gracefully (tested by forcing unknown-manufacturer paths); state changes reflected in the reliability score and the next heartbeat. |
| Revoke & wipe | Pending-message count shown; after wipe, no token/messages remain (inspect prefs + Room), all work cancelled, app returns to onboarding, and the server shows the device as revoked. |
| Localisation | Full walkthrough in Bengali including error and notification paths; screenshots at 2× font scale; reviewed by a Bengali speaker (record who and when). |
| Signing/CI | Tag → CI produces a signed APK; `apksigner verify` passes; `latest.json` checksum matches the artifact; `mapping.txt` archived; installing the CI APK over a locally-built one is rejected (proving signature integrity) and installing over a previous CI release succeeds. |
| **Device matrix** | Every cell of §4.7 executed and recorded on real hardware. No "lost" outcomes. |
| Battery impact | 24 h idle measurement per device class (`dumpsys batterystats`): app consumption within a documented budget; heartbeat + reconcile cadence justified against the measurement. |

**Smoke demo:** on the Xiaomi device — install the CI-signed APK, complete onboarding in Bengali, enable
battery-opt exemption and autostart via the in-app guidance, force-stop the app, send two payment SMS,
wait for the reconcile window, and show both recovered without opening the app; then trigger an in-app
update to a new version code and show data preserved.

---

## 7. Acceptance criteria

- [ ] Certificate pinning active in release with a backup pin; MITM proxy blocked and reported clearly; rotation procedure documented with lead-time requirements.
- [ ] The full instrumented test suite passes against a **release-minified, signed** build.
- [ ] Manifest hardening verified by automated audit; no body/token logging in release, verified by test and `logcat` inspection.
- [ ] Root/emulator signals are advisory only and never block usage.
- [ ] Battery-optimisation and per-OEM autostart guidance implemented, crash-safe on unknown ROMs, state reported in heartbeats and surfaced in the admin dashboard.
- [ ] Optional foreground service works, is off by default, and does not duplicate upload work.
- [ ] Update channel complete: `min_supported_app_version` blocking screen, `latest.json` check, SHA-256 verification (corrupt APK rejected), mandatory updates, EN/BN release notes, data preserved across updates.
- [ ] CI produces a signed APK + AAB + checksum + `latest.json` + archived `mapping.txt` on tag; keystore custody and backup documented in the runbook.
- [ ] Revoke & wipe removes all local data and credentials, warns about pending messages, and revokes server-side.
- [ ] Privacy policy in-app and hosted; data-transparency screen accurate; consent records the policy version.
- [ ] Full EN/BN localisation reviewed by a Bengali speaker; large font scales render correctly.
- [ ] `docs/device-matrix.md` complete for all four device classes with **zero "lost"** outcomes; anything recoverable only via Manual Sync is documented in the setup guide.
- [ ] Battery consumption measured per device class and within the documented budget.
- [ ] `docs/android-setup-guide.md` final in EN/BN with per-OEM screenshots.

---

## 8. Risks & notes

- **Google Play is not an option for this app** (`architecture.md §17.1`): `READ_SMS`/`RECEIVE_SMS` are
  restricted permissions granted essentially only to default SMS handlers, and a payment-verification
  utility does not qualify. Do not spend time on a Play submission or a declaration form; the direct
  signed-APK channel built here fits the licensing model. If a Play presence is ever needed, the path is
  a separate build using `NotificationListenerService` behind the same capture interface — plan it as a
  project, not a workaround.
- **Keystore loss is unrecoverable**: no merchant could install an update again (a different signature
  won't upgrade). Two offline backups, documented custody, and a note in the runbook. This is the single
  highest-consequence operational artifact in the project.
- **Pin rotation is the pinning trap**: ship the new pin in an app release *before* the certificate
  changes, keep a backup pin, and keep a rescue path (a fresh APK plus `min_supported_app_version`) for
  the case where devices can no longer connect. Verify the rescue path once, on purpose, in staging.
- Sideloading friction is real: merchants must enable "install unknown apps" for the browser/file
  manager. The setup guide needs screenshots for each OEM, and support should expect this to be the
  most common onboarding question.
- Expect to fix Task 14 issues discovered here. Budget for it: the device matrix is the first time the
  reliability guarantees meet actual hostile ROMs, and finding a problem here is the point.
