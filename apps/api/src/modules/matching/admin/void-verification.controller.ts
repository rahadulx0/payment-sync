import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@paysync/shared';
import { IsString, Length } from 'class-validator';

import type { AdminContext } from '../../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { AuditService } from '../../admin/audit/audit.service.js';

class VoidVerificationDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

/**
 * Un-credit a verification (architecture §14, Task 08 §4.5). Dangerous by
 * design: it reverts the order to PENDING and the SMS to UNMATCHED so a correct
 * match can be re-established. Requires a reason, is fully audited, and — being
 * an admin-only route under the default-deny guard — is unreachable by any
 * client credential. Automated self-repair on money is deliberately not built.
 */
@ApiTags('admin-verified')
@AdminAuth()
@Controller('admin/verified')
export class VoidVerificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/void')
  async void(
    @Param('id') id: string,
    @Body() dto: VoidVerificationDto,
    @CurrentAdmin() admin: AdminContext | undefined,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const vt = await tx.verifiedTransaction.findUnique({ where: { id } });
      if (vt === null) throw new AppError('ORDER_NOT_FOUND', 'Verification not found.');

      await tx.verifiedTransaction.delete({ where: { id } });
      await tx.paymentRequest.update({
        where: { id: vt.payment_request_id },
        data: { status: 'PENDING', verified_at: null },
      });
      await tx.smsLog.update({
        where: { id: vt.sms_log_id },
        data: { match_status: 'UNMATCHED' },
      });
      return vt;
    });

    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin?.adminId,
      action: 'verification.void',
      entityType: 'verified_transaction',
      entityId: id,
      before: { payment_request_id: result.payment_request_id, sms_log_id: result.sms_log_id },
      after: { reason: dto.reason },
      companyId: result.company_id,
    });

    return {
      voided: id,
      payment_request_id: result.payment_request_id,
      sms_log_id: result.sms_log_id,
      order_status: 'PENDING',
    };
  }
}
