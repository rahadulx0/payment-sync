import { Injectable } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service.js';

import { AnalyticsCache } from './cache.js';

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function since(range: string): Date {
  const days = RANGE_DAYS[range] ?? 30;
  return new Date(nowUtc().getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Admin analytics (architecture §12 / Task 10 §4.6). Hand-written SQL aggregates
 * behind a 60s cache; day boundaries are Asia/Dhaka; every response carries
 * `as_of`. These are the numbers daily operations and the dashboard depend on.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AnalyticsCache,
  ) {}

  overview(range = '30d') {
    return this.cache.wrap(`overview:${range}`, async () => {
      const from = since(range);
      const [orders] = await this.prisma.$queryRaw<
        { verified: bigint; verified_amount: string | null; pending: bigint; total: bigint }[]
      >`
        SELECT
          count(*) FILTER (WHERE status = 'VERIFIED')::bigint AS verified,
          coalesce(sum(expected_amount) FILTER (WHERE status = 'VERIFIED'), 0)::text AS verified_amount,
          count(*) FILTER (WHERE status = 'PENDING')::bigint AS pending,
          count(*)::bigint AS total
        FROM payment_requests WHERE created_at >= ${from}`;
      const [reviews] = await this.prisma.$queryRaw<{ open: bigint }[]>`
        SELECT count(*)::bigint AS open FROM match_reviews WHERE status = 'OPEN'`;
      const [dead] = await this.prisma.$queryRaw<{ dead: bigint }[]>`
        SELECT count(*)::bigint AS dead FROM webhook_events WHERE status = 'DEAD'`;
      const [unmatched] = await this.prisma.$queryRaw<{ unmatched: bigint }[]>`
        SELECT count(*)::bigint AS unmatched FROM sms_logs WHERE match_status = 'UNMATCHED'`;
      const verified = Number(orders?.verified ?? 0n);
      const total = Number(orders?.total ?? 0n);
      return {
        range,
        verified,
        verified_amount: orders?.verified_amount ?? '0',
        pending: Number(orders?.pending ?? 0n),
        success_rate: total > 0 ? verified / total : null,
        open_reviews: Number(reviews?.open ?? 0n),
        dead_webhooks: Number(dead?.dead ?? 0n),
        unmatched_sms: Number(unmatched?.unmatched ?? 0n),
        as_of: nowUtc().toISOString(),
      };
    });
  }

  providers(range = '30d') {
    return this.cache.wrap(`providers:${range}`, async () => {
      const from = since(range);
      const rows = await this.prisma.$queryRaw<
        { provider: string; received: bigint; parsed: bigint; ignored: bigint; matched: bigint }[]
      >`
        SELECT provider::text AS provider,
               count(*)::bigint AS received,
               count(*) FILTER (WHERE parse_status = 'PARSED')::bigint AS parsed,
               count(*) FILTER (WHERE parse_status = 'IGNORED')::bigint AS ignored,
               count(*) FILTER (WHERE match_status = 'MATCHED')::bigint AS matched
          FROM sms_logs WHERE uploaded_at >= ${from}
         GROUP BY provider ORDER BY received DESC`;
      return {
        range,
        providers: rows.map((r) => ({
          provider: r.provider,
          received: Number(r.received),
          parsed: Number(r.parsed),
          ignored: Number(r.ignored),
          matched: Number(r.matched),
          parse_failure_rate:
            Number(r.received) > 0 ? 1 - Number(r.parsed) / Number(r.received) : 0,
        })),
        as_of: nowUtc().toISOString(),
      };
    });
  }

  daily(range = '30d', companyId?: string) {
    return this.cache.wrap(`daily:${range}:${companyId ?? 'all'}`, async () => {
      const from = since(range);
      const rows = await this.prisma.$queryRaw<
        {
          day: string;
          registered: bigint;
          verified: bigint;
          expired: bigint;
          amount: string | null;
        }[]
      >`
        SELECT (created_at AT TIME ZONE 'Asia/Dhaka')::date::text AS day,
               count(*)::bigint AS registered,
               count(*) FILTER (WHERE status = 'VERIFIED')::bigint AS verified,
               count(*) FILTER (WHERE status = 'EXPIRED')::bigint AS expired,
               coalesce(sum(expected_amount) FILTER (WHERE status = 'VERIFIED'), 0)::text AS amount
          FROM payment_requests
         WHERE created_at >= ${from}
           ${companyId !== undefined ? this.and(companyId) : this.noop()}
         GROUP BY day ORDER BY day`;
      return {
        range,
        days: rows.map((r) => ({
          day: r.day,
          registered: Number(r.registered),
          verified: Number(r.verified),
          expired: Number(r.expired),
          amount: r.amount ?? '0',
          success_rate: Number(r.registered) > 0 ? Number(r.verified) / Number(r.registered) : null,
        })),
        as_of: nowUtc().toISOString(),
      };
    });
  }

  funnel(range = '30d') {
    return this.cache.wrap(`funnel:${range}`, async () => {
      const from = since(range);
      const [row] = await this.prisma.$queryRaw<
        { registered: bigint; verified: bigint; expired: bigint; cancelled: bigint }[]
      >`
        SELECT count(*)::bigint AS registered,
               count(*) FILTER (WHERE status = 'VERIFIED')::bigint AS verified,
               count(*) FILTER (WHERE status = 'EXPIRED')::bigint AS expired,
               count(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled
          FROM payment_requests WHERE created_at >= ${from}`;
      const [delivered] = await this.prisma.$queryRaw<{ delivered: bigint }[]>`
        SELECT count(*)::bigint AS delivered FROM webhook_events
         WHERE event_type = 'payment.verified' AND status = 'DELIVERED' AND created_at >= ${from}`;
      return {
        range,
        stages: {
          registered: Number(row?.registered ?? 0n),
          verified: Number(row?.verified ?? 0n),
          webhook_delivered: Number(delivered?.delivered ?? 0n),
          expired: Number(row?.expired ?? 0n),
          cancelled: Number(row?.cancelled ?? 0n),
        },
        as_of: nowUtc().toISOString(),
      };
    });
  }

  verificationMethods(range = '30d') {
    return this.cache.wrap(`methods:${range}`, async () => {
      const from = since(range);
      const rows = await this.prisma.$queryRaw<
        { method: string; count: bigint; mean_confidence: string | null }[]
      >`
        SELECT verification_method::text AS method,
               count(*)::bigint AS count,
               avg(confidence)::text AS mean_confidence
          FROM verified_transactions WHERE verified_at >= ${from}
         GROUP BY method`;
      return {
        range,
        methods: rows.map((r) => ({
          method: r.method,
          count: Number(r.count),
          mean_confidence: r.mean_confidence === null ? null : Number(r.mean_confidence),
        })),
        as_of: nowUtc().toISOString(),
      };
    });
  }

  companies(range = '30d') {
    return this.cache.wrap(`companies:${range}`, async () => {
      const from = since(range);
      const rows = await this.prisma.$queryRaw<
        { company_id: string; company_code: string; registered: bigint; verified: bigint }[]
      >`
        SELECT c.id::text AS company_id, c.company_code,
               count(pr.id)::bigint AS registered,
               count(pr.id) FILTER (WHERE pr.status = 'VERIFIED')::bigint AS verified
          FROM companies c
          LEFT JOIN payment_requests pr ON pr.company_id = c.id AND pr.created_at >= ${from}
         GROUP BY c.id, c.company_code
         ORDER BY registered DESC`;
      return {
        range,
        companies: rows.map((r) => ({
          company_id: r.company_id,
          company_code: r.company_code,
          registered: Number(r.registered),
          verified: Number(r.verified),
          success_rate: Number(r.registered) > 0 ? Number(r.verified) / Number(r.registered) : null,
        })),
        as_of: nowUtc().toISOString(),
      };
    });
  }

  parserHealth() {
    return this.cache.wrap('parser-health', async () => {
      const rows = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`
        SELECT parse_status::text AS status, count(*)::bigint AS count FROM sms_logs GROUP BY status`;
      return {
        by_status: Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])),
        as_of: nowUtc().toISOString(),
      };
    });
  }

  private and(companyId: string): Prisma.Sql {
    return Prisma.sql`AND company_id = ${companyId}::uuid`;
  }
  private noop(): Prisma.Sql {
    return Prisma.empty;
  }
}
