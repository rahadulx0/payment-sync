# payment-sync — privacy policy

**Policy version 1** · applies to the payment-sync Android app installed on a merchant's own phone.

## What this app reads

Only SMS messages sent **from the mobile-money providers** bKash, Nagad and Upay. The app matches the
sender address against an exact allowlist. A message from any other sender — a person, a bank, an
advertiser — is **discarded before anything is stored or logged**. It is never read, never saved, never
transmitted.

## What leaves the phone

For provider payment messages only:

- the amount, transaction id, sender number and timestamp contained in the message
- the message text of that payment message
- the phone's technical status (app version, Android version, battery, permission state, queue depth)

This goes to the merchant's own payment-verification server and nowhere else. The app contacts exactly
one host. There is no analytics SDK, no advertising SDK, and no third-party network call of any kind.

## What never leaves the phone

Every other SMS on the device. Contacts. Photos. Location. Call history. The app does not request or
access them.

## Why

So the merchant's website can automatically confirm that a customer's payment arrived, instead of the
merchant checking their phone by hand for every order.

## How long it is kept

Payment messages that have been delivered to the server are deleted from the phone after 30 days.
Messages that have **not** yet been delivered are kept until they are — they are never deleted while
undelivered. Server-side retention is configured per business (180 days by default).

## Consent and control

- The app explains this **before** requesting SMS permission, and records the consent (timestamp, app
  version, policy version, language).
- SMS permission can be revoked at any time in Android Settings; capture stops immediately.
- **Disconnect and erase data** in the app removes the credentials and all locally stored messages, and
  disconnects the phone from the business. The app warns first if undelivered payments would be lost.

## Security

- The device credential is stored encrypted (AES-256-GCM, key held in the Android Keystore).
- Traffic is HTTPS only, with certificate pinning; cleartext is disabled and user-installed
  certificate authorities are not trusted.
- Local data is excluded from cloud backup and device-transfer.

## Contact

Questions or a data request: contact the business that issued this app, or the platform operator listed
in your onboarding pack.
