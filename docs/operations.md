# Operations

How the platform is deployed, watched, and recovered by **one person**. Companion to
`docs/runbook.md` (procedures) — this file is the map.

## The stack (single VPS, deliberately — ADR-10)

```
              ┌─────────── Caddy (only 80/443 exposed, automatic TLS) ───────────┐
              │                                                                   │
   api.<domain> → api-1, api-2 (health-checked, drained one at a time)   admin.<domain> → admin
                                    │                                                     │
                              worker (BullMQ)                                             │
                                    └──────────── postgres · redis (internal only) ───────┘
```

Two API replicas exist for one reason: Caddy can drain one during a deploy, which is what makes a
rolling restart zero-downtime. Everything except Caddy is on the internal Docker network — Postgres and
Redis are never reachable from outside.

**Redis is not a source of truth.** AOF is for restart durability only. Losing Redis loses in-flight
queue state, which the DB-driven sweepers (Tasks 08/09) then recover — a claim the restore drill
verifies rather than assumes.

## Deploying

CI on `main` → build images tagged with the git SHA → push to GHCR → SSH deploy. The deploy has three
guarded failure paths:

1. **Migration fails** → deploy aborts, previous version keeps serving.
2. **Health gate fails** → automatic rollback to the previous image tag.
3. **Smoke test fails** → surfaced as a failed workflow.

A pre-deploy `pg_dump` is taken automatically whenever a migration is pending — cheap insurance at this
scale. Migrations follow expand → migrate → contract; review the generated SQL, not just the schema diff.

Rollback by hand: set `IMAGE_TAG` in `/opt/paysync/.env` to the previous SHA and `docker compose up -d`.

## Watching it

Prometheus scrapes api/worker/postgres/redis/node/caddy every 15 s. `/metrics` is internal-only and
token-guarded. Four dashboards, matching how you would actually look at the system:

| Dashboard  | Answers                                                          |
| ---------- | ---------------------------------------------------------------- |
| Money path | Are payments being registered, matched, verified, and delivered? |
| Devices    | Which merchant phones are online, and which are at risk?         |
| Parser     | Is a provider quietly changing its SMS wording?                  |
| Infra      | Is the box healthy?                                              |

## Alerts (architecture §15.3)

| Sev    | Routing                                            | Examples                                                                                          |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **P1** | Telegram + email, repeats every 15 min until acked | API down · Postgres down · **invariant violation** · dead webhook · disk >90% · no backup in 26 h |
| **P2** | Telegram + email                                   | Devices offline in business hours · webhook success <90% · queue backlog · review past SLA        |
| **P3** | Email digest                                       | Parse-failure rate >5% · >10 open reviews · matching conflicts                                    |

Two design rules keep alerts readable for a single operator:

- **Business-hours windowing** on device-offline (09:00–23:00 Asia/Dhaka). Without it you are paged
  every night when the shops close, and within two weeks you stop reading alerts entirely.
- **Grouping**: ten offline devices produce one message, not ten. Recovery notices fire when a
  condition clears, so an alert that never resolves is itself visible.

Device-offline alerting also notifies the **company contact** — a merchant should learn their phone is
down before their customer complains. That makes it a product feature, not just ops.

## Scheduled jobs

| Job                   | Cadence                                 | Purpose                                                              |
| --------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `invariants`          | 15 min                                  | correctness tripwire → P1                                            |
| `device-health`       | 5 min                                   | offline detection → P2 + notify company                              |
| `retention-purge`     | daily                                   | redact SMS text past retention (§17.3)                               |
| `expire-orders`       | 60 s                                    | PENDING → EXPIRED                                                    |
| `webhook-sweeper`     | 60 s                                    | at-least-once delivery                                               |
| `rescan-unmatched`    | 15 min                                  | recover unmatched SMS                                                |
| `analytics-rollup`    | hourly                                  | dashboard aggregates                                                 |
| `cleanup-credentials` | hourly                                  | revoke_at grace · prev webhook secret · idempotency keys             |
| `backup-verify`       | daily (cron → `infra/backup/verify.sh`) | last night's backup exists, is non-trivial, and its checksum matches |

Every job is **idempotent** — a retry, a redeploy, or two worker replicas will run one twice.

## Backups

Nightly `pg_dump -Fc` → `age`-encrypted → object storage, with checksum verification and pruning
(30 daily, 12 monthly). **RPO is 24 h**, accepted deliberately: this platform never moves money, and the
merchant's phone still holds the SMS, so a lost day is re-uploadable via Manual Sync. WAL archiving is
on the roadmap if that calculus changes.

`KEY_ENCRYPTION_KEY` is backed up **separately** from the database — the dump is useless without it,
and storing them together would make one compromise total.

**A backup you have never restored is not a backup**: `infra/backup/restore.sh` runs the drill
(checksum → decrypt → restore → invariants → boot the API → journey test). Quarterly, timed, RTO
recorded in the runbook.

## What is verified vs. what needs the VPS

Verified in CI/local: the maintenance jobs and alert routing (unit + DB integration tests), the retention
semantics, the KEK-rotation safety property, and the syntax of every compose/Caddy/Prometheus/workflow
/shell file.

**Requires a real VPS and is not yet done:** inducing each alert, the timed restore drill, the
zero-downtime deploy measurement under load, TLS grading, and the external port scan. These are
acceptance criteria in `workplan/16` and should be executed before the pilot in Task 17.
