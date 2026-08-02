#!/usr/bin/env bash
# Nightly encrypted backup (architecture §16.1, Task 16 §4.6).
#
# RPO is 24 h with nightly dumps — for a payment-VERIFICATION platform (we never
# move money, and the phone still holds the SMS) that is a deliberate, accepted
# trade-off. See docs/runbook.md; WAL archiving is on the roadmap if it changes.
#
# LF line endings matter: this is authored on Windows and runs on Linux.
set -Eeuo pipefail

: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${BACKUP_ENCRYPTION_KEY:?}"
: "${S3_BUCKET:?}" "${S3_ENDPOINT:=}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
DUMP="${WORKDIR}/paysync-${STAMP}.dump"
ENC="${DUMP}.age"
trap 'rm -rf "${WORKDIR}"' EXIT

echo "[backup] dumping ${POSTGRES_DB}"
docker compose -p paysync exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "${DUMP}"

SIZE=$(stat -c%s "${DUMP}")
# A dump far smaller than expected means something is wrong; fail rather than
# quietly uploading a useless artifact and pruning a good one later.
if [ "${SIZE}" -lt 10000 ]; then
  echo "[backup] FATAL: dump is only ${SIZE} bytes" >&2
  exit 1
fi

echo "[backup] encrypting (${SIZE} bytes)"
age -r "${BACKUP_ENCRYPTION_KEY}" -o "${ENC}" "${DUMP}"
SHA="$(sha256sum "${ENC}" | cut -d' ' -f1)"
echo "${SHA}  $(basename "${ENC}")" > "${ENC}.sha256"

echo "[backup] uploading"
AWS_ARGS=(--only-show-errors)
[ -n "${S3_ENDPOINT}" ] && AWS_ARGS+=(--endpoint-url "${S3_ENDPOINT}")
aws s3 cp "${AWS_ARGS[@]}" "${ENC}" "s3://${S3_BUCKET}/db/$(basename "${ENC}")"
aws s3 cp "${AWS_ARGS[@]}" "${ENC}.sha256" "s3://${S3_BUCKET}/db/$(basename "${ENC}").sha256"

# The DB backup is useless without KEY_ENCRYPTION_KEY (webhook + TOTP secrets are
# encrypted, not hashed). It is backed up separately, and NEVER to the same place.
echo "[backup] ok ${STAMP} sha256=${SHA}"

echo "[backup] pruning (keep 30 daily, 12 monthly)"
aws s3 ls "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/" \
  | awk '{print $4}' | grep -E '\.age$' | sort -r | tail -n +31 \
  | grep -v -E '[0-9]{6}01T' \
  | while read -r old; do
      aws s3 rm "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/${old}" || true
      aws s3 rm "${AWS_ARGS[@]}" "s3://${S3_BUCKET}/db/${old}.sha256" || true
    done

echo "[backup] done"
