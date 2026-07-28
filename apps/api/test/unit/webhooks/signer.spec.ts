import { verifyWebhook } from '@paysync/shared';
import type { Company } from '@prisma/client';
import { describe, expect, it } from 'vitest';

// The published JS reference verifier, executed here against a real signature.
import { verifyPaySyncWebhook } from '../../../../../docs/webhook-verification/verify.js';
import type { ConfigService } from '../../../src/config/config.service.js';
import { CryptoService } from '../../../src/config/crypto.service.js';
import { SignerService } from '../../../src/modules/webhooks/signing/signer.service.js';

const crypto = new CryptoService({
  crypto: { keyEncryptionKey: Buffer.alloc(32, 1) },
} as unknown as ConfigService);
const signer = new SignerService(crypto);
const NOW = new Date('2026-07-28T00:00:00.000Z');
const RAW = '{"event_id":"e","data":{"a":1}}';

function company(over: Partial<Company>): Company {
  return {
    webhook_secret_enc: crypto.encrypt('whsec_current'),
    webhook_secret_prev_enc: null,
    webhook_secret_rotated_at: null,
    ...over,
  } as unknown as Company;
}

describe('SignerService', () => {
  it('produces a t=…,v1=… header that shared verifyWebhook accepts', () => {
    const { header, timestamp, expectedV1 } = signer.sign(company({}), RAW, NOW);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(header).toContain(`v1=${expectedV1}`);
    expect(
      verifyWebhook({ secret: 'whsec_current', header, rawBody: RAW, nowSeconds: timestamp }),
    ).toBe(true);
  });

  it('a one-byte body change is rejected', () => {
    const { header, timestamp } = signer.sign(company({}), RAW, NOW);
    expect(
      verifyWebhook({ secret: 'whsec_current', header, rawBody: `${RAW} `, nowSeconds: timestamp }),
    ).toBe(false);
  });

  it('the published JS verifier accepts a generated payload', () => {
    const { header, timestamp } = signer.sign(company({}), RAW, NOW);
    expect(
      verifyPaySyncWebhook({
        secret: 'whsec_current',
        header,
        rawBody: RAW,
        nowSeconds: timestamp,
      }),
    ).toBe(true);
  });

  it('dual-signs during the rotation window; the old secret still verifies via v0', () => {
    const c = company({
      webhook_secret_prev_enc: crypto.encrypt('whsec_old'),
      webhook_secret_rotated_at: NOW,
    });
    const { header, timestamp } = signer.sign(c, RAW, NOW);
    expect(header).toContain('v0=');
    expect(
      verifyPaySyncWebhook({ secret: 'whsec_old', header, rawBody: RAW, nowSeconds: timestamp }),
    ).toBe(true);
    expect(
      verifyPaySyncWebhook({
        secret: 'whsec_current',
        header,
        rawBody: RAW,
        nowSeconds: timestamp,
      }),
    ).toBe(true);
  });

  it('drops v0 once the 7-day window has passed', () => {
    const c = company({
      webhook_secret_prev_enc: crypto.encrypt('whsec_old'),
      webhook_secret_rotated_at: new Date(NOW.getTime() - 8 * 24 * 3600 * 1000),
    });
    const { header } = signer.sign(c, RAW, NOW);
    expect(header).not.toContain('v0=');
  });
});
