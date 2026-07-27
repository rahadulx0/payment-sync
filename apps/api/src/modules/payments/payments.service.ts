import { Inject, Injectable } from '@nestjs/common';
import { normalizeMsisdn, normalizeTrxId } from '@paysync/parsers';
import {
  AppError,
  Money,
  type PaymentListResponse,
  type PaymentStatusResponse,
  type RegisterPaymentResponse,
} from '@paysync/shared';
import { type PaymentRequest, Prisma } from '@prisma/client';

import { SafeUrlService } from '../../common/http/safe-url.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

import { CorrectTrxidDto, RegisterPaymentDto } from './dto.js';
import {
  type PaymentMatchingHook,
  PAYMENT_MATCHING_HOOK,
  type RegisterOutcome,
} from './matching.hook.js';

const MAX_AMOUNT_PAISA = 9_999_999_999; // 99,999,999.99
const METADATA_MAX_BYTES = 4096;
const LATE_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safeUrl: SafeUrlService,
    @Inject(PAYMENT_MATCHING_HOOK) private readonly matching: PaymentMatchingHook,
  ) {}

  async register(
    companyId: string,
    dto: RegisterPaymentDto,
  ): Promise<{ body: RegisterPaymentResponse; httpStatus: 200 | 201 }> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { settings: true },
    });
    const settings = company.settings;
    if (settings === null) throw new AppError('INTERNAL_ERROR', 'Company settings missing.');

    let amount: Money;
    try {
      amount = Money.fromDecimalString(dto.amount);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid amount.');
    }
    if (!amount.isPositive() || amount.toPaisa() > MAX_AMOUNT_PAISA) {
      throw new AppError('VALIDATION_ERROR', 'Amount out of range.');
    }

    let trx: string | null = null;
    if (dto.transaction_id !== undefined) {
      trx = normalizeTrxId(dto.transaction_id);
      if (trx === null) throw new AppError('VALIDATION_ERROR', 'Invalid transaction_id.');
    }
    const mode = trx !== null ? 'EXACT' : 'HEURISTIC';
    if (mode === 'HEURISTIC' && !settings.heuristic_enabled) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Heuristic matching is disabled; a transaction_id is required.',
      );
    }

    let sender: string | null = null;
    if (dto.sender_msisdn !== undefined) {
      sender = normalizeMsisdn(dto.sender_msisdn);
      if (sender === null) throw new AppError('VALIDATION_ERROR', 'Invalid sender_msisdn.');
    }
    if (dto.provider !== undefined && !settings.allowed_providers.includes(dto.provider)) {
      throw new AppError('VALIDATION_ERROR', 'Provider not allowed for this company.');
    }

    const callbackRaw = dto.callback_url ?? company.default_callback_url;
    if (callbackRaw === null || callbackRaw.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'callback_url is required (no default configured).');
    }
    await this.safeUrl.validate(callbackRaw);

    if (dto.metadata !== undefined && JSON.stringify(dto.metadata).length > METADATA_MAX_BYTES) {
      throw new AppError('PAYLOAD_TOO_LARGE', 'metadata exceeds 4 KB.');
    }

    const expiresAt = new Date(Date.now() + settings.order_ttl_minutes * 60_000);
    try {
      const pr = await this.prisma.paymentRequest.create({
        data: {
          company_id: companyId,
          order_id: dto.order_id,
          transaction_id: trx,
          expected_amount: amount.toDecimalString(),
          expected_provider: dto.provider ?? null,
          expected_sender_msisdn: sender,
          callback_url: callbackRaw,
          match_mode: mode,
          amount_tolerance: settings.amount_tolerance,
          ...(dto.metadata !== undefined
            ? { metadata: dto.metadata as Prisma.InputJsonValue }
            : {}),
          expires_at: expiresAt,
        },
      });
      const outcome = await this.matching.onOrderRegistered(pr.id);
      const final =
        outcome.status === 'VERIFIED'
          ? await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: pr.id } })
          : pr;
      return { body: this.toRegisterResponse(final, outcome), httpStatus: 201 };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      // Distinguish the natural order_id key from the live-TrxID key.
      const existing = await this.prisma.paymentRequest.findFirst({
        where: { company_id: companyId, order_id: dto.order_id },
      });
      if (existing !== null) {
        if (this.isIdenticalOrder(existing, dto, trx, amount)) {
          return { body: this.toRegisterResponse(existing), httpStatus: 200 };
        }
        throw new AppError('DUPLICATE_ORDER_ID', 'order_id already used with a different payload.');
      }
      throw new AppError(
        'DUPLICATE_TRANSACTION_ID',
        'This transaction_id is already claimed by a live order.',
      );
    }
  }

  private isIdenticalOrder(
    existing: PaymentRequest,
    dto: RegisterPaymentDto,
    trx: string | null,
    amount: Money,
  ): boolean {
    return (
      existing.transaction_id === trx &&
      Money.fromPrismaDecimal(existing.expected_amount).equals(amount) &&
      (existing.expected_provider ?? null) === (dto.provider ?? null)
    );
  }

  async get(companyId: string, orderId: string): Promise<PaymentStatusResponse> {
    const pr = await this.prisma.paymentRequest.findFirst({
      where: { company_id: companyId, order_id: orderId },
      include: { verifiedTransaction: true },
    });
    if (pr === null) throw new AppError('ORDER_NOT_FOUND', 'Order not found.');
    return this.toStatusResponse(pr);
  }

  async cancel(companyId: string, orderId: string): Promise<{ order_id: string; status: string }> {
    const pr = await this.prisma.paymentRequest.findFirst({
      where: { company_id: companyId, order_id: orderId },
    });
    if (pr === null) throw new AppError('ORDER_NOT_FOUND', 'Order not found.');
    if (pr.status !== 'PENDING') {
      throw new AppError('ORDER_NOT_PENDING', `Order is ${pr.status}, cannot cancel.`);
    }
    await this.prisma.paymentRequest.update({
      where: { id: pr.id },
      data: { status: 'CANCELLED' },
    });
    return { order_id: orderId, status: 'CANCELLED' };
  }

  /** ADR-14: correct a mistyped TrxID while PENDING or EXPIRED-in-grace; never after VERIFIED. */
  async correctTransactionId(companyId: string, orderId: string, dto: CorrectTrxidDto) {
    const pr = await this.prisma.paymentRequest.findFirst({
      where: { company_id: companyId, order_id: orderId },
    });
    if (pr === null) throw new AppError('ORDER_NOT_FOUND', 'Order not found.');

    const withinGrace =
      pr.status === 'EXPIRED' && pr.expires_at.getTime() > Date.now() - LATE_GRACE_MS;
    if (pr.status !== 'PENDING' && !withinGrace) {
      throw new AppError(
        'ORDER_NOT_PENDING',
        `Order is ${pr.status}; the transaction id can no longer be corrected.`,
      );
    }
    const trx = normalizeTrxId(dto.transaction_id);
    if (trx === null) throw new AppError('VALIDATION_ERROR', 'Invalid transaction_id.');

    try {
      await this.prisma.paymentRequest.update({
        where: { id: pr.id },
        data: { transaction_id: trx, match_mode: 'EXACT', status: 'PENDING' },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(
          'DUPLICATE_TRANSACTION_ID',
          'This transaction_id is already claimed by a live order.',
        );
      }
      throw e;
    }

    const outcome = await this.matching.onTrxIdCorrected(pr.id);
    const updated = await this.prisma.paymentRequest.findUniqueOrThrow({ where: { id: pr.id } });
    return {
      order_id: orderId,
      status: updated.status,
      transaction_id: trx,
      verified_now: outcome.status === 'VERIFIED',
      ...(updated.verified_at !== null ? { verified_at: updated.verified_at.toISOString() } : {}),
    };
  }

  async list(
    companyId: string,
    q: {
      status?: string | undefined;
      provider?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    },
  ): Promise<PaymentListResponse> {
    const take = Math.min(q.limit ?? 50, 100);
    const rows = await this.prisma.paymentRequest.findMany({
      where: {
        company_id: companyId,
        ...(q.status !== undefined ? { status: q.status as never } : {}),
        ...(q.provider !== undefined ? { expected_provider: q.provider as never } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor !== undefined ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take);
    const grouped = await this.prisma.paymentRequest.groupBy({
      by: ['status'],
      where: { company_id: companyId },
      _count: { _all: true },
    });
    const countByStatus: Record<string, number> = {};
    for (const g of grouped) countByStatus[g.status] = g._count._all;
    const verifiedTotal = await this.prisma.paymentRequest.aggregate({
      where: { company_id: companyId, status: 'VERIFIED' },
      _sum: { expected_amount: true },
    });
    return {
      items: items.map((pr) => ({
        order_id: pr.order_id,
        status: pr.status,
        amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
        transaction_id: pr.transaction_id,
        provider: pr.expected_provider,
        created_at: pr.created_at.toISOString(),
        verified_at: pr.verified_at?.toISOString() ?? null,
      })),
      next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null,
      summary: {
        count_by_status: countByStatus,
        total_verified_amount: Money.fromPrismaDecimal(
          verifiedTotal._sum.expected_amount ?? 0,
        ).toDecimalString(),
      },
    };
  }

  private toRegisterResponse(
    pr: PaymentRequest,
    outcome?: RegisterOutcome,
  ): RegisterPaymentResponse {
    return {
      payment_request_id: pr.id,
      order_id: pr.order_id,
      status: pr.status,
      match_mode: pr.match_mode,
      amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
      transaction_id: pr.transaction_id,
      expires_at: pr.expires_at.toISOString(),
      created_at: pr.created_at.toISOString(),
      ...(pr.verified_at !== null ? { verified_at: pr.verified_at.toISOString() } : {}),
      ...(outcome?.status === 'VERIFIED' && pr.verified_at !== null
        ? {
            verification: {
              method: 'EXACT_TXN_ID' as const,
              confidence: 1,
              sender_msisdn: pr.expected_sender_msisdn,
              provider: pr.expected_provider,
              received_amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
              was_late: false,
            },
          }
        : {}),
    };
  }

  private toStatusResponse(
    pr: PaymentRequest & {
      verifiedTransaction: {
        verification_method: string;
        confidence: unknown;
        was_late: boolean;
        amount_delta: unknown;
      } | null;
    },
  ): PaymentStatusResponse {
    return {
      order_id: pr.order_id,
      status: pr.status,
      amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
      transaction_id: pr.transaction_id,
      provider: pr.expected_provider,
      match_mode: pr.match_mode,
      expires_at: pr.expires_at.toISOString(),
      created_at: pr.created_at.toISOString(),
      ...(pr.verified_at !== null ? { verified_at: pr.verified_at.toISOString() } : {}),
    };
  }
}
