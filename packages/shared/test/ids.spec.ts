import { describe, expect, it } from 'vitest';

import { clientMsgHash, hashSha256, issueCredential, randomToken, uuidv7 } from '../src/ids.js';

describe('uuidv7', () => {
  it('produces a version-7, variant-10 UUID', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('is unique across many calls', () => {
    const set = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    expect(set.size).toBe(5000);
  });
});

describe('randomToken', () => {
  it('is base62 and unique', () => {
    const t = randomToken();
    expect(t).toMatch(/^[0-9A-Za-z]+$/);
    const set = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(set.size).toBe(1000);
  });
});

describe('issueCredential', () => {
  it('prefixes by kind', () => {
    expect(issueCredential('SERVER').plaintext).toMatch(/^psk_live_[0-9A-Za-z]+$/);
    expect(issueCredential('DEVICE_ENROLL').plaintext).toMatch(/^pde_live_[0-9A-Za-z]+$/);
    expect(issueCredential('DEVICE_TOKEN').prefix).toBe('pdt_');
  });
});

describe('hashSha256 / clientMsgHash', () => {
  it('matches a known SHA-256 vector', () => {
    expect(hashSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('clientMsgHash is deterministic and composed as company|address|body|ts', () => {
    const parts = {
      companyCode: 'COMP12345',
      address: 'bKash',
      normalizedBody: 'Cash In Tk 1250 TrxID 8A7BCD1234',
      smsTimestampMillis: 1785312902000,
    };
    const expected = hashSha256(
      `${parts.companyCode}|${parts.address}|${parts.normalizedBody}|${parts.smsTimestampMillis}`,
    );
    expect(clientMsgHash(parts)).toBe(expected);
    expect(clientMsgHash(parts)).toBe(clientMsgHash(parts));
  });
});
