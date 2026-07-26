# Task 16 — Observability, Deployment, CI/CD & Backups

| | |
|---|---|
| **Track** | Ops |
| **Depends on** | 03 for the **thin slice** (deploy early); 10 for the full task |
| **Unblocks** | 17 |
| **Est. effort** | 5–6 days (≈1 day of it pulled forward after Task 03) |
| **Risk** | Medium — the risk is discovering deployment problems late, which is exactly what the pull-forward prevents |

---

## 1. Objective

Make the platform operable by one person: production deployment on a single VPS per
`architecture.md §16`, CI/CD with safe migrations and rollback, the metrics and alerting from
`architecture.md §15`, scheduled maintenance jobs, encrypted offsite backups with a **tested** restore,
and the runbook that ties it together.

The measure of success: a P1 incident at 2am is diagnosable and recoverable from documented procedures,
and a merchant's phone going offline reaches you before the merchant does.

---

## 2. Scope of work

### In scope — thin slice (do this right after Task 03)
- Production `docker-compose.yml`, `Caddyfile`, VPS provisioning script, staging environment.
- CI/CD deploy pipeline with `prisma migrate deploy`, health gate, and rollback.
- Basic uptime check + `/readyz`.

### In scope — full task (after Task 10)
- Prometheus metrics scrape + Grafana dashboards (or Uptime Kuma + Grafana Agent for a lighter stack).
- Alerting: P1/P2/P3 rules from `architecture.md §15.3` to email + Telegram, with grouping and runbook links.
- Log aggregation and retention; Sentry for exceptions with secret scrubbing.
- Scheduled jobs: retention purge, idempotency/key/webhook-secret cleanup, analytics rollup,
  invariant check, device-offline detection, backup verification.
- Encrypted `pg_dump` to object storage with retention, plus a **timed restore drill**.
- Secrets management, firewall, SSH hardening, fail2ban, unattended security upgrades.
- Runbook completion.

### Out of scope
- Multi-node/HA, read replicas, Kubernetes → post-v1 (`architecture.md §19`).
- Application features.

---

## 3. Prerequisites

- A VPS (4 vCPU / 8 GB / NVMe) and a domain with DNS control.
- Task 03 for the thin slice; Tasks 08–10 for the metrics/alerts that matter.
- Object storage bucket (S3/R2) and SMTP credentials + a Telegram bot.

---

## 4. Implementation steps

### 4.1 Thin slice — deploy on day ~10
1. **`infra/docker-compose.yml`** per `architecture.md §16.1`: `caddy`, `api` (×2), `worker`, `admin`,
   `postgres:16`, `redis:7`. Only Caddy publishes ports; everything else is on an internal network.
   Healthchecks on all services (`/readyz` for api, `pg_isready`, `redis-cli ping`), `restart: unless-stopped`,
   memory limits, log rotation (`json-file`, `max-size=50m`, `max-file=5`), `TZ=UTC`.
2. **`infra/Caddyfile`**: automatic TLS for `api.<domain>` and `admin.<domain>`, HSTS, security headers,
   gzip, access logs in JSON, request-body limits, a coarse per-IP rate limit as a first line of defence,
   and an optional IP allowlist block on `admin.<domain>` (`architecture.md §16.1`).
3. **`infra/provision.sh`** (idempotent, documented rather than clever): non-root deploy user, SSH
   key-only with password auth off, UFW (22/80/443 only), fail2ban, `unattended-upgrades`,
   Docker + compose plugin, swap file, `vm.overcommit`/`somaxconn` tuning for Redis/Postgres, timezone UTC.
4. **Staging**: a second compose project on the same VPS (`-p paysync-staging`, separate volumes,
   `staging-api.<domain>`, its own DB/Redis, `SEED_DEV=true`). Resource-capped so staging can never
   starve production.
5. **CI/CD** (`.github/workflows/deploy.yml`): on `main` → build multi-stage images (distroless or
   alpine, non-root user, pinned base digests) → push to GHCR → SSH deploy →
   `prisma migrate deploy` → rolling restart of `api` replicas one at a time (Caddy drains) →
   worker restart → `/readyz` + smoke test (`/version`, an authenticated `/whoami`, a register+poll
   round trip against staging data) → on failure, `docker compose up -d` with the previous image tag and
   alert. Deploys tagged with the git SHA; `docs/runbook.md` documents manual rollback.
6. **Migration safety**: `prisma migrate deploy` runs as a one-shot container before the app rollout,
   with a `--dry-run`-style diff printed in the PR. Expand→migrate→contract is enforced by review, and
   a pre-deploy `pg_dump` is taken automatically when a migration is present (cheap insurance at this scale).

### 4.2 Metrics & dashboards
1. `prom-client` registry from Task 03, now populated by Tasks 05–10 (`architecture.md §15.2`).
   `/metrics` reachable only on the internal network (or token-guarded).
2. Prometheus (container, 15 s scrape, 30-day retention) scraping api, worker, `postgres_exporter`,
   `redis_exporter`, `cadvisor`/node metrics, and Caddy.
3. **Grafana dashboards** — four, matching how you'd actually look at the system:
   - *Money path*: registers, SMS ingested, match outcomes by result, verifications, verification
     latency percentiles, webhook delivery latency, DLQ depth.
   - *Devices*: online/offline over time, per-device queue depth, heartbeat gaps, permission/battery-opt
     states, clock skew distribution.
   - *Parser*: parse success/ignored/failed by provider, hint-mismatch rate, unparsed backlog, rule versions.
   - *Infra*: CPU/memory/disk, Postgres connections + slow queries + table sizes, Redis memory + AOF,
     queue depths + oldest-job age, HTTP RED metrics.
4. Every panel carries a one-line "what to do if this is bad" note pointing at a runbook anchor.

### 4.3 Logging & error tracking
- Container stdout → Docker json-file with rotation (sufficient at this scale); optional Loki + Promtail
  if searching becomes painful. Decision recorded either way.
- Sentry (or GlitchTip) for API/worker exceptions and admin-dashboard errors, with `beforeSend`
  scrubbing tokens, keys, `raw_message`, and MSISDNs, and `request_id` attached for correlation with logs.
- Caddy access logs retained 14 days; app logs 30 days; both counted in the disk-space alert.

### 4.4 Alerting (`architecture.md §15.3`)
Alertmanager (or Grafana alerting) → email + Telegram, grouped, with a runbook link and the current
value in every message. Silence windows for planned maintenance.

| Sev | Rule (examples) | Route |
|---|---|---|
| **P1** | `/readyz` failing >2 min · Postgres unreachable · `webhook_dead_total` increases · `invariant_violations_total > 0` · disk >90% · backup missing >26 h | Telegram + email, immediate, repeat every 15 min until acked |
| **P2** | A device offline >30 min during 09:00–23:00 Asia/Dhaka · webhook success rate <90% for a company over 15 min · unmatched-SMS rate >20% for a company over 1 h · queue backlog >500 or oldest job >10 min · reviews breaching SLA · refresh-token reuse detected · auth-failure spike | Telegram + email |
| **P3** | Parse failure rate >5% for a provider over 6 h · open reviews >10 · hint-mismatch spike · TLS cert <14 days · key/secret expiring · client endpoint returning 4xx (misconfiguration) · staging drift | Email, digest |

**Device-offline alerting is a product feature, not just ops** (`architecture.md §15.3`): the same rule
also notifies the company's contact email so the merchant can act without waiting for you. Business-hours
windowing is required, or you will be paged every night when shops close.

Test every rule by inducing the condition in staging (see §6) — an untested alert is not an alert.

### 4.5 Scheduled jobs (BullMQ repeatable, in the worker)
| Job | Cadence | Purpose |
|---|---|---|
| `invariants` | 15 min | Task 08's `sql/invariants.sql` → P1 on any row |
| `device-health` | 5 min | derive offline devices, fire P2, notify company contacts |
| `retention-purge` | daily 02:30 Dhaka | `sms_logs.raw_message` redaction past `sms_retention_days`; `webhook_deliveries` bodies >30 d; `auth_attempts` >90 d; `match_attempts` >90 d; `device_events` >30 d (`architecture.md §17.3`) |
| `expire-orders` | 60 s | from Task 07 |
| `webhook-sweeper` | 60 s | from Task 09 |
| `rescan-unmatched` | 15 min | from Task 08 |
| `analytics-rollup` | hourly | from Task 10 |
| `cleanup-credentials` | hourly | apply `api_keys.revoke_at` grace expiry; clear `webhook_secret_prev_enc` past 7 days; purge expired `idempotency_keys` |
| `backup-verify` | daily | assert last night's backup exists, is non-trivial in size, and its checksum matches |
| `cert-expiry-check` | daily | Caddy cert expiry <14 days → P3 |

All jobs: idempotent, singleton-locked (Redis), with duration + outcome metrics and a failure alert.
A job that hasn't succeeded within 2× its interval alerts — silent job death is otherwise invisible.

### 4.6 Backups & restore (`architecture.md §16.1`)
1. `infra/backup/pg_backup.sh`: nightly `pg_dump -Fc` → `age`/`gpg` encrypt with `BACKUP_ENCRYPTION_KEY`
   → upload to S3/R2 → verify size + checksum → prune (30 daily, 12 monthly). LF line endings
   (Windows dev machine, Linux host — see Task 01).
2. Also back up: `.env` (encrypted, separately, since the DB backup is useless without
   `KEY_ENCRYPTION_KEY`), the Caddy data volume, and the Android release keystore reference
   (keystore itself stays offline per Task 15).
3. Redis is **not** backed up as a source of truth (AOF is for restart durability only). Document that
   losing Redis loses in-flight queue state, which the DB-driven sweepers (Tasks 08/09) then recover —
   and verify that claim in the drill.
4. **Restore drill** (must actually be performed, timed, and recorded): pull the latest backup, decrypt,
   restore into a scratch compose stack, run migrations status + `sql/invariants.sql`, boot the API
   against it, and execute the Task 09 journey test. Record RTO in `docs/runbook.md`. Repeat quarterly.
5. Document RPO (≤24 h with nightly dumps) and state plainly whether that is acceptable for a payment
   verification platform; if not, add streaming WAL archiving to the roadmap with its cost.

### 4.7 Secrets & access hygiene
- Secrets live in `/opt/paysync/.env` (root-owned, `600`), injected via compose `env_file`; never in the
  image, never in CI logs. CI holds only deploy credentials and the Android keystore.
- Documented rotation procedure for every secret, including the one with a real hazard:
  rotating `KEY_ENCRYPTION_KEY` requires re-encrypting `webhook_secret_enc` and `totp_secret_enc` —
  write the migration script for that now, not during an incident.
- Postgres/Redis reachable only on the Docker network; `pg_hba` restricted; Redis `requirepass` +
  dangerous commands renamed/disabled.
- SSH: keys only, non-standard port optional, fail2ban, root login disabled, and a documented
  break-glass path (provider console) in case you lock yourself out.

---

## 5. Files created / modified

```
infra/docker-compose.yml  infra/docker-compose.staging.yml  infra/Caddyfile
infra/provision.sh  infra/.env.example
infra/backup/{pg_backup.sh,restore.sh,verify.sh}
infra/monitoring/{prometheus.yml,alert-rules.yml,alertmanager.yml,
                  grafana/dashboards/{money-path.json,devices.json,parser.json,infra.json},
                  grafana/provisioning/*}
apps/api/Dockerfile  apps/admin/Dockerfile  .dockerignore
apps/api/src/workers/{retention-purge.processor.ts,device-health.processor.ts,
                      cleanup-credentials.processor.ts,backup-verify.processor.ts,
                      cert-expiry.processor.ts}
apps/api/src/modules/notifications/{alert.service.ts,telegram.channel.ts,email.channel.ts,
                                    company-notify.service.ts}
apps/api/src/config/crypto-rotation.script.ts
.github/workflows/{deploy.yml,deploy-staging.yml}
docs/runbook.md            # completed: incidents, restore, rotation, deploys, rollback
docs/operations.md         # architecture of the ops stack, dashboards, alert catalogue
docs/device-offline-playbook.md
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Deploy pipeline** | Deploy to staging from a clean VPS state; then a deliberate failing migration → deploy aborts, previous version stays up, alert fires; then a deliberate failing health check → automatic rollback to the previous image tag, verified by `/version`. |
| Zero-downtime rolling restart | `hey`/`k6` at modest RPS during a deploy → zero failed requests (Caddy drains one api replica at a time). |
| TLS | `testssl.sh` on both hosts: TLS 1.2+, HSTS, no weak ciphers, A grade; admin IP allowlist blocks a non-listed IP. |
| **Alert rules — each one induced** | Stop Postgres (P1); insert a violating row via raw SQL (P1 invariants); force a webhook to `DEAD` (P1); age a device's `last_heartbeat_at` during business hours (P2) and outside (no alert); fill the disk with a large file (P1 at 90%); deactivate a parser rule to spike parse failures (P3); pause the backup job (P1 at 26 h). Each must arrive on both channels with the right severity and a working runbook link. |
| Alert quality | Confirm grouping/deduplication (10 offline devices → one grouped message), silences work, and a resolved condition sends a recovery notice. |
| Scheduled jobs | Each runs, is singleton-locked under two worker replicas (no double execution), reports metrics, and alerts when it hasn't succeeded within 2× its interval (induce by disabling one). |
| Retention purge | Seed old rows → purge redacts `raw_message` past retention while preserving extracted fields, and leaves in-window rows untouched; counts logged. |
| **Restore drill** | Full timed restore into a scratch stack: migrations current, invariants clean, API boots, the Task 09 journey test passes against restored data. RTO recorded. Also verify the "Redis loss is recoverable" claim: flush Redis on staging with pending webhook events and confirm the sweepers deliver everything. |
| Backup integrity | Encrypted artifact cannot be read without the key; checksum verification catches a corrupted upload (flip a byte deliberately); pruning keeps the documented set. |
| Secret rotation | Run the `KEY_ENCRYPTION_KEY` rotation script on staging: webhook secrets and TOTP secrets still decrypt and work afterwards; a wrong key fails loudly rather than corrupting data. |
| Monitoring completeness | Every metric named in `architecture.md §15.2` appears in Prometheus with data; every dashboard panel resolves (no "No data" panels); every alert rule references an existing metric (a lint script over `alert-rules.yml` vs the registry). |
| Log hygiene | Grep aggregated logs and Sentry payloads for known secret values and a known `raw_message` → zero hits. |
| Resource sizing | 30-minute k6 soak at 3× expected peak (`architecture.md §16.4`) with memory/CPU headroom recorded; staging never starves production during it. |
| Firewall/SSH | External port scan shows only 22/80/443; password auth refused; Postgres/Redis unreachable from outside; fail2ban bans after repeated failures. |

**Smoke demo:** deploy to production from CI with a migration present, showing the pre-deploy backup, the
rolling restart with zero failed requests, and the green health gate; then stop Postgres and show the P1
alert arriving on Telegram within two minutes with a runbook link that actually resolves.

---

## 7. Acceptance criteria

- [ ] Thin slice delivered right after Task 03: production + staging compose stacks, Caddy TLS, CI deploy, and a working staging URL.
- [ ] Production stack runs api ×2, worker, admin, Postgres, Redis behind Caddy with only 80/443 exposed; healthchecks and log rotation in place.
- [ ] CI/CD deploys on `main` with `prisma migrate deploy`, pre-deploy backup on migration, rolling restart, health gate, and automatic rollback — all three failure paths demonstrated.
- [ ] Zero failed requests during a rolling deploy under load.
- [ ] Prometheus scrapes api/worker/postgres/redis/caddy; all four Grafana dashboards populated with no empty panels; every `architecture.md §15.2` metric present.
- [ ] Every P1/P2/P3 rule from `architecture.md §15.3` implemented, **each induced and verified** on both channels, with grouping, silences, recovery notices, and runbook links.
- [ ] Device-offline alerting is business-hours-aware and also notifies the company contact.
- [ ] All scheduled jobs run idempotently with singleton locking, metrics, and stale-job alerting.
- [ ] Retention purge implements `architecture.md §17.3` exactly, verified on seeded data.
- [ ] Nightly encrypted backups to object storage with checksum verification and documented pruning; a corrupted artifact is detected.
- [ ] **A timed restore drill has been performed and recorded**, ending with invariants clean and the Task 09 journey test passing on restored data; RPO/RTO documented.
- [ ] The "Redis loss is recoverable" claim verified by flushing Redis with pending events and confirming full delivery.
- [ ] `KEY_ENCRYPTION_KEY` rotation script exists and is proven on staging.
- [ ] Sentry captures exceptions with secrets scrubbed; no secret or `raw_message` found in aggregated logs.
- [ ] VPS hardened: SSH keys only, UFW, fail2ban, unattended upgrades, internal-only datastores, verified by external scan.
- [ ] `docs/runbook.md` and `docs/operations.md` complete, with every alert linking to a real procedure.

---

## 8. Risks & notes

- **Pull the thin slice forward.** Deploying a nearly-empty API to staging on day ~10 costs a day and
  removes the classic end-of-project week where nothing works on the VPS. Every later task then develops
  against a real deployed environment — which also makes Task 13/14's Android work far more realistic.
- **A backup you have never restored is not a backup.** The drill is an acceptance criterion for exactly
  this reason, and the RPO question deserves an explicit, recorded answer: nightly dumps mean up to 24 h
  of verified payments could be lost. At this scale that is probably acceptable; decide deliberately and
  write down the decision, and put WAL archiving on the roadmap if it isn't.
- **Untested alerts are worse than no alerts** — they create false confidence. Inducing each condition is
  tedious and is the most valuable half-day in this task.
- Alert fatigue will kill the system's usefulness within two weeks. Business-hours windowing, grouping,
  and a quiet-when-healthy overview (Task 12) are what keep the signal meaningful for a single operator.
- `KEY_ENCRYPTION_KEY` is the one secret whose loss is unrecoverable for webhook secrets and TOTP
  enrolments (they are encrypted, not hashed). Back it up separately from the database, and never in the
  same place.
- Single-VPS means a single point of failure. That is a deliberate, cost-driven choice
  (`architecture.md ADR-10`); the honest mitigations are fast restore (drilled here), a documented
  rebuild procedure, and provider snapshots — not pretending it's HA.
