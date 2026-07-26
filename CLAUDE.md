# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**Documentation only — no code has been written yet.** The repo contains:

| File | Role |
|---|---|
| `plan.md` | Product requirements (source of truth for *what*) |
| `architecture.md` | System architecture + 13 numbered ADRs (source of truth for *how*) |
| `workplan/README.md` | Task index, dependency graph, global conventions, progress tracker |
| `workplan/01..17-*.md` | 17 sequential milestone tasks, each with acceptance criteria |

Implementation starts at `workplan/01-foundation-and-dev-environment.md`. Before writing code for a
task, read: the task file → the `architecture.md` sections it cites → `workplan/README.md §4`
(global conventions and Definition of Done). Check the progress table in `workplan/README.md §5` to
see where the project actually is.

## What this system is

A payment-verification platform for Bangladesh that confirms bKash / Nagad / Upay payments **without
any merchant API**, by reading the payment-confirmation SMS on the merchant's own Android phone and
matching it against orders their website registered as pending. Three components: an Android app
(licensed to clients), a central API + admin dashboard (single administrator, no public signup), and a
documented REST API that client websites integrate with.

The platform never moves money. It asserts only: *"a credit SMS consistent with this order was
received on the registered device."* That framing is a deliberate liability boundary
(`architecture.md §17.4`) — keep it in client-facing text.

## Architecture: the parts that span multiple files

**The money path** — every feature exists to serve this chain:
```
client website POST /payments/register   →  payment_requests (PENDING)
merchant phone captures SMS              →  POST /sms/upload
server re-parses SMS (authoritative)     →  sms_logs
matching engine (exact, then heuristic)  →  verified_transactions
                                         →  webhook_events → signed POST to client
```

**Three trust boundaries, three separate credentials** (`architecture.md §3.1`, ADR-4). This is the
single most important design fact:
- **Device token** (`pdt_`) — the Android app. Can *only* upload SMS, heartbeat, read config. Cannot
  register orders or read any order data. The APK is decompilable, so it must hold nothing more.
- **Server key** (`psk_live_`) — the client's backend. Registers/reads its own orders. Never in a
  browser or app.
- **Admin JWT + TOTP** — the dashboard. Full access, every mutation audited.

**Server-side re-parse is authoritative** (ADR-5). The device sends `raw_message` plus a
`parsed_hint`; the hint is recorded and compared for monitoring but *provably cannot* influence the
stored extraction or a verification. Parser rules are versioned **data** (`packages/parsers/rules/*.json`,
served to devices via `/device/config`), so adding a provider or fixing a regex needs no app release.

**Two processes, one codebase**: `apps/api` (HTTP) and `apps/api/src/workers/main.ts` (BullMQ
processors — webhooks, rescans, expiry, invariants, purges). Anything retried, delayed, or scheduled
belongs in the worker, not in an HTTP request.

**Correctness lives in the database, not in application logic** (`architecture.md §14`).
`verified_transactions` has UNIQUE on *both* `payment_request_id` and `sms_log_id`; a partial unique
index stops two live orders claiming one TrxID. Application logic is the optimisation; these
constraints are the guarantee.

Planned repo layout is in `architecture.md §4` — a pnpm monorepo (`apps/api`, `apps/admin`,
`apps/android`, `packages/shared`, `packages/parsers`, `infra/`, `docs/`). Consult it rather than
inventing a structure.

## Commands

Nothing runs yet. These are the commands the workplan specifies; they become real as tasks land
(`workplan/01` for tooling, `workplan/02` for Prisma, `workplan/13` for Android):

```bash
pnpm i                                   # workspace install
pnpm dev:infra                           # Postgres :5433 + Redis :6380 (infra/docker-compose.dev.yml)
pnpm lint  pnpm typecheck  pnpm test     # the three gates CI runs
pnpm --filter api prisma migrate dev --name <verb_object>
pnpm --filter api prisma db seed
pnpm --filter api openapi:generate       # writes docs/openapi.yaml (contract of record)
pnpm --filter parsers export:android     # regenerates the Android rule/fixture artifacts

# single test
pnpm vitest run path/to/file.spec.ts -t "test name"
cd apps/android && ./gradlew testDebugUnitTest --tests "*ParserParityTest*"
```

Integration tests use Testcontainers (real Postgres + Redis), so Docker must be running.

## Non-negotiable rules

These cross many files and are the ones most likely to be broken by a well-intentioned change:

1. **Money**: `NUMERIC(14,2)` in Postgres, integer paisa in comparisons, decimal **strings** on the
   wire, `Long` paisa in Kotlin. Never `number`/`Double` arithmetic on an amount, never `toFixed` on a
   float. Everything routes through `packages/shared/money.ts` (or its Kotlin mirror).
2. **Time**: `timestamptz` UTC in storage, ISO-8601 with offset on the wire, `Asia/Dhaka` only at
   presentation. Containers run `TZ=UTC`. Device clocks are untrusted — use the stored
   `clock_skew_seconds`.
3. **One HMAC implementation** (`packages/shared/hmac.ts`), used by the API, the tests, and the
   published client snippets. Signature is `HMAC_SHA256(secret, "{timestamp}.{raw_body}")` over the
   **frozen** `payload_raw`, with a **fresh timestamp per attempt**.
4. **Duplicate uploads return 2xx**, not an error, with the existing `sms_log_id`. If duplicates were
   errors, the app's retry loop would never settle. Same for a safe re-`register` of an identical order.
5. **A heuristic match may never verify an exact-mode order** (one with a `transaction_id`). A
   mistyped TrxID must not consume someone else's payment.
6. **Underpayment beyond tolerance is never auto-verified** — it goes to manual review. Overpayment
   verifies with a flag. Ambiguity always goes to review; guessing is not an option on money.
7. **Debit SMS must never match.** A merchant's phone also receives "Cash Out" / "Send Money"
   messages carrying an amount *and* a TrxID. `direction: CREDIT` + `must_not_contain` guards are a
   correctness control, not a nicety.
8. **The SMS address allowlist is the privacy architecture.** On-device, a message from a
   non-provider address is dropped before anything is stored or logged. Exact match, fails closed.
9. **Never reimplement a normaliser.** TrxID/MSISDN/amount normalisation is imported from
   `packages/parsers`; a second copy in the payments path is a silent matching failure.
10. **No raw `process.env`** outside `apps/api/src/config`; **no `Date.now()`/randomness** inside
    `packages/parsers` (parsers are pure functions of their inputs). Both are ESLint-enforced.
11. **`rawBody: true`** on the Nest app — signature verification and idempotency hashing need the
    unparsed body.
12. **Guards are default-deny**: a route without an explicit audience decorator must fail closed.

## Working conventions

- One branch and PR per task: `task/NN-slug`. PR body pastes that task's acceptance criteria as a
  checklist; update the progress table in `workplan/README.md §5` in the same PR.
- The Definition of Done in `workplan/README.md §4` applies to every task on top of its own criteria
  (lint/typecheck/test green, `docs/openapi.yaml` regenerated, no `TODO`/`any`/silent `catch` on the
  money path, secrets never logged).
- **Migrations**: expand → migrate → contract; review the generated SQL, not just the schema diff.
  Never a destructive change to a money table in one release.
- **If you change an architectural decision, update `architecture.md`** (the ADR table in §2) in the
  same PR. The workplan cites architecture sections by number; silent drift between them is the main
  way this project could lose its map.
- Tasks leave deliberate **no-op hooks** for later tasks (e.g. `matching.hook.ts` in Task 06,
  the reverse-match hook in Task 07). These return real values rather than throwing, so earlier tests
  stay valid — replace the implementation, don't change the contract.
- `docs/openapi.yaml` is the contract of record; the Android app and dashboard are generated/built
  against it, and CI fails on breaking changes.

## Domain glossary

- **bKash / Nagad / Upay** — Bangladeshi mobile-money providers. No merchant API is used.
- **TrxID** — provider transaction id in the SMS (e.g. `8A7BCD1234`); the exact-match key.
- **MSISDN** — phone number, normalised to `+8801XXXXXXXXX`.
- **Company** — a client business (tenant). **Device** — one merchant phone. **Client website** — the
  company's server that registers orders and receives webhooks.
- **Exact vs heuristic mode** — whether the order carried a `transaction_id` at registration. Heuristic
  matching (amount + time window + sender) is the fallback and is deliberately conservative.
- **`match_attempts`** — the decision trace: every matching attempt, including non-matches, so the
  dashboard can answer "why wasn't this verified?" in one screen.

## Non-obvious constraints

- **Google Play cannot distribute this app.** `READ_SMS`/`RECEIVE_SMS` are restricted permissions
  granted essentially only to default SMS handlers. Distribution is a direct signed APK with an in-app
  update channel (`architecture.md §17.1`, `workplan/15`). Don't propose a Play submission.
- **OEM battery killers are the top reliability risk.** Correctness must never depend on the
  `SMS_RECEIVED` broadcast arriving — the inbox reconcile scan and Manual Sync are the guarantee, the
  broadcast is an optimisation.
- **Windows dev, Linux prod.** `.gitattributes` enforces LF; a CRLF in a shell script fails on the VPS.
- **Two unrecoverable secrets**: the Android release keystore (lose it and no merchant can ever update)
  and `KEY_ENCRYPTION_KEY` (webhook secrets and TOTP secrets are encrypted, not hashed).
- **Parser rules are provisional** until a real SMS corpus arrives from the pilot merchant
  (`architecture.md §20.2`). Fixtures are CI-gating; the generated Android rule/fixture artifacts must
  stay byte-identical to `packages/parsers` output.

## Explicitly out of scope for v1

Multiple phones per company (schema supports it, UI doesn't), merchant-facing dashboard, PHP/Node SDKs,
WooCommerce plugin, fraud-rules engine, OCR capture, WhatsApp notifications, Postgres RLS, HA/multi-node.
See `architecture.md §19`. Client integration for v1 is documented REST + OpenAPI + copy-paste
signature snippets only.
