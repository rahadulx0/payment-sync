#!/usr/bin/env sh
# Container entrypoint for the API (and worker) under Dokploy.
#
# Dokploy has no universal "run this before the rollout" hook, so migrations run
# here. That is safe with two replicas because `prisma migrate deploy` takes a
# Postgres advisory lock — the second replica waits for the first rather than
# racing it.
#
# ROLE=api|worker selects the process. Anything retried, delayed or scheduled
# belongs to the worker, never to an HTTP request.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ] && [ "${ROLE:-api}" = "api" ]; then
  echo "[entrypoint] applying migrations"
  # `migrate deploy` never generates or resets — it only applies what is committed.
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
fi

if [ "${ROLE:-api}" = "worker" ]; then
  echo "[entrypoint] starting worker"
  exec node apps/api/dist/src/workers/main.js
fi

echo "[entrypoint] starting api"
exec node apps/api/dist/src/main.js
