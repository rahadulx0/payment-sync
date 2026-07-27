/**
 * Field normalizers — pure functions imported by BOTH the reference parser and
 * (mirrored) the Kotlin engine. Never reimplement these elsewhere (CLAUDE.md
 * rule 9). Money and timestamps route through @paysync/shared so the whole
 * platform agrees on one representation.
 */
import { Money, parseProviderTimestamp } from '@paysync/shared';

const BENGALI_DIGIT_ZERO = 0x09e6;
const ASCII_DIGIT_ZERO = 0x30;

function toAsciiDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code >= BENGALI_DIGIT_ZERO && code <= BENGALI_DIGIT_ZERO + 9) {
      out += String.fromCharCode(ASCII_DIGIT_ZERO + (code - BENGALI_DIGIT_ZERO));
    } else {
      out += ch;
    }
  }
  return out;
}

/** Decimal string with 2 places, or null if unparseable. */
export function normalizeAmount(raw: string): string | null {
  try {
    return Money.fromDecimalString(raw).toDecimalString();
  } catch {
    return null;
  }
}

/** `+8801XXXXXXXXX`, or null for anything that is not a valid BD mobile number. */
export function normalizeMsisdn(raw: string): string | null {
  let d = toAsciiDigits(raw).replace(/[^\d+]/g, '');
  d = d.replace(/^\+/, '');
  if (d.startsWith('880')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (/^1[3-9]\d{8}$/.test(d)) return `+880${d}`;
  return null;
}

/** Uppercased alphanumeric TrxID, or null. Rejects obviously-wrong values (all-digit and short). */
export function normalizeTrxId(raw: string): string | null {
  const t = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6,20}$/.test(t)) return null;
  if (/^\d{1,5}$/.test(t)) return null;
  return t;
}

/** UTC Date from a provider (Dhaka-local) timestamp, or null if invalid / >24h in the future. */
export function normalizeTimestamp(
  raw: string,
  formats: readonly string[],
  now: Date,
): Date | null {
  try {
    const d = parseProviderTimestamp(raw, formats);
    if (d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null;
    return d;
  } catch {
    return null;
  }
}

/** Canonical body for content_hash: NFKC, collapsed whitespace, trimmed. Case is preserved (it carries signal). */
export function normalizeBody(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
