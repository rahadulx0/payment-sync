# Task 03 — API Core & Auth Primitives

| | |
|---|---|
| **Track** | Core |
| **Depends on** | 02 |
| **Unblocks** | 04, 05, 07, 11 (dashboard client), 16 (thin deploy slice) |
| **Est. effort** | 4–5 days |
| **Risk** | Medium — the three-audience auth model (`architecture.md ADR-4`) must be right before any endpoint ships |

---

## 1. Objective

Bootstrap the NestJS application with every cross-cutting concern in place — validated config,
structured logging with request IDs, the error envelope, rate limiting, idempotency, tenant scoping,
and the **three separate authentication guards** — so that feature modules in Tasks 04–10 contain
only business logic.

After this task the API serves `/healthz`, `/readyz`, `/metrics`, and one protected probe endpoint per
audience, with the full auth matrix tested.

---

## 2. Scope of work

### In scope
- NestJS bootstrap, module layout per `architecture.md §4`, graceful shutdown.
- Zod-validated config module; no raw `process.env` outside it.
- Pino logging with `request_id` via `AsyncLocalStorage`; secret redaction.
- Global validation pipe, error envelope + exception filter, standard error codes.
- `PrismaModule` (with `$extends` for tenant scoping), `RedisModule`, `BullModule` registration.
- `CredentialService` (Argon2id hash/verify, prefix lookup, constant-time behaviour).
- Guards: `AdminJwtGuard`, `ServerKeyGuard`, `DeviceTokenGuard` + `@Scopes()` decorator.
- `CompanyContext` request scope + repository-level tenant enforcement.
- Rate-limit guard (Redis sliding window, per company / per device / per IP).
- Idempotency interceptor + store.
- Health/readiness/metrics endpoints; OpenAPI generation to `docs/openapi.yaml`.
- Helmet, CORS, body limits, HTTP timeouts.
- Worker process bootstrap (`apps/api/src/workers/main.ts`) — empty processors registered.

### Out of scope
- Issuing credentials (admin/company/key CRUD) → Task 04. This task only **verifies** credentials,
  tested against Task 02's seeded keys.
- Any device/payment/webhook business logic → Tasks 06–10.

---

## 3. Prerequisites

- Task 02: migrations + seed + Testcontainers harness + factories.
- Task 01: `packages/shared` (errors, enums, ids, DTOs).
- Decision confirmed: device token vs server key separation (`architecture.md ADR-4`).

---

## 4. Implementation steps

### 4.1 Bootstrap
1. `apps/api/src/main.ts`: Nest factory with `bufferLogs`, `app.enableShutdownHooks()`,
   `rawBody: true` (**required** — webhook signature verification and idempotency hashing need the
   unparsed body; retrofitting this later is painful), global prefix `/api/v1` with health routes
   excluded, `PORT` from config.
2. `app.module.ts` wiring: Config, Logger, Prisma, Redis, Bull, Health, and a `ProbeModule` used
   only to test the guards (removed or kept as an authenticated `/whoami` per audience).
3. `apps/api/src/workers/main.ts`: separate entrypoint that loads only queue processors — no HTTP
   server. Same config/logging/Prisma modules. Proves the two-process model (`architecture.md §16.1`)
   from day one rather than discovering it at deploy time.

### 4.2 Config (`src/config/`)
- Zod schema for every variable in `workplan/README.md §7`, with `.default()` only where a default is
  genuinely safe. Fail fast at boot with a readable aggregated error listing all missing keys.
- Typed `ConfigService` wrapper (`config.get('jwt.accessSecret')`), namespaced sub-configs
  (`db`, `redis`, `jwt`, `crypto`, `rateLimit`, `webhook`, `admin`, `alerts`).
- `KEY_ENCRYPTION_KEY` validated as 32 bytes base64; refuses to boot in production with a dev value.
- `CryptoService`: AES-256-GCM envelope encrypt/decrypt (`{v, iv, tag, ct}` blob) for
  `webhook_secret_enc` and `totp_secret_enc`, with a `key_version` byte for future rotation.

### 4.3 Logging & request context
- `nestjs-pino` with: `genReqId` → `X-Request-Id` header or new uuidv7; `AsyncLocalStorage`-backed
  `RequestContext` carrying `request_id`, `company_id`, `device_id`, `admin_id`, `route`.
- Redaction paths (fail-closed list): `req.headers.authorization`, `req.headers.cookie`,
  `*.api_key`, `*.device_token`, `*.password`, `*.totp`, `*.webhook_secret`, `*.raw_message`,
  `*.signature`. A unit test greps serialized output for known secret values.
- Every response carries `X-Request-Id`; every error envelope includes it (`architecture.md §7.1`).
- `logger.money(event, ctx)` helper for the four money-path events so they are consistently
  structured for Task 16's metrics and alerts.

### 4.4 Error handling
- `AllExceptionsFilter`: maps `AppError` → its code/status, `ZodError`/`ValidationError` →
  `VALIDATION_ERROR` with field details, Prisma known errors (`P2002` → the right domain code, e.g.
  `DUPLICATE_ORDER_ID`), everything else → `INTERNAL_ERROR` with the stack logged and **never** returned.
- Global `ValidationPipe({whitelist: true, forbidNonWhitelisted: true, transform: true})`.
- `docs/error-codes.md` generated from the `ErrorCode` union — published to clients in Task 17.

### 4.5 Credentials & guards
1. **`CredentialService`**
   - `hash(plain)` / `verify(plain, hash)` using Argon2id (m=19456 KiB, t=2, p=1).
   - `issue(type)` → `{plaintext, prefix, hash}` using `randomToken(32)` + typed prefix.
   - `findByPlaintext(plain)`: parse prefix → indexed lookup on `api_keys.prefix` → Argon2 verify.
     On miss, still perform a dummy verify so timing doesn't distinguish "unknown key" from
     "wrong key".
   - Updates `last_used_at`/`last_used_ip` asynchronously (fire-and-forget, never blocking the request).
2. **`AuthAttemptService`** — writes every credential presentation to `auth_attempts`
   (`outcome`, `reason`, IP, UA, subject) and increments Redis counters for lockout/alerting.
   Satisfies `plan.md §12` "log all authentication attempts".
3. **`ServerKeyGuard`** — `Authorization: Bearer psk_live_…` + `X-Company-Id`; asserts key type
   `SERVER`, not revoked/expired, company `ACTIVE` (else `COMPANY_SUSPENDED`), header company matches
   the key's company (else `UNAUTHENTICATED` — never leak which part was wrong), required scopes
   present. Populates `CompanyContext`.
4. **`DeviceTokenGuard`** — `Authorization: Bearer <device_token>` + `X-Install-Id`; looks up device
   by `install_id`, verifies `token_hash`, asserts device `ACTIVE` (`DEVICE_BLOCKED`) and company
   `ACTIVE`; scopes limited to `sms:upload`, `device:heartbeat`, `config:read`. Populates
   `CompanyContext` + `DeviceContext`.
5. **`AdminJwtGuard`** — verifies the 15-minute access JWT (issuance in Task 04), asserts
   `totp_verified: true` in the claims, checks `ADMIN_IP_ALLOWLIST` when set. Populates `AdminContext`.
6. **`@Scopes('payments:write')`** decorator + `ScopesGuard`; a `@Public()` decorator for health.
7. Guards are **opt-out, not opt-in**: a global default-deny guard rejects any route without an
   explicit audience decorator, so a forgotten decorator fails closed. Test asserts this.

### 4.6 Tenant isolation
- `PrismaService` with a `$extends` client factory `forCompany(companyId)` that injects
  `where: { company_id }` on every `findMany/findFirst/update/delete` for tenant tables and stamps
  `company_id` on `create`.
- Feature repositories in later tasks receive the scoped client from `CompanyContext` — they cannot
  see another tenant even with a bug in a `where` clause.
- Admin queries use the unscoped client explicitly via `prisma.unsafeGlobal()` (deliberately
  awkward name; ESLint restricts its use to `modules/admin/**`).
- Tests: for each tenant table, a cross-tenant read/update attempt returns empty/404.

### 4.7 Rate limiting
- Redis sliding-window (`INCR` + `PEXPIRE`, or a small Lua script for atomicity) keyed by
  `rl:{scope}:{subject}:{window}`.
- `@RateLimit({points, windowSec, by: 'company'|'device'|'ip'|'company+route'})`.
- Defaults from `architecture.md §7.1`: upload 120/min/device, register 120/min/company (overridable
  per company via `company_settings.rate_limit_register_rpm`), device register 5/hour/company,
  admin login 10/hour/IP.
- Responses: `429 RATE_LIMITED` + `Retry-After` + `X-RateLimit-{Limit,Remaining,Reset}`.
- Fail-open on Redis outage for tenant reads, **fail-closed for admin login** (a test covers both).

### 4.8 Idempotency
- `@Idempotent({endpoint: 'payments.register', ttlHours: 24})` interceptor:
  1. No `Idempotency-Key` header → pass through (natural keys still protect `register`).
  2. Insert `idempotency_keys` row `IN_FLIGHT` with `request_hash = sha256(rawBody)`.
  3. Unique violation → load the existing row:
     - `COMPLETED` + same hash → replay stored status/body with `Idempotency-Replayed: true`.
     - `COMPLETED` + different hash → `409 IDEMPOTENCY_KEY_REUSED`.
     - `IN_FLIGHT` → `409 REQUEST_IN_PROGRESS` (client retries).
  4. On success, store status + body and mark `COMPLETED`; on 5xx, delete the row so a retry can work.
- Expired rows purged by a Task 16 job.

### 4.9 Health, readiness, metrics
- `GET /healthz` — liveness only (process up), no dependency checks.
- `GET /readyz` — Postgres `SELECT 1`, Redis `PING`, pending-migration check; 503 with per-dependency
  detail. Used by Caddy/compose healthchecks in Task 16.
- `GET /metrics` — `prom-client` default metrics + custom registry; guarded by
  `METRICS_TOKEN` or bound to the internal network. Custom counters/histograms are *declared* here
  (empty) and incremented by later tasks, so Task 16 has stable names to alert on.
- `GET /version` — git SHA, build time, migration version (public, useful for support).

### 4.10 OpenAPI
- `@nestjs/swagger` with DTO decorators; a `pnpm --filter api openapi:generate` script writes
  `docs/openapi.yaml` (deterministic key order so diffs are readable).
- CI: `redocly lint` + `oasdiff breaking` against `main`'s version; breaking changes require an
  explicit `BREAKING-API-CHANGE` label. This is what keeps Android/dashboard from drifting.
- Swagger UI served at `/docs` only when `NODE_ENV !== 'production'` or behind admin auth.

### 4.11 HTTP hardening
Helmet; CORS allowing only `ADMIN_ORIGIN` with credentials (tenant APIs are server-to-server, no CORS);
`json({limit: '256kb'})`; server timeouts (`requestTimeout` 30 s, `keepAliveTimeout` 65 s to sit above
Caddy's); `trust proxy` for correct client IPs behind Caddy; compression off (Caddy handles it).

---

## 5. Files created / modified

```
apps/api/src/main.ts  app.module.ts
apps/api/src/config/{config.module.ts,config.schema.ts,config.service.ts,crypto.service.ts}
apps/api/src/common/logging/{logger.module.ts,request-context.ts,redaction.ts,money-logger.ts}
apps/api/src/common/errors/{all-exceptions.filter.ts,prisma-error.map.ts,app-error.ts}
apps/api/src/common/auth/{credential.service.ts,auth-attempt.service.ts,
                          admin-jwt.guard.ts,server-key.guard.ts,device-token.guard.ts,
                          scopes.guard.ts,default-deny.guard.ts,decorators.ts,contexts.ts}
apps/api/src/common/prisma/{prisma.module.ts,prisma.service.ts,tenant-scope.extension.ts}
apps/api/src/common/redis/{redis.module.ts,redis.service.ts}
apps/api/src/common/queue/{queue.module.ts,queue-names.ts}
apps/api/src/common/ratelimit/{rate-limit.guard.ts,rate-limit.decorator.ts,sliding-window.lua}
apps/api/src/common/idempotency/{idempotency.interceptor.ts,idempotency.store.ts}
apps/api/src/common/metrics/{metrics.module.ts,metrics.registry.ts}
apps/api/src/modules/health/{health.module.ts,health.controller.ts}
apps/api/src/modules/probe/probe.controller.ts      # /whoami per audience (guard matrix target)
apps/api/src/workers/main.ts
apps/api/test/e2e/{auth-matrix.e2e-spec.ts,idempotency.e2e-spec.ts,rate-limit.e2e-spec.ts,
                   tenant-isolation.e2e-spec.ts,health.e2e-spec.ts}
docs/openapi.yaml  docs/error-codes.md
.github/workflows/ci.yml            # + openapi lint/breaking-change jobs
infra/.env.example                  # + new keys
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Auth matrix** (the key test) | 3 credentials × 4 route types = a table-driven suite. Must assert: device token on `/payments/register` → 403; server key on `/sms/upload` → 403; admin JWT without `totp_verified` → 401; revoked key → 401; key of company A with `X-Company-Id: B` → 401; suspended company → 403 `COMPANY_SUSPENDED`; blocked device → 403 `DEVICE_BLOCKED`; missing header → 401; malformed prefix → 401 without a DB query. |
| Default-deny | A deliberately undecorated test route returns 401/403, not 200. |
| Tenant isolation | For every tenant table: company A's scoped client cannot read/update/delete company B's rows; `create` cannot override `company_id`. |
| Idempotency | Same key + same body → identical response + `Idempotency-Replayed`; same key + different body → 409; concurrent duplicates (two parallel requests) → one 2xx + one `REQUEST_IN_PROGRESS`; 5xx allows a later retry. |
| Rate limit | Burst past the limit → 429 with correct `Retry-After`; window rolls; per-company isolation (A's burst doesn't throttle B); Redis down → tenant reads pass, admin login refuses. |
| Credential timing | 200 verifications of unknown vs wrong-secret keys; assert median difference under a documented threshold (guards against user-enumeration by timing). |
| Redaction | Log capture contains no Bearer token, no API key, no `raw_message`. |
| Config | Boot with a missing var → readable aggregated error, non-zero exit; dev `KEY_ENCRYPTION_KEY` in production → refuses to boot. |
| Crypto | `decrypt(encrypt(x)) === x`; tampered ciphertext/tag → throws; encrypted blob shape stable. |
| Health | `/readyz` 503 when Postgres is stopped mid-test (compose stop), recovers when back. |
| Worker process | `workers/main.ts` boots, connects to Redis, exposes no HTTP port. |
| OpenAPI | Generated file lints clean; a deliberate breaking change is caught by `oasdiff` in CI. |

**Smoke demo:** boot API + worker; `curl /healthz`, `/readyz`, `/version`; `curl /api/v1/probe/whoami`
with each of the three seeded credentials showing the correct resolved context; show a 429 from a
`for` loop; show `docs/openapi.yaml` regenerating with no diff.

---

## 7. Acceptance criteria

- [ ] API and worker boot as separate processes from validated config; missing/invalid config fails fast.
- [ ] The full auth matrix passes, including every negative case in §6.
- [ ] Default-deny is proven: an undecorated route is not publicly reachable.
- [ ] Tenant scoping enforced at the Prisma-client layer; cross-tenant access impossible in tests; unscoped access restricted to `modules/admin/**` by lint rule.
- [ ] Idempotency interceptor handles replay, conflict, in-flight, and 5xx-retry cases.
- [ ] Rate limiting works per company/device/IP with correct headers; documented fail-open/fail-closed behaviour tested.
- [ ] Every response and error carries `X-Request-Id`; logs are structured and contain no secrets.
- [ ] `/healthz`, `/readyz`, `/metrics`, `/version` behave as specified; `/metrics` protected.
- [ ] `docs/openapi.yaml` generated deterministically; lint + breaking-change checks wired into CI.
- [ ] `docs/error-codes.md` covers every `ErrorCode` with meaning and expected client action.
- [ ] Argon2 parameters documented in `architecture.md §13.2`; verification cost measured (<150 ms) and recorded.

---

## 8. Risks & notes

- **`rawBody: true` and the guard default-deny are both "cheap now, expensive later".** Both are
  trivial here and invasive to retrofit once 30 endpoints exist.
- Argon2id verification is intentionally slow, and it runs on **every** device upload. Measure it:
  if p95 auth cost is material at 50 req/s, add a short-TTL Redis cache of
  `sha256(token) → {device_id, company_id}` (5 min) — but only with an explicit invalidation path on
  revoke/block, and never for admin login. Note the decision either way in `architecture.md`.
- The `probe` controller exists so the auth matrix can be tested before any feature endpoint exists.
  Keep `/whoami` (it is genuinely useful for client support) but ensure it leaks nothing beyond the
  caller's own identity.
- Metric names declared here become the alerting contract in Task 16 — renaming them later breaks
  dashboards, so use the names from `architecture.md §15.2` verbatim.
