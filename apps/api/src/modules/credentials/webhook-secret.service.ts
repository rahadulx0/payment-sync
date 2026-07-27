import { Injectable } from '@nestjs/common';
import { AppError, randomToken } from '@paysync/shared';

import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CryptoService } from '../../config/crypto.service.js';
import { AuditService } from '../admin/audit/audit.service.js';

@Injectable()
export class WebhookSecretService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** Rotate: current → prev (dual-signed for 7 days by Task 09), new revealed once. */
  async rotate(companyId: string, ctx: { adminId?: string | undefined; ip?: string | undefined }) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (company === null) throw new AppError('ORDER_NOT_FOUND', 'Company not found.');
    const secret = `whsec_${randomToken(24)}`;
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        webhook_secret_prev_enc: company.webhook_secret_enc,
        webhook_secret_enc: this.crypto.encrypt(secret),
        webhook_secret_rotated_at: new Date(),
      },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'webhook_secret.rotate',
      entityType: 'company',
      entityId: companyId,
      companyId,
      ip: ctx.ip,
    });
    return {
      webhook_secret: secret,
      warning: 'Shown once.',
      dual_sign_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
}
