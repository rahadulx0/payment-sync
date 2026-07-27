import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service.js';

/**
 * PENDING → EXPIRED sweeper. An EXPIRED order stays matchable within
 * late_match_grace_hours (architecture §5.4); this only flips the status.
 * Wired to a repeatable BullMQ job in Task 16.
 */
@Injectable()
export class ExpiryService {
  constructor(private readonly prisma: PrismaService) {}

  async sweep(now: Date = new Date()): Promise<number> {
    const res = await this.prisma.paymentRequest.updateMany({
      where: { status: 'PENDING', expires_at: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    return res.count;
  }
}
