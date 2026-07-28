import { Injectable } from '@nestjs/common';
import { AppError, Money, nowUtc, uuidv7, type WebhookVerifiedData } from '@paysync/shared';
import { Prisma } from '@prisma/client';

import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService } from '../admin/audit/audit.service.js';
import { buildEnvelope } from '../webhooks/signing/payload.js';

import type { ResolveReviewDto } from './dto.js';

/**
 * Manual review resolution (Task 10 §4.5). Two paths — link (verify against an
 * order via the MANUAL_ADMIN method) or dismiss — both requiring a note, both
 * audited, both idempotent. Resolution re-validates the order state INSIDE the
 * transaction so a race can never double-credit: if the order was verified or
 * cancelled meanwhile, the resolve fails with a clear conflict.
 */
@Injectable()
export class ResolveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  async resolve(reviewId: string, dto: ResolveReviewDto, adminId: string | undefined, ip?: string) {
    const review = await this.prisma.matchReview.findUnique({ where: { id: reviewId } });
    if (review === null) throw new AppError('ORDER_NOT_FOUND', 'Review not found.');
    if (review.status !== 'OPEN') {
      // Idempotent: resolving twice returns the existing resolution as a conflict.
      throw new AppError('ORDER_NOT_PENDING', `Review already ${review.status}.`, {
        status: review.status,
        resolution_note: review.resolution_note,
      });
    }

    const isLink = dto.link_payment_request_id !== undefined && dto.link_sms_log_id !== undefined;
    if (isLink) return this.resolveLink(review.id, dto, review.company_id, adminId, ip);
    if (dto.dismiss_reason !== undefined)
      return this.resolveDismiss(review.id, dto, review.company_id, adminId, ip);
    throw new AppError(
      'VALIDATION_ERROR',
      'Provide either a link (sms + order) or a dismiss_reason.',
    );
  }

  private async resolveLink(
    reviewId: string,
    dto: ResolveReviewDto,
    companyId: string,
    adminId: string | undefined,
    ip?: string,
  ) {
    const now = nowUtc();
    const smsLogId = dto.link_sms_log_id ?? '';
    const orderId = dto.link_payment_request_id ?? '';

    const eventId = uuidv7();
    try {
      await this.prisma.$transaction(async (tx) => {
        const order = await tx.paymentRequest.findUnique({ where: { id: orderId } });
        const sms = await tx.smsLog.findUnique({ where: { id: smsLogId } });
        if (
          order === null ||
          sms === null ||
          order.company_id !== companyId ||
          sms.company_id !== companyId
        ) {
          throw new AppError('ORDER_NOT_FOUND', 'Order or SMS not found for this company.');
        }
        // Re-validate INSIDE the tx — no double-crediting.
        if (order.status !== 'PENDING' && order.status !== 'EXPIRED') {
          throw new AppError('ORDER_NOT_PENDING', `Order is ${order.status}; cannot verify.`);
        }
        const received = sms.amount === null ? Money.zero() : Money.fromPrismaDecimal(sms.amount);
        const delta = received.subtract(Money.fromPrismaDecimal(order.expected_amount));

        await tx.verifiedTransaction.create({
          data: {
            company_id: companyId,
            payment_request_id: order.id,
            sms_log_id: sms.id,
            verification_method: 'MANUAL_ADMIN',
            confidence: 1,
            amount_delta: delta.toDecimalString(),
            was_late: order.status === 'EXPIRED',
            matched_by_admin_id: adminId ?? null,
            verified_at: now,
          },
        });
        await tx.paymentRequest.update({
          where: { id: order.id },
          data: { status: 'VERIFIED', verified_at: now },
        });
        await tx.smsLog.update({ where: { id: sms.id }, data: { match_status: 'MATCHED' } });
        await tx.matchReview.update({
          where: { id: reviewId },
          data: {
            status: 'RESOLVED',
            resolved_by: adminId ?? null,
            resolution_note: dto.note,
            resolved_at: now,
          },
        });

        const data: WebhookVerifiedData = {
          status: 'VERIFIED',
          order_id: order.order_id,
          payment_request_id: order.id,
          transaction_id: order.transaction_id,
          amount: received.toDecimalString(),
          expected_amount: Money.fromPrismaDecimal(order.expected_amount).toDecimalString(),
          provider: sms.provider,
          sender_msisdn: sms.sender_msisdn,
          verified_at: now.toISOString(),
          verification_method: 'MANUAL_ADMIN',
          confidence: 1,
          was_late: order.status === 'EXPIRED',
          metadata: (order.metadata as Record<string, unknown> | null) ?? {},
        };
        const { envelope, raw } = buildEnvelope(
          eventId,
          'payment.verified',
          now.toISOString(),
          data,
        );
        await tx.webhookEvent.create({
          data: {
            id: eventId,
            company_id: companyId,
            payment_request_id: order.id,
            event_type: 'payment.verified',
            payload: envelope as unknown as Prisma.InputJsonValue,
            payload_raw: raw,
            callback_url: order.callback_url,
            status: 'PENDING',
            next_attempt_at: now,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('ORDER_NOT_PENDING', 'That order or SMS is already verified.');
      }
      throw e;
    }

    await this.audit.record({
      actorType: 'ADMIN',
      actorId: adminId,
      action: 'review.resolve.link',
      entityType: 'match_review',
      entityId: reviewId,
      after: { payment_request_id: orderId, sms_log_id: smsLogId, note: dto.note },
      companyId,
      ip,
    });
    this.metrics.reviewsResolved.inc({ resolution: 'link' });
    return { review_id: reviewId, status: 'RESOLVED', verified: true };
  }

  private async resolveDismiss(
    reviewId: string,
    dto: ResolveReviewDto,
    companyId: string,
    adminId: string | undefined,
    ip?: string,
  ) {
    const now = nowUtc();
    const smsStatus = dto.not_a_payment === true ? 'IGNORED' : 'UNMATCHED';
    await this.prisma.$transaction(async (tx) => {
      const review = await tx.matchReview.findUniqueOrThrow({ where: { id: reviewId } });
      await tx.matchReview.update({
        where: { id: reviewId },
        data: {
          status: 'DISMISSED',
          resolved_by: adminId ?? null,
          resolution_note: dto.note,
          resolved_at: now,
        },
      });
      if (review.sms_log_id !== null) {
        await tx.smsLog.update({
          where: { id: review.sms_log_id },
          data: { match_status: smsStatus },
        });
      }
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: adminId,
      action: 'review.resolve.dismiss',
      entityType: 'match_review',
      entityId: reviewId,
      after: { dismiss_reason: dto.dismiss_reason, note: dto.note, sms_status: smsStatus },
      companyId,
      ip,
    });
    this.metrics.reviewsResolved.inc({ resolution: 'dismiss' });
    return { review_id: reviewId, status: 'DISMISSED', verified: false };
  }
}
