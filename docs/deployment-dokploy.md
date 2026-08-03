# Deploying with Dokploy

Dokploy is a self-hosted PaaS (Docker + Traefik) — it replaces the Caddy + SSH-deploy pipeline in
`infra/docker-compose.yml` with a UI, automatic TLS, and git-push deploys. The application itself is
unchanged.

**What changes vs. the plain-VPS setup**

| Plain VPS (`infra/`)                        | Dokploy                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Caddy terminates TLS, routes, load-balances | Traefik does it; you attach domains in the UI                                       |
| `/opt/paysync/.env` (root-owned, 600)       | Environment set in the Dokploy UI per project                                       |
| `pg_backup.sh` via cron                     | Dokploy's scheduled database backups → S3 (keep the script for the _restore drill_) |
| `deploy.yml` SSH + `prisma migrate deploy`  | Git-push auto-deploy; migrations run in the API entrypoint                          |
| Postgres/Redis in your compose              | Dokploy **managed database services**                                               |

Use `infra/dokploy/docker-compose.yml` — not the plain one.

---

## 1. Server

A 4 vCPU / 8 GB / NVMe VPS, Debian 12 or Ubuntu 22.04+, with DNS you control.

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Then open `http://<server-ip>:3000` and create the admin account **immediately** — that port is
unauthenticated until you do.

Point DNS at the server:

| Record                   | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| `api.yourdomain.com`     | A → server IP                                             |
| `admin.yourdomain.com`   | A → server IP                                             |
| `dokploy.yourdomain.com` | A → server IP (optional, to put the panel behind TLS too) |

Even with Dokploy managing Docker, still harden the box — `infra/provision.sh` covers SSH keys-only,
UFW (22/80/443 only), fail2ban and unattended upgrades. Do **not** leave the Dokploy panel on a bare
port; give it a domain and, ideally, an IP allowlist.

## 2. Databases (create these first)

In Dokploy → **Databases**:

1. **PostgreSQL 16** — note the internal connection string. Use the _internal_ host (the service name),
   never a public port.
2. **Redis 7** — same.

Enable **scheduled backups** on the Postgres service with an S3/R2 destination. That covers the nightly
dump; `infra/backup/restore.sh` is still what you use for the **restore drill**, which is the part that
actually matters (a backup you have never restored is not a backup).

## 3. The application

Dokploy → **Create Project** → **Compose**.

- **Source**: your GitHub repo, branch `main`
- **Compose path**: `infra/dokploy/docker-compose.yml`

### Environment

Paste from `infra/.env.production.example`, with the DB/Redis URLs from step 2:

```
DATABASE_URL=postgresql://user:pass@<dokploy-postgres-service>:5432/paysync
REDIS_URL=redis://:pass@<dokploy-redis-service>:6379
KEY_ENCRYPTION_KEY=<openssl rand -base64 32>
JWT_ACCESS_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
METRICS_TOKEN=<openssl rand -base64 32>
PUBLIC_API_URL=https://api.yourdomain.com
ADMIN_ORIGIN=https://admin.yourdomain.com
DEPLOY_ENV=PRODUCTION
```

> **`KEY_ENCRYPTION_KEY` is the one secret whose loss is unrecoverable** — webhook secrets and TOTP
> enrolments are encrypted, not hashed. Back it up somewhere that is **not** the database backup.

### Domains

Attach in the UI (Traefik issues Let's Encrypt certificates automatically):

| Service | Port | Domain                 |
| ------- | ---- | ---------------------- |
| `api`   | 3000 | `api.yourdomain.com`   |
| `admin` | 3001 | `admin.yourdomain.com` |

Leave `worker` with **no domain** — it must never be publicly reachable.

### Deploy

Hit **Deploy**. First build takes a few minutes. Then verify:

```bash
curl https://api.yourdomain.com/api/v1/healthz     # {"status":"ok"}
curl https://api.yourdomain.com/api/v1/readyz      # checks DB + Redis
```

Enable the **auto-deploy webhook** in Dokploy and add it to GitHub so `main` deploys on push.

## 4. Seed the first admin

Run once, in the `api` container's terminal (Dokploy gives you one):

```sh
node apps/api/dist/prisma/seed.js
```

Then log in at `https://admin.yourdomain.com`, **enrol TOTP**, and store the 10 recovery codes offline.

## 5. Scheduled jobs

The worker owns the BullMQ repeatables (expiry, webhook sweeper, rescan, invariants, purge). The two
that live outside the app go in Dokploy → **Schedules**:

| Schedule          | Cron        | Command                                           |
| ----------------- | ----------- | ------------------------------------------------- |
| Backup verify     | `0 3 * * *` | `sh infra/backup/verify.sh`                       |
| Cert expiry check | `0 4 * * *` | (Traefik renews automatically; alert if <14 days) |

## Gotchas specific to Dokploy

1. **`NEXT_PUBLIC_API_ORIGIN` is baked at build time.** Changing the API domain requires a **rebuild** of
   the admin image, not a restart. The compose file passes it as a build arg for this reason.
2. **Migrations run in the API entrypoint**, guarded by Prisma's advisory lock so the two replicas don't
   race. If a migration fails the container won't start — check logs before assuming a build problem.
3. **Use internal service names** for `DATABASE_URL`/`REDIS_URL`. If you can reach Postgres from the
   internet, that is a misconfiguration, not a convenience.
4. **`dokploy-network` must be external** in the compose file, or Traefik cannot see your services.
5. **The rollback story is different**: Dokploy redeploys a previous commit rather than retagging an
   image. Keep `main` deployable at every commit.

## What this does not give you

Dokploy replaces the deploy pipeline, not the observability work. Still outstanding from
`workplan/16`, and listed in `docs/go-live-checklist.md`:

- Prometheus/Grafana (run them as a second Dokploy compose project, scraping `api:3000/metrics` with
  `METRICS_TOKEN`)
- **Inducing each alert** — an untested alert is not an alert
- The **timed restore drill**
- External port scan and TLS grading
