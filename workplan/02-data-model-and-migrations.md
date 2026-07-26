# Task 02 — Data Model & Migrations

| | |
|---|---|
| **Track** | Core |
| **Depends on** | 01 |
| **Unblocks** | 03 → everything |
| **Est. effort** | 3–4 days |
| **Risk** | Medium-high — schema mistakes on money tables are expensive to reverse later |

---

## 1. Objective

Implement the complete PostgreSQL schema from `architecture.md §6` as reviewed Prisma migrations,
including the **database-level invariants that make double-crediting impossible**, plus seed data
and a reusable integration-test harness.

The correctness guarantees in `architecture.md §14` must be enforced by constraints in this task —
not by application code in Task 08.

---

## 2. Scope of work

### In scope
- Prisma schema: all tables and enums in `architecture.md §6` (§6.1–§6.11).
- Raw-SQL migration additions Prisma cannot express: partial unique indexes, `CHECK` constraints,
  trigram indexes for admin search, `updated_at` triggers.
- `match_attempts` table (decision trace) — an addition to `architecture.md §6`, recorded in this task.
- Seed script: admin user, provider profiles, parser-rule placeholders, dev company + both key types.
- Integration-test harness (Testcontainers Postgres + Redis, migrate + truncate-between-tests).
- Constraint tests proving each invariant fails closed.
- `sql/invariants.sql` — the four correctness queries from `architecture.md §9.4`.

### Out of scope
- Any NestJS code, repositories, or services → Task 03+.
- Parser rule *content* → Task 05 (this task seeds a placeholder row so FKs resolve).
- Postgres RLS → post-v1 (`architecture.md §13.1 T5`).

---

## 3. Prerequisites

- Task 01 complete: workspace, shared enums, dev Postgres reachable.
- `apps/api` directory exists as a package shell (create it here if Task 01 left it empty; the NestJS
  bootstrap itself is Task 03).

---

## 4. Implementation steps

### 4.1 Prisma setup
1. `apps/api/prisma/schema.prisma` — datasource Postgres, `previewFeatures` as needed,
   generator `prisma-client-js` output inside the package.
2. Conventions applied uniformly:
   - `@id @default(dbgenerated("uuid_generate_v7()"))` (add the uuid v7 function via migration SQL;
     fall back to `gen_random_uuid()` + app-side v7 if the PG extension is unavailable).
   - `@db.Timestamptz(3)` everywhere; `@db.Decimal(14,2)` for money; `@db.VarChar(n)` explicit.
   - `created_at`/`updated_at` on all mutable tables; `@@map` to snake_case table names.
3. Enums mirrored exactly from `packages/shared/src/enums.ts`.

### 4.2 Tables — in dependency order
Implement exactly as specified in `architecture.md §6`:
1. `companies` (§6.1) — including `webhook_secret_enc`, `webhook_secret_prev_enc`, rotation timestamp.
2. `company_settings` (§6.9) — 1:1 with companies, every knob with its documented default.
3. `api_keys` (§6.2) — `key_type`, `prefix`, `key_hash`, `scopes`, revocation.
4. `devices` (§6.3) — `install_id`, `token_hash`, health telemetry, `clock_skew_seconds`.
5. `provider_profiles` + `parser_rules` (§6.10) — versioned, append-only.
6. `sms_logs` (§6.4) — `sms_address` **NOT NULL**, `raw_message` NOT NULL, `client_msg_hash`, `flags`.
7. `payment_requests` (§6.5) — `expected_amount`, `match_mode`, `amount_tolerance` snapshot, `expires_at`.
8. `verified_transactions` (§6.6) — the double-UNIQUE table.
9. `webhook_events` + `webhook_deliveries` (§6.7).
10. `match_reviews` (§6.8).
11. `match_attempts` (**new**, see §4.4).
12. `admin_users`, `admin_sessions`, `audit_logs`, `auth_attempts`, `idempotency_keys` (§6.11).

### 4.3 Invariants — raw SQL in the migration
These are the heart of the task. Add via `prisma migrate dev --create-only` then hand-write SQL:

```sql
-- One order verified once; one SMS spent once (architecture.md §14)
ALTER TABLE verified_transactions
  ADD CONSTRAINT vt_payment_request_unique UNIQUE (payment_request_id),
  ADD CONSTRAINT vt_sms_log_unique         UNIQUE (sms_log_id);

-- Upload idempotency
CREATE UNIQUE INDEX sms_logs_company_msg_hash_uq
  ON sms_logs (company_id, client_msg_hash);

-- Register idempotency (natural key)
CREATE UNIQUE INDEX payment_requests_company_order_uq
  ON payment_requests (company_id, order_id);

-- Two LIVE orders cannot claim the same TrxID
CREATE UNIQUE INDEX payment_requests_company_txn_live_uq
  ON payment_requests (company_id, transaction_id)
  WHERE transaction_id IS NOT NULL AND status IN ('PENDING','VERIFIED');

-- Money sanity
ALTER TABLE payment_requests      ADD CONSTRAINT pr_amount_positive  CHECK (expected_amount > 0);
ALTER TABLE payment_requests      ADD CONSTRAINT pr_tolerance_nonneg CHECK (amount_tolerance >= 0);
ALTER TABLE sms_logs              ADD CONSTRAINT sms_amount_nonneg   CHECK (amount IS NULL OR amount >= 0);
ALTER TABLE verified_transactions ADD CONSTRAINT vt_confidence_range CHECK (confidence > 0 AND confidence <= 1);

-- Callback URLs must be https
ALTER TABLE payment_requests ADD CONSTRAINT pr_callback_https
  CHECK (callback_url LIKE 'https://%');

-- Exactly one subject on a review row
ALTER TABLE match_reviews ADD CONSTRAINT mr_subject_present
  CHECK (sms_log_id IS NOT NULL OR payment_request_id IS NOT NULL);

-- One open review per (sms, order) pair — prevents review-queue spam on rescans
CREATE UNIQUE INDEX match_reviews_open_uq
  ON match_reviews (COALESCE(sms_log_id,'00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(payment_request_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'OPEN';

-- Idempotency store
CREATE UNIQUE INDEX idempotency_keys_uq ON idempotency_keys (company_id, endpoint, key);
```

Performance indexes exactly as listed in `architecture.md §6.4/§6.5`, plus admin search:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX sms_logs_raw_trgm ON sms_logs USING gin (raw_message gin_trgm_ops);
CREATE INDEX sms_logs_txn_trgm ON sms_logs USING gin (transaction_id gin_trgm_ops);
```
Plus a generic `set_updated_at()` trigger function attached to every table with `updated_at`.

### 4.4 `match_attempts` (schema addition)
Every matching decision — including non-decisions — is recorded so the dashboard can answer
"why wasn't this verified?" in one screen (`architecture.md §12`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK | |
| `trigger` | enum `SMS_UPLOAD\|ORDER_REGISTER\|RESCAN\|REPARSE\|ADMIN` | |
| `sms_log_id` | uuid FK NULL | |
| `payment_request_id` | uuid FK NULL | chosen order, if any |
| `result` | enum `VERIFIED\|UNMATCHED\|REVIEW\|IGNORED\|DUPLICATE\|GUARD_REJECTED` | |
| `pass` | enum `EXACT\|HEURISTIC\|NONE` | |
| `guard_failed` | varchar(64) NULL | e.g. `DIRECTION_NOT_CREDIT`, `PROVIDER_NOT_ALLOWED` |
| `candidates` | jsonb | `[{payment_request_id, score, signals:{...}}]` ranked snapshot |
| `chosen_score` | numeric(3,2) NULL | |
| `runner_up_score` | numeric(3,2) NULL | |
| `parser_rule_version` | int NULL | |
| `duration_ms` | int | |
| `created_at` | timestamptz | |

Indexes: `(sms_log_id, created_at DESC)`, `(payment_request_id, created_at DESC)`,
`(company_id, result, created_at DESC)`. Retention 90 days (Task 16 purge job).

> **Docs:** add this table to `architecture.md §6` as §6.8b in the same PR so the architecture stays
> the source of truth.

### 4.5 Seed (`apps/api/prisma/seed.ts`)
Idempotent (upsert-based), environment-aware:
- **Always:** `provider_profiles` for BKASH/NAGAD/UPAY with the sender-address allowlists;
  one `parser_rules` placeholder row per provider (`version 0`, `is_active=false`) so Task 05 can
  activate real rules; the admin user from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` with TOTP unenrolled.
- **Dev/test only:** company `COMP-DEV-001` (ACTIVE) with default settings, one `SERVER` key and one
  `DEVICE_ENROLL` key whose plaintext values are **fixed, printed, and documented as dev-only**
  (`psk_test_devkey000…`), one enrolled device, and a handful of `sms_logs` / `payment_requests`
  in assorted states for dashboard work in Tasks 11–12.
- Refuses to create dev fixtures when `NODE_ENV=production` (test asserts this).

### 4.6 Test harness (`apps/api/test/db/`)
1. `testcontainers.ts` — boots PG 16 + Redis 7 once per suite run, applies
   `prisma migrate deploy`, exposes the connection string.
2. `truncate.ts` — fast reset between tests (`TRUNCATE … RESTART IDENTITY CASCADE` over a
   generated table list, preserving `provider_profiles`/`parser_rules`).
3. `factories.ts` — typed builders: `makeCompany()`, `makeDevice()`, `makeSmsLog()`,
   `makePaymentRequest()`, `makeVerifiedTransaction()`. Every later task builds on these; keep them
   overridable and free of hidden defaults on money fields.

### 4.7 `sql/invariants.sql`
The four queries from `architecture.md §9.4`, each returning offending rows (empty = healthy):
1. `VERIFIED` orders without exactly one `verified_transactions` row.
2. `sms_log_id` appearing in more than one verification (defensive — the UNIQUE should prevent it).
3. `match_status='MATCHED'` sms_logs with no verification row.
4. `PENDING` orders past `expires_at + late_match_grace_hours`.
Plus: `verified_transactions` whose `amount_delta` exceeds the order's `amount_tolerance`.
Wired to a scheduled job in Task 16 and a dashboard tile in Task 12.

---

## 5. Files created / modified

```
apps/api/package.json
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/0001_init/migration.sql
apps/api/prisma/migrations/0002_invariants_and_indexes/migration.sql
apps/api/prisma/migrations/0003_match_attempts/migration.sql
apps/api/prisma/seed.ts
apps/api/test/db/{testcontainers.ts,truncate.ts,factories.ts}
apps/api/test/schema/{constraints.spec.ts,enum-parity.spec.ts,seed.spec.ts}
sql/invariants.sql
docs/data-model.md              # ER diagram + column rationale for the non-obvious columns
architecture.md                 # add §6.8b match_attempts
packages/shared/test/enum-parity.spec.ts   # un-skip the Task 01 placeholder
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Constraint tests** (most important) | For each invariant, a test that *expects* a failure: two `verified_transactions` for one order → unique violation; two for one SMS → violation; duplicate `(company_id, client_msg_hash)` → violation; duplicate `(company_id, order_id)` → violation; two PENDING orders with the same TrxID → violation; a third order with that TrxID after the first is `CANCELLED` → **succeeds** (proves the partial index predicate); `expected_amount = 0` → check violation; `http://` callback → check violation; two OPEN reviews for the same pair → violation. |
| Enum parity | Prisma enum values ≡ `packages/shared` enums, both directions, no extras. |
| Migration integrity | `prisma migrate deploy` on an empty DB, then `prisma migrate diff --from-schema-datamodel --to-schema-datasource` reports **no drift** (CI gate). |
| Migration repeatability | Deploy → seed → deploy again → seed again: no errors, no duplicate rows. |
| Seed safety | `NODE_ENV=production` seed creates the admin + provider profiles but no dev company/keys. |
| Query plans | `EXPLAIN ANALYZE` the three hot queries with ~100k synthetic `sms_logs`: exact TrxID lookup, heuristic candidate scan (`company_id, expected_amount, created_at` on PENDING), unmatched rescan. All must use an index scan; record plans in `docs/data-model.md`. |
| Invariants script | Seed a deliberately broken state via raw SQL, confirm each query reports it; then on clean seed all return 0 rows. |
| Timestamp handling | Insert with a `+06:00` offset, read back, assert UTC storage and correct round-trip. |
| Decimal handling | Insert `1250.00`, read via Prisma, convert through `Money`, assert exact paisa (no float drift). |

**Smoke demo:** `pnpm --filter api prisma migrate reset && pnpm --filter api prisma db seed`, then
`psql` showing the dev company, its two keys, its device, and `sql/invariants.sql` returning nothing.

---

## 7. Acceptance criteria

- [ ] All tables/enums from `architecture.md §6` plus `match_attempts` exist with correct types (money `NUMERIC(14,2)`, times `timestamptz`).
- [ ] Every invariant in §4.3 is enforced **by the database**, each proven by a failing-insert test.
- [ ] The partial-unique TrxID index permits TrxID reuse after `CANCELLED`/`EXPIRED`/`REJECTED` but blocks it while `PENDING`/`VERIFIED` — both directions tested.
- [ ] `prisma migrate deploy` runs clean on an empty DB; drift check green in CI.
- [ ] Seed is idempotent and production-safe; dev keys are fixed, printed, and documented as dev-only.
- [ ] Testcontainers harness + factories usable by other packages; a sample test runs in CI in under 90 s.
- [ ] `sql/invariants.sql` returns zero rows on a seeded DB and detects each seeded-broken case.
- [ ] Hot-path queries verified index-scanning at 100k rows, plans recorded in `docs/data-model.md`.
- [ ] `architecture.md` updated with §6.8b; `docs/data-model.md` has the ER diagram.

---

## 8. Risks & notes

- **`verified_transactions`' two UNIQUE constraints are the product's safety net.** If a later task
  ever needs to relax one (e.g. partial payments), that is an architecture change requiring an ADR —
  not a migration someone writes in passing.
- `sms_address` is deliberately `NOT NULL`: it is the anti-spoof signal (`architecture.md §13.1 T1`).
  Making it nullable "for flexibility" would quietly remove a security control.
- `payment_requests.amount_tolerance` is snapshotted per order on purpose — changing a company's
  tolerance must not retroactively change how existing orders match.
- uuid v7: if the `pg_uuidv7` extension isn't available on the target Postgres image, generate v7 in
  the app (`packages/shared/ids.ts`) and keep `gen_random_uuid()` only as a DB default fallback.
  Decide **now**, not in Task 16, so index locality is consistent from the first row.
