# Data model

PostgreSQL 16. Money is `NUMERIC(14,2)`, compared as integer paisa. Time is `timestamptz` in UTC.
All PKs are `uuid` (the app supplies **uuidv7** on insert for index locality; the DB default
`gen_random_uuid()` is a fallback). The schema lives in
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma); the correctness invariants that
Prisma cannot express are in the `*_invariants_and_indexes` migration.

## Tables

| Table                                             | Role                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `companies`, `company_settings`                   | tenant + its per-tenant matching/verification policy          |
| `api_keys`                                        | dual credentials (`SERVER`, `DEVICE_ENROLL`), Argon2id-hashed |
| `devices`                                         | one merchant phone; health telemetry + clock skew             |
| `provider_profiles`, `parser_rules`               | versioned, data-driven SMS parsing                            |
| `sms_logs`                                        | immutable captured messages + server extraction               |
| `payment_requests`                                | orders registered by client websites                          |
| `verified_transactions`                           | the money-critical join (double-UNIQUE)                       |
| `webhook_events`, `webhook_deliveries`            | event (frozen payload) + per-attempt history                  |
| `match_reviews`                                   | ambiguous-match queue                                         |
| `match_attempts`                                  | full decision trace ("why wasn't this verified?")             |
| `admin_users`, `admin_sessions`                   | admin identity + refresh-token families                       |
| `audit_logs`, `auth_attempts`, `idempotency_keys` | audit, auth logging, idempotency store                        |

## Invariants enforced by the database (not by application code)

These are the guarantees from `architecture.md §14`, proven by failing-insert tests in
`apps/api/test/schema/constraints.spec.ts`:

- **One order verified once / one SMS spent once** — `UNIQUE(payment_request_id)` and
  `UNIQUE(sms_log_id)` on `verified_transactions`. This is what makes double-crediting impossible.
- **Two live orders cannot claim one TrxID** — partial unique index on
  `payment_requests(company_id, transaction_id) WHERE status IN ('PENDING','VERIFIED')`. TrxID reuse is
  permitted only after the earlier order is `CANCELLED`/`EXPIRED`/`REJECTED`.
- **Upload idempotency** — `UNIQUE(company_id, client_msg_hash)` on `sms_logs`.
- **Register idempotency** — `UNIQUE(company_id, order_id)` on `payment_requests`.
- **One OPEN review per (sms, order) pair** — a partial unique index over `COALESCE`d ids, so rescans
  don't spam the queue.
- **Money & callback sanity** — CHECKs: `expected_amount > 0`, `amount_tolerance >= 0`,
  `sms.amount >= 0`, `0 < confidence <= 1`, `callback_url LIKE 'https://%'`, and every review names a
  subject.

`sms_address` is deliberately `NOT NULL` — it is the anti-spoof signal (`architecture.md §13.1 T1`).
`payment_requests.amount_tolerance` is snapshotted per order, so changing a company's tolerance never
retroactively changes how existing orders match.

## Hot-path indexes

- Exact match: `sms_logs(company_id, transaction_id)`.
- Heuristic candidate scan: `payment_requests(company_id, expected_amount, created_at) WHERE status='PENDING'`.
- Unmatched rescan: `sms_logs(company_id, match_status, sms_timestamp DESC)`.
- Admin search: GIN trigram on `sms_logs.raw_message` and `sms_logs.transaction_id`.
- Expiry sweep: `payment_requests(company_id, status, expires_at)`.

## Migrations & tooling

Migrations are generated with Prisma against a throwaway real PostgreSQL 16 (via `embedded-postgres`,
no Docker); see `apps/api/scripts/with-pg.mjs`. The invariant SQL (partial indexes, CHECKs, the
`set_updated_at` trigger, trigram indexes) is a hand-written, reviewed migration on top of the
Prisma-generated `init`. `sql/invariants.sql` holds the runtime correctness queries.
