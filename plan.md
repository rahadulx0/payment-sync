# Payment Verification Platform — Product Requirements & Architecture Specification

## Project Overview

Build a **payment verification platform** consisting of:

* **Android App** (installed on the client’s Android phone)
* **Central Web Platform / API Server** (owned and managed by me)
* **Client Website Integration API** (used by client websites to verify payments)

The purpose of this system is to help businesses in Bangladesh automatically verify payments received through **bKash, Nagad, and Upay** without requiring official merchant APIs from those providers.

---

# Business Model

* **I am the only administrator** of the platform.
* Public users must **NOT** be able to create accounts on the web platform.
* Client onboarding is done **manually by me**.
* I will **sell or license the Android app** to clients.
* Each client will receive a unique **Company ID / API Key** that links their Android app and website to my central server.

---

# High-Level Architecture

```text
Client Phone (Android App)
        │
        │ Reads incoming SMS (with user permission)
        ▼
Central API Server (My Platform)
        │
        │ Matches transaction ID with pending website orders
        ▼
Client Website (Webhook / API callback)
```

---

# Core Workflow

## 1. Client Onboarding

### Admin actions

* Create a new company from the admin dashboard.
* Generate:

  * `company_id`
  * `api_key`
  * `webhook_secret`
* Provide these credentials to the client.

### Client actions

* Install the Android app.
* Enter the provided `company_id` and `api_key`.
* Grant required permissions.

---

# 2. Android App Requirements

## Required Permissions

* SMS read permission
* Receive SMS permission
* Internet access
* Run in background / auto-start (if supported by device)

## Authentication

The app must authenticate with:

```json
{
  "company_id": "COMP12345",
  "api_key": "generated_api_key"
}
```

Store credentials securely using encrypted storage.

---

# 3. SMS Capture

The app must listen for incoming SMS messages from providers such as:

* bKash
* Nagad
* Upay

## Example Messages

### bKash

```text
Cash In Tk 1,250.00 from 017XXXXXXXX. TrxID 8A7BCD1234 at 27/07/2026 10:15
```

### Nagad

```text
You have received Tk 500.00 from 018XXXXXXXX. Txn ID: NAG12345678.
```

### Upay

```text
Payment received. Amount: 300.00 BDT. Transaction ID UPA987654321.
```

---

# 4. SMS Parsing

Extract the following fields:

```json
{
  "provider": "bkash",
  "transaction_id": "8A7BCD1234",
  "amount": 1250.00,
  "sender": "017XXXXXXXX",
  "received_at": "2026-07-27T10:15:00+06:00",
  "raw_message": "original sms text"
}
```

The parser should be modular so new providers can be added later.

---

# 5. Upload to Server

Send parsed SMS data to:

```http
POST /api/v1/sms/upload
```

### Headers

```http
Authorization: Bearer <api_key>
X-Company-ID: COMP12345
```

### Payload

```json
{
  "provider": "bkash",
  "transaction_id": "8A7BCD1234",
  "amount": 1250.00,
  "sender": "017XXXXXXXX",
  "received_at": "2026-07-27T10:15:00+06:00",
  "raw_message": "..."
}
```

---

# 6. Website Order Registration

Client websites will register pending payment requests.

## Endpoint

```http
POST /api/v1/payments/register
```

## Payload

```json
{
  "order_id": "ORD-1001",
  "transaction_id": "8A7BCD1234",
  "amount": 1250.00,
  "callback_url": "https://clientsite.com/api/payment/verify"
}
```

Store all unmatched transaction IDs in a **Pending Transactions** table.

---

# 7. Matching Engine

When an SMS is uploaded:

* Find pending transactions for the same company.
* Match by:

  * `transaction_id`
  * optional `amount`
* If matched:

  * mark payment as `VERIFIED`
  * store verification timestamp
  * trigger webhook callback to the client website

---

# 8. Webhook Callback

## Request

```http
POST https://clientsite.com/api/payment/verify
```

## Payload

```json
{
  "status": "VERIFIED",
  "order_id": "ORD-1001",
  "transaction_id": "8A7BCD1234",
  "amount": 1250.00,
  "provider": "bkash",
  "verified_at": "2026-07-27T10:16:02+06:00",
  "signature": "HMAC_SHA256_SIGNATURE"
}
```

The client website should treat this as the **green signal** that payment has been completed.

---

# 9. Manual Sync Feature (Android App)

Add a **Manual Sync** button.

## Behavior

* Scan recent SMS messages from supported providers.
* Find messages that were not uploaded successfully.
* Upload them to the server.
* The server should re-check all previously unmatched transactions.
* If a match is found, immediately send the webhook callback.

This feature is essential for:

* internet outages
* app force-close situations
* battery optimization restrictions
* missed background events

---

# 10. Admin Dashboard Requirements

## Company Management

* Create company
* Disable company
* Regenerate API key
* View webhook configuration

## Transaction Monitoring

* Incoming SMS logs
* Pending transactions
* Verified transactions
* Failed matches
* Webhook delivery status
* Retry webhook button

## Analytics

* Total verified payments
* Verification success rate
* Provider-wise statistics
* Daily transaction volume

---

# 11. Database Design

## companies

| Field          | Type   |
| -------------- | ------ |
| id             | UUID   |
| company_id     | string |
| name           | string |
| api_key_hash   | string |
| webhook_secret | string |
| status         | enum   |

## sms_logs

| Field          | Type      |
| -------------- | --------- |
| id             | UUID      |
| company_id     | UUID      |
| provider       | string    |
| transaction_id | string    |
| amount         | decimal   |
| raw_message    | text      |
| uploaded_at    | timestamp |

## pending_transactions

| Field          | Type    |
| -------------- | ------- |
| id             | UUID    |
| company_id     | UUID    |
| order_id       | string  |
| transaction_id | string  |
| amount         | decimal |
| callback_url   | string  |
| status         | enum    |

## verified_transactions

| Field                  | Type      |
| ---------------------- | --------- |
| id                     | UUID      |
| pending_transaction_id | UUID      |
| sms_log_id             | UUID      |
| verified_at            | timestamp |

---

# 12. Security Requirements

## Critical

* Use HTTPS everywhere.
* Hash API keys in the database.
* Sign webhook payloads with HMAC-SHA256.
* Encrypt sensitive app data.
* Implement request rate limiting.
* Log all authentication attempts.

## Access Control

* No public registration endpoint.
* Only admin can create companies.
* Admin dashboard protected with:

  * email/password
  * two-factor authentication
  * IP allowlisting (optional)

---

# 13. Android Technology Stack

## Recommended

* Kotlin
* Jetpack Compose
* Room Database
* WorkManager
* Retrofit + OkHttp
* EncryptedSharedPreferences

---

# 14. Backend Technology Stack

## Recommended

* Node.js (NestJS or Express)
* PostgreSQL
* Redis (queue/cache)
* BullMQ or RabbitMQ
* JWT for admin authentication
* Docker for deployment

---

# 15. API Reliability

Implement:

* automatic retry with exponential backoff
* idempotency keys
* duplicate SMS detection
* webhook retry queue
* offline storage on the device
* sync status tracking

---

# 16. Future Enhancements

* Multiple phones per company
* WhatsApp notification to merchant
* Payment dashboard for merchants
* CSV export
* Fraud detection rules
* OCR support for payment screenshots
* Optional cloud backup of SMS logs

---

# 17. Important Legal & Compliance Note

Because the system reads SMS messages from the client’s phone, the app must:

* clearly explain why SMS access is required
* obtain explicit user consent
* process only payment-related messages
* provide a privacy policy
* allow the client to revoke permissions at any time

The app should not collect unrelated personal SMS data.

---

# Final Objective

Create a production-ready system where:

* a customer places an order on a client website
* the website registers a pending transaction
* the merchant receives a payment SMS on their phone
* the Android app automatically uploads the SMS
* the server extracts and matches the transaction ID
* the server sends a secure verification callback
* the client website automatically marks the order as **PAID** without requiring any official bKash/Nagad/Upay API access.
