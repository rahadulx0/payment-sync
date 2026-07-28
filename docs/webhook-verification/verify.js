// payment-sync webhook verifier — Node.js reference (ESM, no dependencies).
// (CommonJS projects: replace the import with `const crypto = require('crypto')`
//  and this export with `module.exports = { verifyPaySyncWebhook }`.)
//
// Verify BEFORE parsing JSON, over the exact raw request body:
//   import { verifyPaySyncWebhook } from './verify.js';
//   const ok = verifyPaySyncWebhook({ secret, header, rawBody });
//
// Signature header: `t=<unix>,v1=<hex>[,v0=<hex>]`
//   v1 = HMAC_SHA256(secret, `${t}.${rawBody}`)
// During secret rotation the platform sends both v1 (new) and v0 (old); accept
// either. Reject anything older than the tolerance (default 5 minutes).
import crypto from 'node:crypto';

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyPaySyncWebhook({
  secret,
  prevSecret,
  header,
  rawBody,
  toleranceSeconds = 300,
  nowSeconds,
}) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  let t;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't') t = Number(v);
    else if (k === 'v1' || k === 'v0') sigs.push(v);
  }
  if (!Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(now - t) > toleranceSeconds) return false;

  const secrets = prevSecret ? [secret, prevSecret] : [secret];
  for (const s of secrets) {
    const expected = crypto.createHmac('sha256', s).update(`${t}.${rawBody}`, 'utf8').digest('hex');
    for (const sig of sigs) if (timingSafeEqualHex(expected, sig)) return true;
  }
  return false;
}
