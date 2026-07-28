import { Injectable } from '@nestjs/common';
import { AppError, signWebhook } from '@paysync/shared';
import type { Company } from '@prisma/client';

import { CryptoService } from '../../../config/crypto.service.js';

const ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface SignResult {
  header: string;
  timestamp: number;
  expectedV1: string;
}

/**
 * Produces the `X-PaySync-Signature` header via the single shared HMAC
 * implementation (CLAUDE.md rule 3). A fresh timestamp per call means each retry
 * carries a `t` inside the client's tolerance. During the 7-day rotation window
 * the header also carries `v0` computed with the previous secret.
 */
@Injectable()
export class SignerService {
  constructor(private readonly crypto: CryptoService) {}

  secretsFor(company: Company, now: Date): { secret: string; prevSecret?: string } {
    if (company.webhook_secret_enc === null) {
      throw new AppError('INTERNAL_ERROR', 'Company has no webhook secret configured.');
    }
    const secret = this.crypto.decrypt(company.webhook_secret_enc);
    const rotatedAt = company.webhook_secret_rotated_at;
    if (
      company.webhook_secret_prev_enc !== null &&
      rotatedAt !== null &&
      now.getTime() - rotatedAt.getTime() < ROTATION_WINDOW_MS
    ) {
      return { secret, prevSecret: this.crypto.decrypt(company.webhook_secret_prev_enc) };
    }
    return { secret };
  }

  sign(company: Company, rawBody: string, now: Date): SignResult {
    const timestamp = Math.floor(now.getTime() / 1000);
    const { secret, prevSecret } = this.secretsFor(company, now);
    const header = signWebhook({
      secret,
      timestamp,
      rawBody,
      ...(prevSecret !== undefined ? { prevSecret } : {}),
    });
    const v1 = /v1=([0-9a-f]+)/.exec(header)?.[1] ?? '';
    return { header, timestamp, expectedV1: v1 };
  }
}
