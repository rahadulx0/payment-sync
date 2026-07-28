import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { createApp } from '../../../src/main.js';
import { MatchingService } from '../../../src/modules/matching/matching.service.js';
import { createTestDb, dropTestDb, truncateAll, type TestDb } from '../../db/harness.js';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let matching: MatchingService;

const T0 = new Date('2026-05-01T10:00:00.000Z');
let seq = 0;

async function company(
  over: Partial<{ auto: string; requireSender: boolean; window: number }> = {},
): Promise<string> {
  const c = await prisma.company.create({
    data: {
      company_code: `C-${(seq++).toString()}-${uuidv7().slice(-8)}`,
      name: 'Heur Co',
      settings: {
        create: {
          auto_verify_min_confidence: over.auto ?? '0.90',
          require_sender_match: over.requireSender ?? false,
          heuristic_window_minutes: over.window ?? 30,
        },
      },
    },
  });
  return c.id;
}
async function heuristicOrder(
  companyId: string,
  over: Partial<{ amount: string; sender: string | null; createdAt: Date; tolerance: string }> = {},
): Promise<string> {
  const pr = await prisma.paymentRequest.create({
    data: {
      company_id: companyId,
      order_id: `ORD-${uuidv7()}`,
      transaction_id: null,
      expected_amount: over.amount ?? '1000.00',
      expected_sender_msisdn: over.sender ?? null,
      expected_provider: 'BKASH',
      callback_url: 'https://m.example.com/hook',
      match_mode: 'HEURISTIC',
      amount_tolerance: over.tolerance ?? '0.00',
      status: 'PENDING',
      created_at: over.createdAt ?? T0,
      expires_at: new Date((over.createdAt ?? T0).getTime() + 3600_000),
    },
  });
  return pr.id;
}
async function exactOrder(companyId: string, trxId: string): Promise<string> {
  const pr = await prisma.paymentRequest.create({
    data: {
      company_id: companyId,
      order_id: `ORD-${uuidv7()}`,
      transaction_id: trxId,
      expected_amount: '1000.00',
      callback_url: 'https://m.example.com/hook',
      match_mode: 'EXACT',
      amount_tolerance: '0.00',
      status: 'PENDING',
      expires_at: new Date(T0.getTime() + 3600_000),
    },
  });
  return pr.id;
}
async function creditSms(
  companyId: string,
  over: Partial<{ amount: string; sender: string; smsAt: Date; trxId: string | null }> = {},
): Promise<string> {
  const s = await prisma.smsLog.create({
    data: {
      company_id: companyId,
      client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      content_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      sms_address: 'bKash',
      provider: 'BKASH',
      raw_message: 'Cash In',
      transaction_id: over.trxId ?? null,
      amount: over.amount ?? '1000.00',
      sender_msisdn: over.sender ?? '+8801711111111',
      sms_timestamp: over.smsAt ?? T0,
      device_received_at: over.smsAt ?? T0,
      parse_status: 'PARSED',
      match_status: 'UNMATCHED',
    },
  });
  return s.id;
}
function count(companyId: string) {
  return prisma.verifiedTransaction.count({ where: { company_id: companyId } });
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 2).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'heur-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'heur-refresh-secret-0123456789';
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

describe('heuristic adversarial suite — zero false verifications', () => {
  it('an exact-mode order (has TrxID) is NEVER heuristically verified', async () => {
    const c = await company();
    await exactOrder(c, 'EXACTONLY01');
    const sms = await creditSms(c, { amount: '1000.00' }); // no trxId → heuristic pass
    const res = await matching.matchBySms(sms);
    expect(res.verified).toBe(false);
    expect(await count(c)).toBe(0);
  });

  it('single strong match (sender) auto-verifies', async () => {
    const c = await company();
    await heuristicOrder(c, { sender: '+8801711111111' });
    const res = await matching.matchBySms(await creditSms(c, { sender: '+8801711111111' }));
    expect(res.verified).toBe(true);
    expect(await count(c)).toBe(1);
  });

  it('two orders, same amount, no sender → REVIEW with both candidates, zero verifications', async () => {
    const c = await company();
    await heuristicOrder(c);
    await heuristicOrder(c);
    const res = await matching.matchBySms(await creditSms(c));
    expect(res.result).toBe('REVIEW');
    expect(await count(c)).toBe(0);
    const review = await prisma.matchReview.findFirstOrThrow({ where: { company_id: c } });
    expect((review.candidates as unknown[]).length).toBe(2);
  });

  it('two SMS, one heuristic order, both in tolerance → exactly one verification', async () => {
    const c = await company();
    await heuristicOrder(c, { sender: '+8801711111111' });
    const s1 = await creditSms(c, { sender: '+8801711111111' });
    const s2 = await creditSms(c, { sender: '+8801711111111' });
    await matching.matchBySms(s1);
    await matching.matchBySms(s2);
    expect(await count(c)).toBe(1);
  });

  it('window boundary: inside the window the order is a candidate; past it is excluded', async () => {
    // Inside the window: included as a candidate (→ considered, not UNMATCHED).
    const c = await company({ window: 30 });
    await heuristicOrder(c, { sender: '+8801711111111', createdAt: T0 });
    const inside = await creditSms(c, {
      sender: '+8801711111111',
      smsAt: new Date(T0.getTime() + 10 * 60_000),
    });
    expect((await matching.matchBySms(inside)).result).not.toBe('UNMATCHED');

    // Past the window: excluded entirely → UNMATCHED.
    const c2 = await company({ window: 30 });
    await heuristicOrder(c2, { sender: '+8801711111111', createdAt: T0 });
    const outside = await creditSms(c2, {
      sender: '+8801711111111',
      smsAt: new Date(T0.getTime() + 90 * 60_000),
    });
    expect((await matching.matchBySms(outside)).result).toBe('UNMATCHED');
  });

  it('reverse heuristic matching verifies at register time', async () => {
    const c = await company();
    await creditSms(c, { sender: '+8801711111111' }); // arrives first, UNMATCHED
    const order = await heuristicOrder(c, {
      sender: '+8801711111111',
      createdAt: new Date(T0.getTime() + 60_000),
    });
    const res = await matching.reverseMatchOrder(order);
    expect(res?.verified).toBe(true);
    expect(await count(c)).toBe(1);
  });

  it('an SMS with a mistyped TrxID (no exact match) heuristically verifies with the DESPITE_TRXID flag', async () => {
    const c = await company();
    await heuristicOrder(c, { sender: '+8801711111111' });
    const sms = await creditSms(c, { sender: '+8801711111111', trxId: 'MISTYPED99' });
    const res = await matching.matchBySms(sms);
    expect(res.verified).toBe(true);
    const flags = (await prisma.smsLog.findUniqueOrThrow({ where: { id: sms } })).flags;
    expect(flags).toContain('VERIFIED_HEURISTIC_DESPITE_TRXID');
  });
});
