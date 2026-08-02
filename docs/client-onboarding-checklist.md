# Client onboarding checklist

One pass per new business. Steps are ordered so a mistake is caught before it reaches a real customer.

## 1. Create the company (Admin → Companies → New)

- [ ] Business name, contact email, default callback URL (https, publicly reachable)
- [ ] **Save the one-time credentials.** Four secrets are shown **once**: company code, server key
      (`psk_live_`), device enroll key (`pde_live_`), webhook secret (`whsec_`)
- [ ] Download the onboarding packet

> **Deliver credentials over two different channels** — e.g. the packet by email, the server key read
> aloud or over a separate messenger. Never both in one thread. Losing a key means rotation, which takes
> the client's site down until they update it.

## 2. Set conservative initial settings

- [ ] `heuristic_enabled` = **false** (exact TrxID only, to start)
- [ ] `order_ttl_minutes` = 60
- [ ] `amount_tolerance` = 0
- [ ] `allowed_providers` = BKASH only (unless they genuinely take others)

Loosen these later with evidence, never at onboarding.

## 3. Client integrates on staging

- [ ] They read `docs/integration-guide.md` and integrate **unaided** — every question they have to ask
      is a documentation bug; fix the doc, don't just answer
- [ ] Register → poll round trip works
- [ ] `POST /webhooks/test` returns delivered, and **their** verifier accepts the signature
- [ ] They confirm the raw-body rule (verify before parsing JSON) — this is the #1 cause of mismatch
- [ ] Strongly recommend they collect the **TrxID** or the **sender's mobile number** at checkout;
      explain that with neither, verification falls back to amount+time and two customers paying the
      same amount within the window means a manual review and a delay

## 4. Merchant phone

- [ ] Install the signed APK (sideload — there is no Play listing; see `docs/android-setup-guide.md`)
- [ ] Complete consent → permission → enrollment in the merchant's own language
- [ ] Grant the battery-optimisation exemption, and autostart if the brand needs it
- [ ] Heartbeat visible in Admin → Devices within 15 minutes
- [ ] Diagnostics shows **Reliability: good**

## 5. Prove the whole chain with real money

- [ ] Merchant registers a small real order and pays it from a real wallet
- [ ] Admin shows: SMS captured → matched → verified → webhook delivered
- [ ] The client's site actually flips the order to paid

Do not skip this. Everything before it is theory.

## 6. Go live and watch

- [ ] Switch the client to production credentials
- [ ] **7-day watch period**: check daily — verification rate, unmatched SMS, open reviews, webhook
      health, device liveness
- [ ] Enable heuristic matching only if their checkout genuinely cannot collect a TrxID, and only once
      `sender_msisdn` is being sent

## What to tell them about support

- Contact channel and response expectations
- What to send: the **support bundle** from the transaction screen (operator side) or **Copy
  diagnostics** from the app (merchant side). Both are redacted and safe to paste
- What the platform asserts: _"a credit SMS consistent with this order was received on the registered
  device"_ — **not** that funds settled. Their own reconciliation duty is unchanged
  (`docs/client-agreement-notes.md`)
