import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { CredentialService } from '../../src/common/auth/credential.service.js';
import { SafeUrlService } from '../../src/common/http/safe-url.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';

const ENROLL_KEY = 'pde_live_journeyenrolkey0123456789';
const SERVER_KEY = 'psk_live_journeyserverkey0123456789';
const COMPANY_CODE = 'COMP-JRN-08';
const CALLBACK = 'https://merchant.example.com/hook';

let db: TestDb;
let app: INestApplication;
let deviceToken = '';
const installId = uuidv7();

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}
function server(r: request.Test) {
  return r.set('Authorization', `Bearer ${SERVER_KEY}`).set('X-Company-Id', COMPANY_CODE);
}
function device(r: request.Test) {
  return r.set('Authorization', `Bearer ${deviceToken}`).set('X-Install-Id', installId);
}
function creditSms(trxId: string, amount: string, balance: string, time: string): string {
  return `Cash In Tk ${amount} from 01759584276 successful. Fee Tk 0.00. Balance Tk ${balance}. TrxID ${trxId} at ${time}`;
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'jrn08-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'jrn08-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  await seed(db.prisma, {
    isProd: false,
    seedDev: false,
    adminEmail: 'a@b.co',
    adminPassword: 'seedpassword1',
  });
  app = await createApp();
  await app.init();
  app.get(SafeUrlService).resolver = () => Promise.resolve([{ address: '93.184.216.34' }]);

  const prisma = app.get(PrismaService);
  const creds = app.get(CredentialService);
  const company = await prisma.company.create({
    data: { company_code: COMPANY_CODE, name: 'Journey Co', settings: { create: {} } },
  });
  await prisma.apiKey.createMany({
    data: [
      {
        company_id: company.id,
        key_type: 'DEVICE_ENROLL',
        prefix: 'pde_live_',
        key_hash: await creds.hash(ENROLL_KEY),
        label: 'enroll',
        scopes: ['device:enroll'],
      },
      {
        company_id: company.id,
        key_type: 'SERVER',
        prefix: 'psk_live_',
        key_hash: await creds.hash(SERVER_KEY),
        label: 'server',
        scopes: ['payments:write', 'payments:read'],
      },
    ],
  });

  const enroll = await http().post('/api/v1/device/register').send({
    company_code: COMPANY_CODE,
    enroll_key: ENROLL_KEY,
    install_id: installId,
    model: 'Redmi',
    manufacturer: 'Xiaomi',
    android_version: '14',
    app_version: '1.0.0',
  });
  deviceToken = enroll.body.device_token as string;
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('exact-match journey', () => {
  it('register → upload → VERIFIED, with a webhook event and a decision trace', async () => {
    await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-A',
      amount: '1500.00',
      transaction_id: 'DA56RP7N7C',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });

    const up = await device(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
          sms_address: 'bKash',
          raw_message: creditSms('DA56RP7N7C', '1,500.00', '1,502.70', '05/01/2026 16:55'),
          device_received_at: '2026-05-01T16:56:00.000Z',
        },
      ],
    });
    expect(up.status).toBe(202);
    expect(up.body.results[0].match_status).toBe('MATCHED');

    const status = await server(http().get('/api/v1/payments/ORD-A'));
    expect(status.body.status).toBe('VERIFIED');

    const prisma = app.get(PrismaService);
    const company = await prisma.company.findUniqueOrThrow({
      where: { company_code: COMPANY_CODE },
    });
    const events = await prisma.webhookEvent.findMany({
      where: { company_id: company.id, event_type: 'payment.verified' },
    });
    expect(events.length).toBe(1);
    expect(events[0]?.status).toBe('PENDING');

    const vt = await prisma.verifiedTransaction.findMany({ where: { company_id: company.id } });
    expect(vt.length).toBe(1);

    const attempts = await prisma.matchAttempt.findMany({
      where: { company_id: company.id, result: 'VERIFIED' },
    });
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  it('SMS-then-register (reverse match) verifies synchronously on register', async () => {
    await device(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
          sms_address: 'bKash',
          raw_message: creditSms('REVERSE001', '750.00', '900.00', '05/01/2026 17:10'),
          device_received_at: '2026-05-01T17:11:00.000Z',
        },
      ],
    });

    const reg = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-REV',
      amount: '750.00',
      transaction_id: 'REVERSE001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('VERIFIED');
  });

  it('a second SMS reusing a spent TrxID → DUPLICATE_TXN + review row', async () => {
    const up = await device(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
          sms_address: 'bKash',
          // Same TrxID as ORD-A, different balance/time so content_hash differs.
          raw_message: creditSms('DA56RP7N7C', '1,500.00', '3,000.00', '05/01/2026 18:00'),
          device_received_at: '2026-05-01T18:01:00.000Z',
        },
      ],
    });
    expect(up.body.results[0].match_status).toBe('DUPLICATE_TXN');

    const prisma = app.get(PrismaService);
    const company = await prisma.company.findUniqueOrThrow({
      where: { company_code: COMPANY_CODE },
    });
    const reviews = await prisma.matchReview.findMany({
      where: { company_id: company.id, reason: 'DUPLICATE_TXN_ID' },
    });
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    // Still exactly one verification for that order.
    const vt = await prisma.verifiedTransaction.count({ where: { company_id: company.id } });
    expect(vt).toBe(2); // ORD-A + ORD-REV
  });

  it('underpayment beyond tolerance → REVIEW, order stays PENDING', async () => {
    await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-UNDER',
      amount: '2000.00',
      transaction_id: 'UNDER00001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    const up = await device(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
          sms_address: 'bKash',
          raw_message: creditSms('UNDER00001', '1,500.00', '1,600.00', '05/01/2026 18:30'),
          device_received_at: '2026-05-01T18:31:00.000Z',
        },
      ],
    });
    expect(up.body.results[0].match_status).toBe('IN_REVIEW');
    const status = await server(http().get('/api/v1/payments/ORD-UNDER'));
    expect(status.body.status).toBe('PENDING');
  });

  it('invariants are clean after the journey', async () => {
    const { InvariantsService } = await import('../../src/modules/matching/invariants.service.js');
    const results = await app.get(InvariantsService).check();
    for (const r of results) expect(r.count).toBe(0);
  });
});
