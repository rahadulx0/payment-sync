import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Re-encrypts a secret blob from an old KEY_ENCRYPTION_KEY to a new one
 * (Task 16 §4.7). This exists because `webhook_secret_enc` and `totp_secret_enc`
 * are **encrypted, not hashed** — rotating the KEK without re-encrypting them
 * would silently destroy every webhook secret and TOTP enrolment.
 *
 * Kept as a pure function so it is unit-testable, and so the "wrong old key
 * fails loudly instead of corrupting data" property is provable rather than
 * hoped for.
 */
export function reencrypt(blob: Uint8Array, oldKey: Buffer, newKey: Buffer): Buffer {
  const plaintext = decryptWith(blob, oldKey); // throws on a wrong key — never silently writes garbage
  return encryptWith(plaintext, newKey);
}

export function decryptWith(input: Uint8Array, key: Buffer): string {
  const blob = Buffer.from(input);
  if (blob.length < 1 + IV_LEN + TAG_LEN) throw new Error('ciphertext blob too short');
  const version = blob[0];
  if (version !== VERSION) throw new Error(`unsupported ciphertext version ${String(version)}`);
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ct = blob.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // GCM authentication means a wrong key throws here rather than returning junk.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function encryptWith(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
}

export interface RotationPlanItem {
  table: 'companies' | 'admin_users';
  column: 'webhook_secret_enc' | 'webhook_secret_prev_enc' | 'totp_secret_enc';
}

/** Every encrypted-at-rest column. Missing one here means silent data loss on rotation. */
export const ROTATION_PLAN: RotationPlanItem[] = [
  { table: 'companies', column: 'webhook_secret_enc' },
  { table: 'companies', column: 'webhook_secret_prev_enc' },
  { table: 'admin_users', column: 'totp_secret_enc' },
];
