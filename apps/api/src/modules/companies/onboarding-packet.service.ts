import { Injectable } from '@nestjs/common';
import { AppError } from '@paysync/shared';

import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class OnboardingPacketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async build(companyId: string): Promise<Record<string, unknown>> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (company === null) throw new AppError('ORDER_NOT_FOUND', 'Company not found.');
    const base = this.config.publicApiUrl;
    return {
      company_code: company.company_code,
      endpoints: {
        register: `${base}/api/v1/payments/register`,
        status: `${base}/api/v1/payments/{order_id}`,
        list: `${base}/api/v1/payments`,
        device_register: `${base}/api/v1/device/register`,
        webhook_test: `${base}/api/v1/webhooks/test`,
      },
      webhook: {
        signature: 'HMAC_SHA256(secret, "{timestamp}.{raw_body}")',
        headers: [
          'X-PaySync-Event-Id',
          'X-PaySync-Event-Type',
          'X-PaySync-Timestamp',
          'X-PaySync-Signature',
        ],
        verify_recipe:
          'Recompute over the RAW body, constant-time compare, reject if |now - t| > 300s, dedupe by event_id.',
      },
      android_setup:
        'Install the signed APK, enrol with the company code + device enrolment key, grant SMS permission, enable battery-opt exemption.',
      note: 'The server key, device enrolment key and webhook secret are shown only once, at company creation.',
    };
  }
}
