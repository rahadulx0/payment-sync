#!/usr/bin/env bash
# Restore drill / real recovery (Task 16 §4.6.4).
#
# A backup you have never restored is not a backup. Run this quarterly against a
# scratch stack, time it, and record the RTO in docs/runbook.md.
set -Eeuo pipefail

: "${BACKUP_AGE_IDENTITY:?path to the age private key}" "${S3_BUCKET:?}"
: "${TARGET_DB:=paysync_restore}" "${S3_ENDPOINT:=}"

ARTIFACT="${1:-}"
AWS_ARGS=(--only-show-errors)
[ -n "${S3_ENDPOINT}" ] && AWS_ARGS+=(--endpoint-url "${S3_ENDPOINT}")

if [ -z "${ARTIFACT}" ]; then
  ARTIFACT="$(aws s3 ls "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/" | awk '{print $4}' | grep -E '\.age$' | sort | tail -1)"
  echo "[restore] latest artifact: ${ARTIFACT}"
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

aws s3 cp "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/${ARTIFACT}" "${WORKDIR}/${ARTIFACT}"
aws s3 cp "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/${ARTIFACT}.sha256" "${WORKDIR}/${ARTIFACT}.sha256"

echo "[restore] verifying checksum"
(cd "${WORKDIR}" && sha256sum -c "${ARTIFACT}.sha256")

echo "[restore] decrypting"
age -d -i "${BACKUP_AGE_IDENTITY}" -o "${WORKDIR}/restore.dump" "${WORKDIR}/${ARTIFACT}"

echo "[restore] restoring into ${TARGET_DB}"
docker compose -p paysync exec -T postgres psql -U "${POSTGRES_USER}" -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
docker compose -p paysync exec -T postgres psql -U "${POSTGRES_USER}" -c "CREATE DATABASE ${TARGET_DB};"
docker compose -p paysync exec -T postgres pg_restore -U "${POSTGRES_USER}" -d "${TARGET_DB}" --no-owner < "${WORKDIR}/restore.dump"

echo "[restore] checking invariants on the restored data"
docker compose -p paysync exec -T postgres psql -U "${POSTGRES_USER}" -d "${TARGET_DB}" \
  -f /dev/stdin < "$(dirname "$0")/../../apps/api/sql/invariants.sql"

echo "[restore] done — now boot the API against ${TARGET_DB} and run the journey test."
