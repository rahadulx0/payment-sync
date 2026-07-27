import { describe, expect, it } from 'vitest';

import { ProviderRule } from '../src/index.js';

const SAMPLE = {
  provider: 'BKASH',
  version: 1,
  sender_addresses: ['bKash', 'BKASH', '16247'],
  message_types: [
    {
      type: 'CASH_IN',
      direction: 'CREDIT',
      must_contain: ['TrxID'],
      must_not_contain: ['Cash Out', 'Send Money to'],
      patterns: {
        amount: '(?:Tk|BDT)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)',
        transaction_id: 'TrxID\\s*[:#]?\\s*([A-Z0-9]{6,20})',
      },
      timestamp_formats: ['dd/MM/yyyy HH:mm'],
      required: ['amount', 'transaction_id'],
    },
  ],
};

describe('ProviderRule schema', () => {
  it('accepts a well-formed rule and applies array defaults', () => {
    const parsed = ProviderRule.parse(SAMPLE);
    expect(parsed.provider).toBe('BKASH');
    expect(parsed.message_types[0]?.direction).toBe('CREDIT');
  });

  it('rejects a rule with no sender addresses', () => {
    expect(() => ProviderRule.parse({ ...SAMPLE, sender_addresses: [] })).toThrow();
  });

  it('rejects an invalid direction', () => {
    const bad = {
      ...SAMPLE,
      message_types: [{ ...SAMPLE.message_types[0], direction: 'SIDEWAYS' }],
    };
    expect(() => ProviderRule.parse(bad)).toThrow();
  });

  // Reference parser + fixtures land in Task 05.
  it.todo('reference parser matches every fixture (Task 05)');
});
