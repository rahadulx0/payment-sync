import { describe, expect, it } from 'vitest';

import {
  AppError,
  ERROR_HTTP_STATUS,
  KEY_PREFIXES,
  PRISMA_MIRRORED_ENUMS,
  Provider,
  enumValues,
  keyPrefix,
} from '../src/index.js';

describe('enums', () => {
  it('exposes expected values', () => {
    expect(Provider.BKASH).toBe('BKASH');
    expect(enumValues(Provider)).toEqual(['BKASH', 'NAGAD', 'UNKNOWN', 'UPAY']);
  });

  it('PRISMA_MIRRORED_ENUMS covers the DB-backed enums with no dotted values', () => {
    const names = Object.keys(PRISMA_MIRRORED_ENUMS);
    expect(names).toContain('PaymentStatus');
    expect(names).not.toContain('WebhookEventType'); // wire-only, stored as text
    for (const e of Object.values(PRISMA_MIRRORED_ENUMS)) {
      for (const v of Object.values(e)) {
        expect(v).not.toContain('.');
      }
    }
  });

  it('keyPrefix maps credential kinds', () => {
    expect(keyPrefix('SERVER')).toBe('psk_live_');
    expect(keyPrefix('DEVICE_ENROLL')).toBe('pde_live_');
    expect(KEY_PREFIXES.DEVICE_TOKEN).toBe('pdt_');
  });
});

describe('AppError', () => {
  it('carries the mapped HTTP status', () => {
    const err = new AppError('DUPLICATE_ORDER_ID', 'dup');
    expect(err.httpStatus).toBe(409);
    expect(ERROR_HTTP_STATUS.RATE_LIMITED).toBe(429);
  });

  it('renders an error envelope with request_id and optional details', () => {
    const withDetails = new AppError('VALIDATION_ERROR', 'bad amount', {
      expected: '1250.00',
    }).toEnvelope('req-1');
    expect(withDetails.error.request_id).toBe('req-1');
    expect(withDetails.error.details).toEqual({ expected: '1250.00' });

    const noDetails = new AppError('INTERNAL_ERROR').toEnvelope('req-2');
    expect(noDetails.error.code).toBe('INTERNAL_ERROR');
    expect(noDetails.error.details).toBeUndefined();
    expect(noDetails.error.message).toBe('INTERNAL_ERROR');
  });
});
