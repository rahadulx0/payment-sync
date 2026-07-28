import { describe, expect, it } from 'vitest';

import {
  classifyResponse,
  classifyTransportError,
} from '../../../src/modules/webhooks/delivery/classify.js';

describe('classifyResponse', () => {
  it('2xx → DELIVERED', () => {
    for (const s of [200, 201, 204, 299]) expect(classifyResponse(s).outcome).toBe('DELIVERED');
  });
  it('3xx → FAILED BAD_BODY (redirect not followed)', () => {
    const c = classifyResponse(302);
    expect(c.outcome).toBe('FAILED');
    expect(c.errorClass).toBe('BAD_BODY');
  });
  it('410 → CANCELLED', () => {
    expect(classifyResponse(410).outcome).toBe('CANCELLED');
  });
  it('408/425/429 → RETRY', () => {
    for (const s of [408, 425, 429]) expect(classifyResponse(s).outcome).toBe('RETRY');
  });
  it('other 4xx → FAILED CLIENT_ERROR (early stop)', () => {
    const c = classifyResponse(404);
    expect(c.outcome).toBe('FAILED');
    expect(c.reason).toBe('CLIENT_ERROR');
  });
  it('5xx → RETRY', () => {
    for (const s of [500, 502, 503]) expect(classifyResponse(s).outcome).toBe('RETRY');
  });
});

describe('classifyTransportError', () => {
  it('is always retryable and preserves the error class', () => {
    const c = classifyTransportError('TIMEOUT');
    expect(c.outcome).toBe('RETRY');
    expect(c.errorClass).toBe('TIMEOUT');
  });
});
