import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { createApp } from '../../../src/main.js';
import { VoidVerificationController } from '../../../src/modules/matching/admin/void-verification.controller.js';
import { InvariantsService } from '../../../src/modules/matching/invariants.service.js';
import { MatchingService } from '../../../src/modules/matching/matching.service.js';
import { createTestDb, dropTestDb, truncateAll, type TestDb } from '../../db/harness.js';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let matching: MatchingService;

const PAST = new Date('2026-05-01T10:00:00.000Z');

async function makeCompany(code: string): Promise<string> {
  const c = await prisma.company.create({
    data: { company_code: code, name: code, settings: { create: {} } },
  });
  return c.id;
}
async function makeOrder(
  companyId: string,
  over: Partial<{
    order_id: string;
    transaction_id: string;
    expected_amount: string;
    status: string;
    expires_at: Date;
  }> = {},
): Promise<string> {
  const pr = await prisma.paymentRequest.create({
    data: {
      company_id: companyId,
      order_id: over.order_id ?? `ORD-${uuidv7()}`,
      transaction_id: over.transaction_id ?? 'TRX0000001',
      expected_amount: over.expected_amount ?? '1000.00',
      callback_url: 'https://m.example.com/hook',
      match_mode: 'EXACT',
      amount_tolerance: '0.00',
      status: (over.status ?? 'PENDING') as never,
      expires_at: over.expires_at ?? new Date(Date.now() + 3600_000),
    },
  });
  return pr.id;
}
async function makeCreditSms(companyId: string, trxId: string, amount: string): Promise<string> {
  const s = await prisma.smsLog.create({
    data: {
      company_id: companyId,
      client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      content_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      sms_address: 'bKash',
      provider: 'BKASH',
      raw_message: `Cash In Tk ${amount} TrxID ${trxId}`,
      transaction_id: trxId,
      amount,
      sms_timestamp: PAST,
      device_received_at: PAST,
      parse_status: 'PARSED',
      match_status: 'UNMATCHED',
    },
  });
  return s.id;
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 5).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'run08-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'run08-refresh-secret-0123456789';
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
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

beforeEach(async () => {
  await truncateAll(db.prisma as unknown as Parameters<typeof truncateAll>[0]);
});

describe('matching runner', () => {
  it('register-then-SMS: ingest verifies, exactly one row each', async () => {
    const company = await makeCompany('C-1');
    await makeOrder(company, { transaction_id: 'AAA1111111', expected_amount: '1000.00' });
    const sms = await makeCreditSms(company, 'AAA1111111', '1000.00');

    const res = await matching.matchBySms(sms);
    expect(res.verified).toBe(true);
    expect(await prisma.verifiedTransaction.count({ where: { company_id: company } })).toBe(1);
  });

  it('two different SMS with the same TrxID: first verifies, second → DUPLICATE_TXN', async () => {
    const company = await makeCompany('C-2');
    await makeOrder(company, { transaction_id: 'BBB2222222', expected_amount: '500.00' });
    const s1 = await makeCreditSms(company, 'BBB2222222', '500.00');
    const s2 = await makeCreditSms(company, 'BBB2222222', '500.00');

    const r1 = await matching.matchBySms(s1);
    const r2 = await matching.matchBySms(s2);
    expect(r1.verified).toBe(true);
    expect(r2.result).toBe('DUPLICATE');
    expect(await prisma.verifiedTransaction.count({ where: { company_id: company } })).toBe(1);
  });

  it('20 concurrent matches + reverse matches on one order → exactly one verification', async () => {
    const company = await makeCompany('C-3');
    const order = await makeOrder(company, {
      transaction_id: 'CCC3333333',
      expected_amount: '100.00',
    });
    const smsIds = await Promise.all(
      Array.from({ length: 20 }, () => makeCreditSms(company, 'CCC3333333', '100.00')),
    );
    await Promise.all([
      ...smsIds.map((id) => matching.matchBySms(id)),
      ...Array.from({ length: 20 }, () => matching.reverseMatchOrder(order)),
    ]);
    expect(await prisma.verifiedTransaction.count({ where: { company_id: company } })).toBe(1);
    const pr = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: order } });
    expect(pr.status).toBe('VERIFIED');
  });

  it('late match: EXPIRED-in-grace order verifies with was_late true', async () => {
    const company = await makeCompany('C-4');
    await makeOrder(company, {
      transaction_id: 'DDD4444444',
      expected_amount: '250.00',
      status: 'EXPIRED',
      expires_at: new Date(Date.now() - 2 * 3600_000),
    });
    const sms = await makeCreditSms(company, 'DDD4444444', '250.00');
    const res = await matching.matchBySms(sms);
    expect(res.verified).toBe(true);
    const vt = await prisma.verifiedTransaction.findFirstOrThrow({
      where: { company_id: company },
    });
    expect(vt.was_late).toBe(true);
  });

  it('EXPIRED outside grace is never revived', async () => {
    const company = await makeCompany('C-5');
    await makeOrder(company, {
      transaction_id: 'EEE5555555',
      expected_amount: '250.00',
      status: 'EXPIRED',
      expires_at: new Date(Date.now() - 48 * 3600_000),
    });
    const sms = await makeCreditSms(company, 'EEE5555555', '250.00');
    const res = await matching.matchBySms(sms);
    expect(res.verified).toBe(false);
    expect(await prisma.verifiedTransaction.count({ where: { company_id: company } })).toBe(0);
  });

  it('cross-company matches run without blocking each other', async () => {
    const a = await makeCompany('C-6A');
    const b = await makeCompany('C-6B');
    await makeOrder(a, { transaction_id: 'FFFAAAAAA1', expected_amount: '10.00' });
    await makeOrder(b, { transaction_id: 'FFFBBBBBB1', expected_amount: '20.00' });
    const sa = await makeCreditSms(a, 'FFFAAAAAA1', '10.00');
    const sb = await makeCreditSms(b, 'FFFBBBBBB1', '20.00');
    const [ra, rb] = await Promise.all([matching.matchBySms(sa), matching.matchBySms(sb)]);
    expect(ra.verified && rb.verified).toBe(true);
  });

  it('void reverts the verification (order → PENDING, sms → UNMATCHED, vt gone)', async () => {
    const company = await makeCompany('C-7');
    const order = await makeOrder(company, {
      transaction_id: 'GGG7777777',
      expected_amount: '99.00',
    });
    const sms = await makeCreditSms(company, 'GGG7777777', '99.00');
    await matching.matchBySms(sms);
    const vt = await prisma.verifiedTransaction.findFirstOrThrow({
      where: { company_id: company },
    });

    const controller = app.get(VoidVerificationController);
    await controller.void(vt.id, { reason: 'chargeback investigation' }, { adminId: uuidv7() });

    expect(await prisma.verifiedTransaction.count({ where: { company_id: company } })).toBe(0);
    expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: order } })).status).toBe(
      'PENDING',
    );
    expect((await prisma.smsLog.findUniqueOrThrow({ where: { id: sms } })).match_status).toBe(
      'UNMATCHED',
    );
  });

  it('invariant checks are clean after normal matches', async () => {
    const company = await makeCompany('C-8');
    await makeOrder(company, { transaction_id: 'HHH8888888', expected_amount: '10.00' });
    const sms = await makeCreditSms(company, 'HHH8888888', '10.00');
    await matching.matchBySms(sms);
    const results = await app.get(InvariantsService).check();
    for (const r of results) expect(r.count).toBe(0);
  });

  it('invariant job detects a deliberately-broken state', async () => {
    const company = await makeCompany('C-9');
    // Force a MATCHED sms with no verification row (a seeded violation).
    await prisma.smsLog.create({
      data: {
        company_id: company,
        client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
        content_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
        sms_address: 'bKash',
        provider: 'BKASH',
        raw_message: 'x',
        device_received_at: PAST,
        parse_status: 'PARSED',
        match_status: 'MATCHED',
      },
    });
    const results = await app.get(InvariantsService).check();
    const broken = results.find((r) => r.check === 'matched_sms_without_verification');
    expect(broken?.count).toBeGreaterThanOrEqual(1);
  });
});
