import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { signWebhook, verifyWebhook } from '../src/hmac.js';

interface Vectors {
  secret: string;
  prevSecret: string;
  timestamp: number;
  rawBody: string;
  expected_v1: string;
  expected_v0: string;
  header_single: string;
  header_rotating: string;
}

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/webhook-signatures.json', import.meta.url), 'utf8'),
) as Vectors;

describe('signWebhook', () => {
  it('matches the committed golden vector', () => {
    const header = signWebhook({
      secret: vectors.secret,
      timestamp: vectors.timestamp,
      rawBody: vectors.rawBody,
    });
    expect(header).toBe(vectors.header_single);
  });

  it('emits both v1 and v0 during rotation', () => {
    const header = signWebhook({
      secret: vectors.secret,
      prevSecret: vectors.prevSecret,
      timestamp: vectors.timestamp,
      rawBody: vectors.rawBody,
    });
    expect(header).toBe(vectors.header_rotating);
  });
});

describe('verifyWebhook', () => {
  const now = vectors.timestamp; // verify "at" signing time

  it('accepts a valid signature within tolerance', () => {
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: vectors.header_single,
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects a one-byte body change', () => {
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: vectors.header_single,
        rawBody: `${vectors.rawBody} `,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a payload outside the timestamp tolerance', () => {
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: vectors.header_single,
        rawBody: vectors.rawBody,
        nowSeconds: now + 301,
      }),
    ).toBe(false);
  });

  it('accepts via v0 when the verifier only holds the previous secret (rotation)', () => {
    expect(
      verifyWebhook({
        secret: vectors.prevSecret,
        header: vectors.header_rotating,
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('accepts a previous-secret signature when the verifier knows both secrets', () => {
    const header = signWebhook({
      secret: vectors.prevSecret,
      timestamp: vectors.timestamp,
      rawBody: vectors.rawBody,
    });
    expect(
      verifyWebhook({
        secret: vectors.secret,
        prevSecret: vectors.prevSecret,
        header,
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects a tampered timestamp', () => {
    const tampered = vectors.header_single.replace(`t=${vectors.timestamp}`, 't=1785312999');
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: tampered,
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a signature of the wrong length', () => {
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: `t=${vectors.timestamp},v1=deadbeef`,
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: 'garbage',
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(
      verifyWebhook({
        secret: vectors.secret,
        header: `t=notanumber,v1=${vectors.expected_v1}`,
        rawBody: vectors.rawBody,
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
