import { Injectable } from '@nestjs/common';
import { nowUtc, uuidv7, type WebhookEventType } from '@paysync/shared';
import { type Company, Prisma } from '@prisma/client';

import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

import { buildEnvelope } from './signing/payload.js';

type Tx = Prisma.TransactionClient;

export interface CreateEventInput {
  company: Company;
  type: WebhookEventType;
  paymentRequestId: string | null;
  callbackUrl: string | null;
  data: Record<string, unknown>;
}

/**
 * Creates `webhook_events` rows with the body frozen at creation (Task 09 §4.2).
 * Callers pass their own transaction (verification, expiry, review) so the event
 * commits atomically with the state change it announces. Delivery is a separate,
 * post-commit concern (the sweeper / worker).
 */
@Injectable()
export class WebhookEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async createInTx(tx: Tx, input: CreateEventInput): Promise<string> {
    const now = nowUtc();
    const id = uuidv7();
    const { envelope, raw } = buildEnvelope(id, input.type, now.toISOString(), input.data);

    // No callback configured is a client misconfiguration, not a silent drop.
    if (input.callbackUrl === null || input.callbackUrl.length === 0) {
      await tx.webhookEvent.create({
        data: {
          id,
          company_id: input.company.id,
          payment_request_id: input.paymentRequestId,
          event_type: input.type,
          payload: envelope as unknown as Prisma.InputJsonValue,
          payload_raw: raw,
          status: 'CANCELLED',
          reason: 'NO_CALLBACK_URL',
        },
      });
      this.metrics.webhookEvents.inc({ type: input.type });
      return id;
    }

    // SUSPENDED / DISABLED companies: create the event but hold it paused until reactivation.
    const paused = input.company.status !== 'ACTIVE';
    await tx.webhookEvent.create({
      data: {
        id,
        company_id: input.company.id,
        payment_request_id: input.paymentRequestId,
        event_type: input.type,
        payload: envelope as unknown as Prisma.InputJsonValue,
        payload_raw: raw,
        callback_url: input.callbackUrl,
        status: 'PENDING',
        next_attempt_at: paused ? null : now,
        paused,
      },
    });
    this.metrics.webhookEvents.inc({ type: input.type });
    return id;
  }
}
