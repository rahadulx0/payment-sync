# Android device matrix

Reliability validation on real hardware (Task 15 §4.7). Emulators do **not** reproduce OEM
process-killing, so every guarantee in Tasks 13–14 is provisional until this table is filled in on
physical devices.

Record one of these per cell:

- **immediate** — captured and uploaded right away
- **reconcile** — missed the broadcast, recovered by the 6-hourly reconcile
- **manual** — recovered only when the merchant tapped _Sync now_
- **lost** — never recovered → **release blocker**

> `manual` is acceptable but must be reflected in the setup guide's recommendation for that OEM.
> `lost` blocks the release.

## Matrix

| Scenario                                          | Xiaomi / HyperOS | Oppo / Realme | Samsung / OneUI | Stock / Pixel |
| ------------------------------------------------- | ---------------- | ------------- | --------------- | ------------- |
| Capture with app in foreground                    |                  |               |                 |               |
| Capture with app backgrounded 1 h                 |                  |               |                 |               |
| Capture with app force-stopped                    |                  |               |                 |               |
| Capture after 24 h idle (doze)                    |                  |               |                 |               |
| Capture after reboot (no app launch)              |                  |               |                 |               |
| Airplane mode 30 min → reconnect                  |                  |               |                 |               |
| Battery-opt exemption granted                     |                  |               |                 |               |
| Battery-opt exemption NOT granted                 |                  |               |                 |               |
| Autostart enabled                                 |                  |               |                 |               |
| Autostart NOT enabled                             |                  |               |                 |               |
| Foreground service ON                             |                  |               |                 |               |
| Foreground service OFF                            |                  |               |                 |               |
| Permission revoked then re-granted                |                  |               |                 |               |
| SIM removed / no signal                           |                  |               |                 |               |
| Storage full                                      |                  |               |                 |               |
| Clock set 10 min off                              |                  |               |                 |               |
| App update over existing install (data preserved) |                  |               |                 |               |
| Manual Sync recovers everything missed            |                  |               |                 |               |

## Battery impact

24 h idle measurement per device class (`adb shell dumpsys batterystats`), with the heartbeat
(15 min) and reconcile (6 h) cadence justified against it.

| Device           | App % of battery / 24 h idle | Notes |
| ---------------- | ---------------------------- | ----- |
| Xiaomi / HyperOS |                              |       |
| Oppo / Realme    |                              |       |
| Samsung / OneUI  |                              |       |
| Stock / Pixel    |                              |       |

## Status

**Not yet executed.** This requires physical handsets from the target market (a borrowed or
second-hand device per class is fine, and is not optional given who uses this app). Until it is
filled in, the app should not be handed to a merchant beyond the supervised pilot in Task 17.
