# Playbook: a merchant's device is offline

Triggered by the `device.offline` P2 alert (no heartbeat for >30 min during 09:00–23:00 Asia/Dhaka).

**Why this matters more than it looks:** an offline phone is not a monitoring blip. It means payment
SMS are arriving on a phone that is not reporting them, so the merchant's orders are silently not being
verified. The customer has paid and is waiting.

## 1. Confirm (30 seconds)

Admin → **Devices**. The offline banner lists every device with no heartbeat. Open the device to see
its last telemetry: SMS permission, battery-optimisation exemption, battery level, app version.

## 2. Decide which of the four causes it is

| Signal                                               | Cause                                                   | Action                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `has_sms_permission: false`                          | Permission was revoked (often by a "phone cleaner" app) | Ask the merchant to re-grant SMS permission; the app's Diagnostics screen names the exact steps |
| `is_ignoring_battery_opt: false` on Xiaomi/Oppo/vivo | The ROM is killing the app                              | Walk them through **Allow background activity** + **Open autostart settings** in the app        |
| Battery very low / phone off                         | Mundane                                                 | Ask them to charge it; nothing is lost — captured SMS upload when it returns                    |
| Everything looks fine, just no heartbeat             | Network                                                 | Ask them to open the app and tap **Sync now**                                                   |

## 3. Reassure correctly

Nothing is lost while a phone is offline. The app stores every captured message durably and uploads it
when connectivity returns; the inbox reconcile scan also recovers anything the broadcast missed. If the
order has already expired, late matching within the grace window still verifies it and the webhook
carries `was_late: true`.

What **is** lost is time — the customer is waiting now. If they need the order released immediately,
resolve it from Admin → **Reviews** (or verify manually from the SMS drill-down) rather than waiting
for the phone.

## 4. Ask them to tap "Sync now"

This is the single most effective instruction. It re-scans the inbox, re-queues everything unsent, and
reports a truthful summary — including anything still pending. Then have them send **Diagnostics →
Copy diagnostics for support**; that block is safe to share (no message bodies, no token, no customer
numbers) and answers most follow-up questions without another round trip.

## 5. If it repeats on the same phone

That phone's ROM is hostile. In order of effectiveness:

1. Battery-optimisation exemption (biggest single win).
2. Autostart permission via the in-app OEM deep link.
3. Turn on **Payment monitoring** (the optional foreground service) — a persistent low-priority
   notification that keeps the process alive.
4. Record the outcome in `docs/device-matrix.md`, and if the device class is consistently bad, say so in
   the setup guide rather than letting the next merchant discover it.
