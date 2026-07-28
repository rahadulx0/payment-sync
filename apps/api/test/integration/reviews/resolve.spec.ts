import type { INestApplication } from '@nestjs/common';
import { AppError, uuidv7 } from '@paysync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { createApp } from '../../../src/main.js';
import { MatchingService } from '../../../src/modules/matching/matching.service.js';
import { ResolveService } from '../../../src/modules/reviews/resolve.service.js';
import { createTestDb, dropTestDb, truncateAll, type TestDb } from '../../db/harness.js';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let matching: MatchingService;
let resolver: ResolveService;

const T0 = new Date('2026-05-01T10:00:00.000Z');
const ADMIN = uuidv7();

async function setupAmbiguousReview(): Promise<{
  company: string;
  smsId: string;
  orderA: string;
  orderB: string;
  reviewId: string;
}> {
  const c = await prisma.company.create({
    data: { company_code: `C-${uuidv7().slice(0, 8)}`, name: 'R', settings: { create: {} } },
  });
  const mk = () =>
    prisma.paymentRequest.create({
      data: {
        company_id: c.id,
        order_id: `ORD-${uuidv7()}`,
        expected_amount: '1000.00',
        callback_url: 'https://m.example.com/hook',
        match_mode: 'HEURISTIC',
        amount_tolerance: '0.00',
        status: 'PENDING',
        created_at: T0,
        expires_at: new Date(T0.getTime() + 3600_000),
      },
    });
  const a = await mk();
  const b = await mk();
  const sms = await prisma.smsLog.create({
    data: {
      company_id: c.id,
      client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      content_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      sms_address: 'bKash',
      provider: 'BKASH',
      raw_message: 'Cash In',
      amount: '1000.00',
      sender_msisdn: '+8801711111111',
      sms_timestamp: T0,
      device_received_at: T0,
      parse_status: 'PARSED',
      match_status: 'UNMATCHED',
    },
  });
  await matching.matchBySms(sms.id);
  const review = await prisma.matchReview.findFirstOrThrow({ where: { company_id: c.id } });
  return { company: c.id, smsId: sms.id, orderA: a.id, orderB: b.id, reviewId: review.id };
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 8).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'rev-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'rev-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  await seed(db.prisma, {
    isProd: false,
    seedDev: false,
    adminEmail: 'a@b.co',
    adminPassword: 'seedpassword1',
  });
  app = await createApp();
  await app.init();
  prisma = app.get(PrismaService);
  matching = app.get(MatchingService);
  resolver = app.get(ResolveService);
});
afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});
beforeEach(async () => {
  await truncateAll(db.prisma as unknown as Parameters<typeof truncateAll>[0]);
});

describe('review resolution', () => {
  it('resolve-by-link verifies the chosen order and emits a MANUAL_ADMIN webhook', async () => {
    const s = await setupAmbiguousReview();
    const res = await resolver.resolve(
      s.reviewId,
      {
        note: 'confirmed with merchant',
        link_sms_log_id: s.smsId,
        link_payment_request_id: s.orderA,
      },
      ADMIN,
    );
    expect(res.verified).toBe(true);
    const order = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: s.orderA } });
    expect(order.status).toBe('VERIFIED');
    const vt = await prisma.verifiedTransaction.findFirstOrThrow({
      where: { payment_request_id: s.orderA },
    });
    expect(vt.verification_method).toBe('MANUAL_ADMIN');
    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { payment_request_id: s.orderA, event_type: 'payment.verified' },
    });
    expect(event.status).toBe('PENDING');
    // The other order is untouched.
    expect(
      (await prisma.paymentRequest.findUniqueOrThrow({ where: { id: s.orderB } })).status,
    ).toBe('PENDING');
  });

  it('resolving twice → conflict (idempotent), no second verification', async () => {
    const s = await setupAmbiguousReview();
    await resolver.resolve(
      s.reviewId,
      { note: 'first', link_sms_log_id: s.smsId, link_payment_request_id: s.orderA },
      ADMIN,
    );
    await expect(
      resolver.resolve(
        s.reviewId,
        { note: 'again', link_sms_log_id: s.smsId, link_payment_request_id: s.orderA },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await prisma.verifiedTransaction.count({ where: { company_id: s.company } })).toBe(1);
  });

  it('resolve-by-dismiss closes the review and leaves the SMS re-matchable', async () => {
    const s = await setupAmbiguousReview();
    const res = await resolver.resolve(
      s.reviewId,
      { note: 'not ours', dismiss_reason: 'duplicate' },
      ADMIN,
    );
    expect(res.verified).toBe(false);
    expect((await prisma.matchReview.findUniqueOrThrow({ where: { id: s.reviewId } })).status).toBe(
      'DISMISSED',
    );
    expect((await prisma.smsLog.findUniqueOrThrow({ where: { id: s.smsId } })).match_status).toBe(
      'UNMATCHED',
    );
  });

  it('re-validates order state: linking a cancelled order fails, no verification', async () => {
    const s = await setupAmbiguousReview();
    await prisma.paymentRequest.update({ where: { id: s.orderA }, data: { status: 'CANCELLED' } });
    await expect(
      resolver.resolve(
        s.reviewId,
        { note: 'x', link_sms_log_id: s.smsId, link_payment_request_id: s.orderA },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(await prisma.verifiedTransaction.count({ where: { company_id: s.company } })).toBe(0);
  });
});
