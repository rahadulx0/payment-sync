import { Injectable } from '@nestjs/common';
import { AppError, Money } from '@paysync/shared';

import { PrismaService } from '../../common/prisma/prisma.service.js';

/**
 * Read models for the operations dashboard (Task 12). These are the queries that
 * answer "why wasn't this order verified?" without touching the database — the
 * SMS-log and order lists plus the drill-downs that assemble the raw message,
 * the server extraction, the full `match_attempts` trace, the verification, and
 * the webhook attempts in one shot.
 */
@Injectable()
export class OpsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSmsLogs(q: {
    companyId?: string | undefined;
    provider?: string | undefined;
    parseStatus?: string | undefined;
    matchStatus?: string | undefined;
    search?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) {
    const take = Math.min(q.limit ?? 50, 100);
    const rows = await this.prisma.smsLog.findMany({
      where: {
        ...(q.companyId !== undefined ? { company_id: q.companyId } : {}),
        ...(q.provider !== undefined ? { provider: q.provider as never } : {}),
        ...(q.parseStatus !== undefined ? { parse_status: q.parseStatus as never } : {}),
        ...(q.matchStatus !== undefined ? { match_status: q.matchStatus as never } : {}),
        ...(q.search !== undefined
          ? {
              OR: [
                { transaction_id: { contains: q.search, mode: 'insensitive' } },
                { sender_msisdn: { contains: q.search } },
                { raw_message: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor !== undefined ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        company_id: true,
        provider: true,
        sms_address: true,
        transaction_id: true,
        amount: true,
        sender_msisdn: true,
        parse_status: true,
        parse_confidence: true,
        match_status: true,
        flags: true,
        upload_source: true,
        sms_timestamp: true,
        device_received_at: true,
        created_at: true,
      },
    });
    const items = rows.slice(0, take).map((r) => ({
      ...r,
      amount: r.amount === null ? null : Money.fromPrismaDecimal(r.amount).toDecimalString(),
    }));
    return { items, next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
  }

  /** The decision-trace drill-down: raw SMS + extraction + attempts + verification + webhooks. */
  async smsDetail(id: string) {
    const sms = await this.prisma.smsLog.findUnique({
      where: { id },
      include: { verifiedTransaction: true },
    });
    if (sms === null) throw new AppError('ORDER_NOT_FOUND', 'SMS not found.');
    const attempts = await this.prisma.matchAttempt.findMany({
      where: { sms_log_id: id },
      orderBy: { created_at: 'desc' },
    });
    const webhooks =
      sms.verifiedTransaction === null
        ? []
        : await this.prisma.webhookEvent.findMany({
            where: { payment_request_id: sms.verifiedTransaction.payment_request_id },
            include: { deliveries: { orderBy: { attempt_no: 'asc' } } },
          });
    return {
      sms: {
        ...sms,
        amount: sms.amount === null ? null : Money.fromPrismaDecimal(sms.amount).toDecimalString(),
        balance_after:
          sms.balance_after === null
            ? null
            : Money.fromPrismaDecimal(sms.balance_after).toDecimalString(),
        fee: sms.fee === null ? null : Money.fromPrismaDecimal(sms.fee).toDecimalString(),
      },
      attempts,
      verification: sms.verifiedTransaction,
      webhooks,
    };
  }

  async listOrders(q: {
    companyId?: string | undefined;
    status?: string | undefined;
    search?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) {
    const take = Math.min(q.limit ?? 50, 100);
    const rows = await this.prisma.paymentRequest.findMany({
      where: {
        ...(q.companyId !== undefined ? { company_id: q.companyId } : {}),
        ...(q.status !== undefined ? { status: q.status as never } : {}),
        ...(q.search !== undefined
          ? {
              OR: [
                { order_id: { contains: q.search } },
                { transaction_id: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor !== undefined ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take).map((pr) => ({
      id: pr.id,
      order_id: pr.order_id,
      company_id: pr.company_id,
      status: pr.status,
      match_mode: pr.match_mode,
      amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
      transaction_id: pr.transaction_id,
      provider: pr.expected_provider,
      created_at: pr.created_at,
      expires_at: pr.expires_at,
      verified_at: pr.verified_at,
    }));
    return { items, next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
  }

  /** Order drill-down: registration + verification + the trace of its candidate attempts + webhooks. */
  async orderDetail(id: string) {
    const order = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { verifiedTransaction: true },
    });
    if (order === null) throw new AppError('ORDER_NOT_FOUND', 'Order not found.');
    const attempts = await this.prisma.matchAttempt.findMany({
      where: { payment_request_id: id },
      orderBy: { created_at: 'desc' },
    });
    const webhooks = await this.prisma.webhookEvent.findMany({
      where: { payment_request_id: id },
      include: { deliveries: { orderBy: { attempt_no: 'asc' } } },
    });
    return {
      order: {
        ...order,
        expected_amount: Money.fromPrismaDecimal(order.expected_amount).toDecimalString(),
      },
      attempts,
      verification: order.verifiedTransaction,
      webhooks,
    };
  }
}
