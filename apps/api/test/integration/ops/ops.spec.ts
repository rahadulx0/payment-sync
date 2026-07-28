import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { createApp } from '../../../src/main.js';
import { MatchingService } from '../../../src/modules/matching/matching.service.js';
import { OpsService } from '../../../src/modules/ops/ops.service.js';
import { createTestDb, dropTestDb, type TestDb } from '../../db/harness.js';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let ops: OpsService;
let matching: MatchingService;
let companyId = '';
let smsId = '';
let orderId = '';

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 3).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'ops-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'ops-refresh-secret-0123456789';
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
  ops = app.get(OpsService);
  matching = app.get(MatchingService);

  const c = await prisma.company.create({
    data: { company_code: `C-${uuidv7().slice(0, 8)}`, name: 'Ops', settings: { create: {} } },
  });
  companyId = c.id;
  const order = await prisma.paymentRequest.create({
    data: {
      company_id: c.id,
      order_id: 'ORD-OPS',
      transaction_id: 'OPSTRX0001',
      expected_amount: '1000.00',
      callback_url: 'https://m.example.com/hook',
      match_mode: 'EXACT',
      amount_tolerance: '0.00',
      expires_at: new Date(Date.now() + 3600_000),
    },
  });
  orderId = order.id;
  const sms = await prisma.smsLog.create({
    data: {
      company_id: c.id,
      client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      content_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      sms_address: 'bKash',
      provider: 'BKASH',
      raw_message: 'Cash In Tk 1000.00 TrxID OPSTRX0001',
      transaction_id: 'OPSTRX0001',
      amount: '1000.00',
      sms_timestamp: new Date(),
      device_received_at: new Date(),
      parse_status: 'PARSED',
    },
  });
  smsId = sms.id;
  await matching.matchBySms(sms.id);
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('ops read models', () => {
  it('lists SMS logs with a normalised decimal amount', async () => {
    const res = await ops.listSmsLogs({ companyId });
    expect(res.items.length).toBe(1);
    expect(res.items[0]?.amount).toBe('1000.00');
    expect(res.items[0]?.match_status).toBe('MATCHED');
  });

  it('assembles the SMS drill-down: extraction + trace + verification + webhooks', async () => {
    const detail = await ops.smsDetail(smsId);
    expect(detail.sms.transaction_id).toBe('OPSTRX0001');
    expect(detail.attempts.length).toBeGreaterThanOrEqual(1);
    expect(detail.attempts[0]?.result).toBe('VERIFIED');
    expect(detail.verification).not.toBeNull();
    expect(detail.webhooks.length).toBe(1);
    expect(detail.webhooks[0]?.event_type).toBe('payment.verified');
  });

  it('assembles the order drill-down with its verification and webhook attempts', async () => {
    const detail = await ops.orderDetail(orderId);
    expect(detail.order.order_id).toBe('ORD-OPS');
    expect(detail.order.status).toBe('VERIFIED');
    expect(detail.verification).not.toBeNull();
    expect(detail.webhooks.length).toBe(1);
  });

  it('search matches by TrxID', async () => {
    const res = await ops.listSmsLogs({ companyId, search: 'OPSTRX' });
    expect(res.items.length).toBe(1);
  });
});
