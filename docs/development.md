# Development setup

payment-sync is a pnpm monorepo (`apps/*`, `packages/*`, `infra/`, `docs/`). This page gets you from
a fresh clone to a green test run.

## Prerequisites

- **Node 22 LTS** (see `.nvmrc`). With `nvm`: `nvm use`.
- **pnpm 9** — activate via corepack, or install globally:
  - `corepack enable && corepack prepare pnpm@9 --activate`, or
  - `npm i -g pnpm@9`.
- **Docker** for the local datastores and integration tests (Postgres 16 + Redis 7).
  - On Windows, run the Docker daemon under **WSL2** rather than Docker Desktop if that is your policy;
    the compose files are daemon-agnostic.

## First run

```bash
pnpm i                      # install the workspace
cp infra/.env.example .env  # dev defaults match the compose ports
pnpm dev:infra              # Postgres :5433 + Redis :6380 (skip if you run datastores another way)
pnpm test                   # unit tests (no datastores needed for packages/*)
```

The three gates CI runs, and that must pass before any PR merges:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## Layout

| Path               | Contents                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `packages/shared`  | Money, time, ids, HMAC signing, error codes, enums, DTO types. The money-path primitives. |
| `packages/parsers` | SMS parser rule format + reference implementation + fixtures (filled in Task 05).         |
| `packages/config`  | Shared tsconfig / ESLint / Prettier / Vitest config.                                      |
| `apps/api`         | NestJS API + BullMQ workers (Task 02+).                                                   |
| `apps/admin`       | Next.js admin dashboard (Task 11+).                                                       |
| `apps/android`     | Kotlin app (Task 13+).                                                                    |
| `infra/`           | Docker compose, Caddy, backups.                                                           |

## Conventions that bite if ignored

- **Line endings are LF** (`.gitattributes`). The repo is developed on Windows and deployed on Linux;
  a CRLF in a shell script fails on the VPS.
- **Money never uses float math.** Everything routes through `packages/shared` `Money`. ESLint blocks
  `parseFloat`/`Number()` on amount identifiers.
- **Parsers are pure.** No `Date.now()` / `new Date()` / `Math.random()` in `packages/parsers` (ESLint
  enforced) — inject `now`.
- **No raw `process.env`** outside `apps/*/src/config` (ESLint enforced).

## Windows notes

- Use WSL2 for Docker if that is your setup; keep the working tree on a fast disk.
- Git is configured for LF via `.gitattributes`; do not override `core.autocrlf` to `true`.
- Commit hooks (husky) run `lint-staged` + `commitlint`; conventional commit messages are required.
