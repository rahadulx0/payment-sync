# Error codes

Every non-2xx response uses the envelope:

```json
{ "error": { "code": "RATE_LIMITED", "message": "...", "details": {}, "request_id": "018f..." } }
```

Always log `request_id` — it ties your report to our logs.

| Code                       | HTTP | Meaning                                         | Recommended client action                                                       |
| -------------------------- | ---- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`          | 401  | Missing or invalid credentials                  | Check `Authorization` and the audience header (`X-Company-Id` / `X-Install-Id`) |
| `INVALID_CREDENTIAL`       | 401  | Credential rejected                             | Rotate/reissue the credential                                                   |
| `COMPANY_SUSPENDED`        | 403  | Company is not active                           | Contact the platform operator                                                   |
| `DEVICE_BLOCKED`           | 403  | Device is blocked                               | Contact support                                                                 |
| `DEVICE_RETIRED`           | 403  | Device retired                                  | Re-enroll the device                                                            |
| `DEVICE_LIMIT_REACHED`     | 409  | Device cap reached                              | Retire an old device, then re-enroll                                            |
| `FORBIDDEN_SCOPE`          | 403  | Key lacks the required scope                    | Use a key with the needed scope                                                 |
| `VALIDATION_ERROR`         | 400  | Request failed validation                       | Fix the payload per `details`                                                   |
| `DUPLICATE_ORDER_ID`       | 409  | `order_id` already used with different data     | Use a new `order_id`, or resend the identical body                              |
| `DUPLICATE_TRANSACTION_ID` | 409  | TrxID already claimed by a live order           | Do not reuse a TrxID across live orders                                         |
| `IDEMPOTENCY_KEY_REUSED`   | 409  | Same `Idempotency-Key`, different body          | Use a fresh key for a different request                                         |
| `REQUEST_IN_PROGRESS`      | 409  | A request with this key is in flight            | Retry after a short delay                                                       |
| `ORDER_NOT_FOUND`          | 404  | No such order for this company                  | Verify the `order_id`                                                           |
| `ORDER_NOT_PENDING`        | 409  | Order is not in a state that allows this action | Re-check the order status                                                       |
| `INVALID_CALLBACK_URL`     | 400  | Callback URL is not a public HTTPS URL          | Use a public `https://` endpoint                                                |
| `RATE_LIMITED`             | 429  | Too many requests                               | Honour `Retry-After`                                                            |
| `PAYLOAD_TOO_LARGE`        | 413  | Body exceeds the limit                          | Reduce payload (batch ≤ 50, `metadata` ≤ 4 KB)                                  |
| `INTERNAL_ERROR`           | 500  | Unexpected server error                         | Retry with backoff; report `request_id`                                         |
