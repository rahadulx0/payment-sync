# Task 01 — Foundation & Developer Environment

| | |
|---|---|
| **Track** | Core |
| **Depends on** | — |
| **Unblocks** | 02 (and therefore everything) |
| **Est. effort** | 2–3 days |
| **Risk** | Low — but shortcuts here (no money type, no shared HMAC) cause rework in Tasks 08/09 |

---

## 1. Objective

Stand up the monorepo skeleton, the local dev stack, and the **shared primitives that the money path
depends on** (money type, HMAC signing, error codes, provider enums, time helpers), so that every
later task writes application logic instead of re-deciding fundamentals.

A developer clones the repo, runs three commands, and has a working environment with green CI.

---

## 2. Scope of work

### In scope
- pnpm workspace monorepo with the folder layout from `architecture.md §4`.
- Shared tooling package: TypeScript config, ESLint, Prettier, Vitest base config.
- `packages/shared`: money, time, ids, HMAC signing/verification, error codes, enums, DTO types.
- `packages/parsers` package shell (rule *types* only; rules and fixtures land in Task 05).
- `infra/docker-compose.dev.yml` (Postgres 16 + Redis 7 only) and `infra/.env.example`.
- GitHub Actions CI skeleton: install → lint → typecheck → test → secret scan.
- Repo hygiene: `.gitignore`, `.editorconfig`, `.nvmrc`, commit hooks, PR template, CODEOWNERS.
- Initial commit (repo currently has no commits).

### Out of scope
- Prisma schema → Task 02. NestJS app → Task 03. Parser rules/fixtures → Task 05.
- Production compose / deploy pipeline → Task 16. Android Gradle project → Task 13.

---

## 3. Prerequisites

- Node 22 LTS + pnpm 9 installed; Docker Desktop running.
- Decision on package scope name (assumed `@paysync/*`).
- Nothing else — this is the entry point.

---

## 4. Implementation steps

### 4.1 Workspace bootstrap
1. `git init` is already done; create the first commit with `plan.md`, `architecture.md`, `workplan/`.
2. Root `package.json` (private, `packageManager: pnpm@9`) with scripts:
   `lint`, `lint:fix`, `typecheck`, `test`, `test:watch`, `format`, `build`,
   `dev:infra` (compose up), `dev:infra:down`, `openapi:lint`.
3. `pnpm-workspace.yaml` covering `apps/*` and `packages/*`.
4. `.nvmrc` (`22`), `.editorconfig` (LF, 2-space, UTF-8), `.gitattributes` (`* text=auto eol=lf` —
   the repo is developed on Windows and deployed on Linux; CRLF in shell scripts breaks the VPS).

### 4.2 `packages/config` — shared tooling
1. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `target ES2023`, `module NodeNext`, `isolatedModules`, no `any` escape hatches.
2. ESLint flat config: `@typescript-eslint` strict-type-checked + import ordering, plus three
   **custom-enforced bans** (as `no-restricted-syntax` rules with clear messages):
   - `parseFloat` / `Number(` on anything named `amount*` — money must go through `Money`.
   - `Date.now()` inside `packages/parsers` (parsers must be pure functions of their inputs).
   - direct `process.env` access outside `apps/*/src/config` — env goes through validated config.
3. Prettier config; Vitest base config with coverage thresholds (start at 70% global,
   **95% for `packages/shared/src/money` and `.../hmac`**).

### 4.3 `packages/shared` — the primitives
1. **`money.ts`** — the single money abstraction.
   - `Money` = branded integer paisa. `Money.fromDecimalString('1,250.00')` (tolerates thousands
     separators, `Tk`/`BDT` prefixes, unicode/Bengali digits), `Money.fromPrismaDecimal`,
     `toDecimalString()` (always 2 dp), `equals`, `compare`, `absDiff`, `isWithinTolerance`.
   - Throws `MoneyParseError` on ambiguity; **never** silently returns 0.
2. **`time.ts`** — `nowUtc()`, `parseProviderTimestamp(raw, formats, tz='Asia/Dhaka')`,
   `toDhaka()`, `clockSkewSeconds(serverNow, deviceNow)`, 2-digit-year pivot rule.
3. **`ids.ts`** — `uuidv7()`, `randomToken(bytes=32)` → base62, `keyPrefix(type)`
   (`psk_live_`, `pde_live_`), `hashSha256(normalised)`.
4. **`hmac.ts`** — the **one** implementation of webhook signing, used by the API, the tests, and the
   published reference snippets:
   - `signWebhook({secret, timestamp, rawBody}) → 't=<ts>,v1=<hex>'`
   - `verifyWebhook({secret, header, rawBody, toleranceSeconds})` with `timingSafeEqual`
     and multi-version (`v1`/`v0`) support for rotation.
5. **`enums.ts`** — `Provider`, `CompanyStatus`, `DeviceStatus`, `ParseStatus`, `MatchStatus`,
   `PaymentStatus`, `MatchMode`, `VerificationMethod`, `WebhookEventType`, `UploadSource`,
   `ReviewReason`, `ReviewStatus`. Single source, mirrored by Prisma enums in Task 02
   (a test asserts the two lists are identical).
6. **`errors.ts`** — `ErrorCode` union (the exact list in `architecture.md §7.1`),
   `AppError` base with `code`/`httpStatus`/`details`, and the `ErrorEnvelope` type.
7. **`dto/`** — request/response types for every public endpoint, written now as the contract
   Tasks 06/07 implement and Task 13's Kotlin DTOs mirror.
8. Barrel `index.ts` with explicit exports (no `export *`).

### 4.4 `packages/parsers` shell
- Zod schema + TS types for the rule format (`architecture.md §8.2`), `fixtures/` and `rules/`
  directories with `.gitkeep`, and a failing placeholder test so Task 05 has a target.

### 4.5 Local dev stack
1. `infra/docker-compose.dev.yml`: `postgres:16-alpine` (port 5433 to avoid clashing with a local
   install, named volume, `TZ=UTC`, healthcheck) and `redis:7-alpine` (port 6380, AOF on).
2. `infra/.env.example` documenting every variable from `workplan/README.md §7`, with safe dev
   defaults and one-line comments.
3. `docs/development.md`: clone → `pnpm i` → `pnpm dev:infra` → `cp infra/.env.example .env` →
   `pnpm test`. Include Windows-specific notes (Docker Desktop WSL2 backend, line endings).

### 4.6 CI skeleton (`.github/workflows/ci.yml`)
- Triggers: PR + push to `main`. Node 22, pnpm cache.
- Jobs: `install` → `lint`, `typecheck`, `test` (matrix-free, fail fast), `gitleaks`.
- Concurrency group cancels superseded runs. Required-status-check on `main` (documented; enabling
  requires the GitHub setting).

### 4.7 Hygiene
- Husky + lint-staged: `eslint --fix` + `prettier` on staged files; `commitlint` on message.
- `.github/pull_request_template.md` with the global Definition of Done checklist from
  `workplan/README.md §4`.
- `.gitignore`: `node_modules`, `dist`, `.env*` (except `.example`), `coverage`, `*.local`,
  Android build outputs, `.idea`, `.gradle`, keystores (`*.jks`, `*.keystore`).

---

## 5. Files created / modified

```
package.json  pnpm-workspace.yaml  .nvmrc  .editorconfig  .gitattributes  .gitignore
.github/workflows/ci.yml  .github/pull_request_template.md  .github/CODEOWNERS
commitlint.config.js  .husky/{pre-commit,commit-msg}
packages/config/{package.json,tsconfig.base.json,eslint.config.js,prettier.config.js,vitest.base.ts}
packages/shared/package.json
packages/shared/src/{index.ts,money.ts,time.ts,ids.ts,hmac.ts,enums.ts,errors.ts}
packages/shared/src/dto/{device.ts,payments.ts,webhooks.ts,admin.ts,common.ts}
packages/shared/test/{money.spec.ts,hmac.spec.ts,time.spec.ts}
packages/parsers/{package.json,src/types.ts,src/index.ts,rules/.gitkeep,fixtures/.gitkeep}
infra/docker-compose.dev.yml  infra/.env.example
docs/development.md
```

---

## 6. Testing & validation

| What | How |
|---|---|
| Money correctness | Table-driven: `'1,250.00'`, `'1250'`, `'Tk 1,250.00'`, `'১২৫০.৫০'` (Bengali digits), `'0.01'`, `'99999999999.99'`, `'1.005'`, `''`, `'abc'`, `'-5'`. Assert exact paisa or a thrown `MoneyParseError`. Property test: `fromDecimalString(toDecimalString(m)) === m`. |
| HMAC | Golden vectors committed as JSON (fixed secret/timestamp/body → expected hex) — these same vectors are published in Task 17 and executed against the PHP/Node/Python snippets. Assert tolerance rejection, tampered-body rejection, `v0` fallback, constant-time path. |
| Time | Dhaka offset (+06, no DST), `dd/MM/yyyy HH:mm` and `dd/MM/yy HH:mm` parsing, 2-digit-year pivot, skew sign convention (`server − device`). |
| Enum parity | Placeholder test skipped until Task 02, then asserts shared enums ≡ Prisma enums. |
| Env docs | Test reads `infra/.env.example` and asserts every key listed in `workplan/README.md §7` is present (keeps docs honest as config grows). |
| CI | Open a scratch PR; confirm all jobs run and a deliberate lint error fails the build. |

**Smoke demo:** fresh clone on a second machine (or a clean container) → `pnpm i` → `pnpm dev:infra`
→ `pnpm test` all green, with no manual steps beyond copying `.env.example`.

---

## 7. Acceptance criteria

- [ ] `pnpm i && pnpm lint && pnpm typecheck && pnpm test` green from a clean clone.
- [ ] `pnpm dev:infra` brings up Postgres (5433) and Redis (6380), both healthy; `dev:infra:down` cleans up.
- [ ] `packages/shared` exports Money, time, ids, HMAC, enums, errors, DTOs; coverage ≥95% on money and hmac.
- [ ] HMAC golden vectors committed at `packages/shared/test/fixtures/webhook-signatures.json`.
- [ ] ESLint fails on: `parseFloat` near an `amount` identifier, `Date.now()` in `packages/parsers`, bare `process.env` outside config.
- [ ] CI runs on PR with lint + typecheck + test + gitleaks, and a deliberate error fails it.
- [ ] `infra/.env.example` documents every variable in `workplan/README.md §7`; env-doc test passes.
- [ ] `docs/development.md` verified by someone following it on a clean machine.
- [ ] First commit exists on `main`; no secrets committed (gitleaks clean).

---

## 8. Risks & notes

- **The money type is the highest-leverage thing in this task.** Every later amount comparison
  routes through it. Getting Bengali digits and thousands separators right here prevents a class of
  parser bugs in Task 05 that would otherwise be invisible until a real merchant lost a sale.
- **One HMAC implementation, three consumers** (API, tests, published snippets). Duplicating it in
  Task 09 is the most likely source of "signature mismatch" support pain — the golden vectors exist
  to make divergence impossible.
- Windows dev / Linux prod: `.gitattributes` + LF-only is not cosmetic. A CRLF in
  `infra/backup/pg_backup.sh` (Task 16) fails on the VPS with an unhelpful error.
