/**
 * ID / token / hashing helpers.
 *
 * DB primary keys prefer DB-side `uuid_generate_v7()` (Task 02); `uuidv7()`
 * here is the application-side fallback and for tests. Tokens are 256-bit
 * random, base62-encoded, with a typed prefix (ADR-4 credential separation).
 */

import { createHash, randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Credential prefixes (architecture §6.2, §7.2). */
export const KEY_PREFIXES = {
  SERVER: 'psk_live_',
  DEVICE_ENROLL: 'pde_live_',
  DEVICE_TOKEN: 'pdt_',
} as const;

export type KeyPrefixKind = keyof typeof KEY_PREFIXES;

export function keyPrefix(kind: KeyPrefixKind): string {
  return KEY_PREFIXES[kind];
}

/** RFC 9562 UUIDv7 (time-ordered). Application-side fallback to the DB generator. */
export function uuidv7(): string {
  const ms = Date.now();
  const timeHex = ms.toString(16).padStart(12, '0').slice(-12); // 48-bit timestamp
  const r = randomBytes(16).toString('hex'); // 128 bits of randomness
  const version = '7';
  const randA = r.slice(0, 3); // 12 bits
  const variantNibble = ((parseInt(r.charAt(3), 16) & 0x3) | 0x8).toString(16); // 10xx variant
  const hex = (timeHex + version + randA + variantNibble + r.slice(4, 16) + r.slice(16, 19)).slice(
    0,
    32,
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** A cryptographically-random base62 token of `byteLength` bytes of entropy (default 32 = 256 bits). */
export function randomToken(byteLength = 32): string {
  const buf = randomBytes(byteLength);
  let num = BigInt(`0x${buf.toString('hex')}`);
  if (num === 0n) return '0';
  const base = 62n;
  let out = '';
  while (num > 0n) {
    out = BASE62.charAt(Number(num % base)) + out;
    num /= base;
  }
  return out;
}

/** Issue a prefixed credential: `{ plaintext, prefix }`. Hashing is the caller's (server) job. */
export function issueCredential(
  kind: KeyPrefixKind,
  byteLength = 32,
): { plaintext: string; prefix: string } {
  const prefix = KEY_PREFIXES[kind];
  const plaintext = `${prefix}${randomToken(byteLength)}`;
  return { plaintext, prefix };
}

export function hashSha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The device→server dedupe key (architecture §5.3). Kotlin computes this with
 * the identical recipe; a cross-language vector test guards parity (Task 13).
 */
export function clientMsgHash(parts: {
  companyCode: string;
  address: string;
  normalizedBody: string;
  smsTimestampMillis: number;
}): string {
  return hashSha256(
    `${parts.companyCode}|${parts.address}|${parts.normalizedBody}|${parts.smsTimestampMillis}`,
  );
}
