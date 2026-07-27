const SECRET_KEYS = new Set([
  'key_hash',
  'token_hash',
  'prev_token_hash',
  'password_hash',
  'totp_secret_enc',
  'webhook_secret_enc',
  'webhook_secret_prev_enc',
  'recovery_codes_hash',
  'webhook_secret',
  'server_key',
  'device_enroll_key',
  'secret',
  'password',
  'plaintext',
]);

/** Deep-redact secret-bearing keys so they never land in audit_logs. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    if (Buffer.isBuffer(value)) return { redacted: true };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.has(k) ? { redacted: true } : redact(v);
    }
    return out;
  }
  return value;
}
