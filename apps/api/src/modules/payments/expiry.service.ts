import { Injectable } from '@nestjs/common';
import { Money, nowUtc } from '@paysync/shared';

import { PrismaService } from '../../common/prisma/prisma.service.js';
import { WebhookEventService } from '../webhooks/event.service.js';

const BATCH = 500;

/**
 * PENDING → EXPIRED sweeper. An EXPIRED order stays matchable within
 * late_match_grace_hours (architecture §5.4); this flips the status and, when
 * the company has `notify_on_expiry`, emits a `payment.expired` webhook in the
 * same transaction. Wired to a repeatable BullMQ job in Task 16.
 */
@Injectable()
export class ExpiryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: WebhookEventService,
  ) {}

  async sweep(now: Date = nowUtc()): Promise<number> {
    const due = await this.prisma.paymentRequest.findMany({
      where: { status: 'PENDING', expires_at: { lt: now } },
      include: { company: { include: { settings: true } } },
      take: BATCH,
    });

    let count = 0;
    for (const pr of due) {
      const flipped = await this.prisma.$transaction(async (tx) => {
        const upd = await tx.paymentRequest.updateMany({
          where: { id: pr.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        if (upd.count === 0) return false;
        if (pr.company.settings?.notify_on_expiry === true) {
          await this.events.createInTx(tx, {
            company: pr.company,
            type: 'payment.expired',
            paymentRequestId: pr.id,
            callbackUrl: pr.callback_url,
            data: {
              status: 'EXPIRED',
              order_id: pr.order_id,
              payment_request_id: pr.id,
              amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
              expires_at: pr.expires_at.toISOString(),
            },
          });
        }
        return true;
      });
      if (flipped) count++;
    }
    return count;
  }
}
