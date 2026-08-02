#!/usr/bin/env bash
# Daily backup verification (Task 16 §4.5). Runs after pg_backup.sh from cron.
#
# It answers the only question that matters at 3am: *is there a restorable backup
# from last night?* A silent backup failure is invisible until you need it, which
# is precisely when discovering it is worst.
set -Eeuo pipefail

: "${S3_BUCKET:?}" "${S3_ENDPOINT:=}"
: "${MIN_SIZE_BYTES:=10000}"
: "${MAX_AGE_HOURS:=26}"

AWS_ARGS=(--only-show-errors)
[ -n "${S3_ENDPOINT}" ] && AWS_ARGS+=(--endpoint-url "${S3_ENDPOINT}")

LATEST="$(aws s3 ls "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/" | awk '{print $4}' | grep -E '\.age$' | sort | tail -1 || true)"
if [ -z "${LATEST}" ]; then
  echo "[verify] FAIL: no backup artifacts found" >&2
  exit 1
fi

# Age check: the artifact name carries a UTC stamp (paysync-YYYYmmddTHHMMSSZ.dump.age).
STAMP="$(echo "${LATEST}" | grep -oE '[0-9]{8}T[0-9]{6}Z' || true)"
if [ -z "${STAMP}" ]; then
  echo "[verify] FAIL: cannot parse a timestamp from ${LATEST}" >&2
  exit 1
fi
BACKUP_EPOCH="$(date -u -d "${STAMP:0:8} ${STAMP:9:2}:${STAMP:11:2}:${STAMP:13:2}" +%s)"
AGE_HOURS=$(( ( $(date -u +%s) - BACKUP_EPOCH ) / 3600 ))
if [ "${AGE_HOURS}" -gt "${MAX_AGE_HOURS}" ]; then
  echo "[verify] FAIL: newest backup is ${AGE_HOURS}h old (>${MAX_AGE_HOURS}h) — P1" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT
aws s3 cp "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/${LATEST}" "${WORKDIR}/${LATEST}"
aws s3 cp "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/${LATEST}.sha256" "${WORKDIR}/${LATEST}.sha256"

SIZE=$(stat -c%s "${WORKDIR}/${LATEST}")
if [ "${SIZE}" -lt "${MIN_SIZE_BYTES}" ]; then
  echo "[verify] FAIL: artifact is only ${SIZE} bytes" >&2
  exit 1
fi

# Catches a corrupted or truncated upload — a flipped byte fails here.
echo "[verify] checksum"
(cd "${WORKDIR}" && sha256sum -c "${LATEST}.sha256")

echo "[verify] OK ${LATEST} (${SIZE} bytes, ${AGE_HOURS}h old)"
# Note: this proves the artifact is intact, NOT that it restores. Only the
# quarterly restore drill (restore.sh) proves that.
