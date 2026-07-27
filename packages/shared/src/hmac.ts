/**
 * The ONE webhook HMAC implementation (CLAUDE.md rule 3, ADR-9).
 *
 * Signature is `HMAC_SHA256(secret, "{timestamp}.{raw_body}")` over the frozen
 * raw body, with a fresh timestamp per attempt. The API, the tests, and the
 * published client verifier snippets all use this — never a second copy.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

export interface SignWebhookInput {
  secret: string;
  timestamp: number;
  rawBody: string;
  /** During secret rotation, also emit `v0` computed with the previous secret. */
  prevSecret?: string;
}

/** Produce the `X-PaySync-Signature` header value: `t=<unix>,v1=<hex>[,v0=<hex>]`. */
export function signWebhook(input: SignWebhookInput): string {
  const v1 = computeSignature(input.secret, input.timestamp, input.rawBody);
  if (input.prevSecret !== undefined && input.prevSecret.length > 0) {
    const v0 = computeSignature(input.prevSecret, input.timestamp, input.rawBody);
    return `t=${input.timestamp},v1=${v1},v0=${v0}`;
  }
  return `t=${input.timestamp},v1=${v1}`;
}

interface ParsedHeader {
  timestamp: number | undefined;
  signatures: string[];
}

function parseSignatureHeader(header: string): ParsedHeader {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (key === 't') {
      const n = Number(value);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === 'v1' || key === 'v0') {
      signatures.push(value);
    }
  }
  return { timestamp, signatures };
}

function safeEqualHex(a: string, b: string): boolean {
  // Hex strings are ASCII, so char length == byte length; one guard suffices.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export interface VerifyWebhookInput {
  secret: string;
  /** Accept signatures made with the previous secret during rotation. */
  prevSecret?: string;
  header: string;
  rawBody: string;
  toleranceSeconds?: number;
  /** Injectable for tests; defaults to the current time. */
  nowSeconds?: number;
}

/**
 * Verify a webhook signature: constant-time compare over the raw body, reject
 * outside the timestamp tolerance, accept `v1` or (during rotation) `v0`.
 */
export function verifyWebhook(input: VerifyWebhookInput): boolean {
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const { timestamp, signatures } = parseSignatureHeader(input.header);
  if (timestamp === undefined || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const secrets = [input.secret];
  if (input.prevSecret !== undefined && input.prevSecret.length > 0) {
    secrets.push(input.prevSecret);
  }
  for (const secret of secrets) {
    const expected = computeSignature(secret, timestamp, input.rawBody);
    for (const signature of signatures) {
      if (safeEqualHex(expected, signature)) return true;
    }
  }
  return false;
}
