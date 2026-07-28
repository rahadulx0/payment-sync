import { Injectable, Logger } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';

import { MetricsService } from '../common/metrics/metrics.service.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { DeliveryService } from '../modules/webhooks/delivery/delivery.service.js';

const BATCH = 200;

/**
 * At-least-once delivery driver (architecture §14, Task 09 §4.4). Task 16
 * schedules `tick()` every 60s. It claims due PENDING events and delivers them —
 * which is what makes delivery survive a crash between the verifying commit and
 * any enqueue: nothing is lost, the sweeper always finds it.
 */
@Injectable()
export class WebhookSweeperProcessor {
  private readonly log = new Logger(WebhookSweeperProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly metrics: MetricsService,
  ) {}

  async tick(): Promise<number> {
    const now = nowUtc();
    const due = await this.prisma.webhookEvent.findMany({
      where: { status: 'PENDING', paused: false, next_attempt_at: { lte: now } },
      orderBy: { next_attempt_at: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    this.metrics.webhookQueueDepth.set(due.length);
    for (const e of due) {
      await this.delivery.deliverEvent(e.id);
    }
    if (due.length > 0)
      this.log.log(`webhook sweep delivered/attempted ${String(due.length)} events`);
    return due.length;
  }
}
