import { describe, expect, it } from 'vitest';

import { fieldErrors, toApiError } from '../../lib/errors';

describe('toApiError', () => {
  it('maps the API envelope and always surfaces the request id', () => {
    const err = toApiError(409, {
      error: { code: 'DUPLICATE_ORDER_ID', message: 'taken', request_id: 'req-123' },
    });
    expect(err).toMatchObject({
      code: 'DUPLICATE_ORDER_ID',
      message: 'taken',
      requestId: 'req-123',
      status: 409,
    });
  });

  it('falls back gracefully on a malformed body', () => {
    const err = toApiError(500, null);
    expect(err.code).toBe('UNKNOWN');
    expect(err.requestId).toBe('');
    expect(err.status).toBe(500);
  });
});

describe('fieldErrors', () => {
  it('extracts string field messages from details', () => {
    const err = toApiError(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad',
        request_id: 'r',
        details: { amount: 'too small', nested: { x: 1 } },
      },
    });
    expect(fieldErrors(err)).toEqual({ amount: 'too small' });
  });
});
