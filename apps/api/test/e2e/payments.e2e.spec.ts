import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { CredentialService } from '../../src/common/auth/credential.service.js';
import { SafeUrlService } from '../../src/common/http/safe-url.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';

const SERVER_KEY = 'psk_live_serverkeyABC1234567890123456';
const COMPANY_CODE = 'COMP-PAY-07';
const CALLBACK = 'https://merchant.example.com/paysync/webhook';

let db: TestDb;
let app: INestApplication;

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}
function server(r: request.Test) {
  return r.set('Authorization', `Bearer ${SERVER_KEY}`).set('X-Company-Id', COMPANY_CODE);
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'pay07-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'pay07-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  await seed(db.prisma, {
    isProd: false,
    seedDev: false,
    adminEmail: 'a@b.co',
    adminPassword: 'seedpassword1',
  });
  app = await createApp();
  await app.init();

  // Public DNS is unreachable/undesirable in CI — resolve every host to a public IP.
  app.get(SafeUrlService).resolver = () => Promise.resolve([{ address: '93.184.216.34' }]);

  const prisma = app.get(PrismaService);
  const creds = app.get(CredentialService);
  const company = await prisma.company.create({
    data: { company_code: COMPANY_CODE, name: 'Pay07 Co', settings: { create: {} } },
  });
  await prisma.apiKey.create({
    data: {
      company_id: company.id,
      key_type: 'SERVER',
      prefix: 'psk_live_',
      key_hash: await creds.hash(SERVER_KEY),
      label: 'server',
      scopes: ['payments:write', 'payments:read'],
    },
  });
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('register', () => {
  it('registers an EXACT order (transaction_id present) as PENDING', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-EXACT-1',
      amount: '1500.00',
      transaction_id: 'DA56RP7N7C',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(res.status).toBe(201);
    expect(res.body.match_mode).toBe('EXACT');
    expect(res.body.status).toBe('PENDING');
    expect(res.body.transaction_id).toBe('DA56RP7N7C');
    expect(res.body.amount).toBe('1500.00');
    expect(res.body.payment_request_id).toBeDefined();
  });

  it('registers a HEURISTIC order (no transaction_id) as PENDING', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-HEUR-1',
      amount: '250.50',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(res.status).toBe(201);
    expect(res.body.match_mode).toBe('HEURISTIC');
    expect(res.body.transaction_id).toBeNull();
  });

  it('is idempotent on identical re-register (returns 200 + same order)', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-EXACT-1',
      amount: '1500.00',
      transaction_id: 'DA56RP7N7C',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('ORD-EXACT-1');
  });

  it('rejects a re-register of the same order_id with a changed payload', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-EXACT-1',
      amount: '9999.00',
      transaction_id: 'DA56RP7N7C',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_ORDER_ID');
  });

  it('rejects a different order claiming a live TrxID', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-EXACT-2',
      amount: '1500.00',
      transaction_id: 'DA56RP7N7C',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION_ID');
  });

  it('rejects a callback URL that resolves to a private address (SSRF)', async () => {
    const svc = app.get(SafeUrlService);
    const original = svc.resolver;
    svc.resolver = () => Promise.resolve([{ address: '10.0.0.5' }]);
    try {
      const res = await server(http().post('/api/v1/payments/register')).send({
        order_id: 'ORD-SSRF-1',
        amount: '10.00',
        transaction_id: 'SSRFTRX001',
        provider: 'BKASH',
        callback_url: 'https://internal.attacker.example/hook',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CALLBACK_URL');
    } finally {
      svc.resolver = original;
    }
  });

  it('rejects a non-https callback URL', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-HTTP-1',
      amount: '10.00',
      transaction_id: 'HTTPTRX001',
      provider: 'BKASH',
      callback_url: 'http://merchant.example.com/hook',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CALLBACK_URL');
  });

  it('rejects an invalid amount', async () => {
    const res = await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-BADAMT-1',
      amount: '-5.00',
      transaction_id: 'BADAMT0001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(res.status).toBe(400);
  });
});

describe('auth', () => {
  it('rejects a request with no server key', async () => {
    const res = await http()
      .post('/api/v1/payments/register')
      .send({ order_id: 'X', amount: '1.00', callback_url: CALLBACK });
    expect(res.status).toBe(401);
  });
});

describe('get + list', () => {
  it('reads a single order by order_id', async () => {
    const res = await server(http().get('/api/v1/payments/ORD-EXACT-1'));
    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('ORD-EXACT-1');
    expect(res.body.match_mode).toBe('EXACT');
  });

  it('404s an unknown order', async () => {
    const res = await server(http().get('/api/v1/payments/NOPE-404'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('lists orders with a status summary', async () => {
    const res = await server(http().get('/api/v1/payments'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.summary.count_by_status.PENDING).toBeGreaterThanOrEqual(2);
    expect(res.body.summary.total_verified_amount).toBe('0.00');
  });
});

describe('cancel', () => {
  it('cancels a PENDING order', async () => {
    await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-CANCEL-1',
      amount: '50.00',
      transaction_id: 'CANCELTRX1',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    const res = await server(http().post('/api/v1/payments/ORD-CANCEL-1/cancel')).send({
      reason: 'customer abandoned',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('refuses to cancel an already-cancelled order', async () => {
    const res = await server(http().post('/api/v1/payments/ORD-CANCEL-1/cancel')).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_PENDING');
  });
});

describe('trxid correction (ADR-14)', () => {
  it('corrects a mistyped TrxID on a PENDING order', async () => {
    await server(http().post('/api/v1/payments/register')).send({
      order_id: 'ORD-FIX-1',
      amount: '700.00',
      transaction_id: 'WRONGTRX01',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    const res = await server(http().patch('/api/v1/payments/ORD-FIX-1/transaction-id')).send({
      transaction_id: 'RIGHTTRX01',
    });
    expect(res.status).toBe(200);
    expect(res.body.transaction_id).toBe('RIGHTTRX01');
    expect(res.body.status).toBe('PENDING');
    expect(res.body.verified_now).toBe(false);

    const check = await server(http().get('/api/v1/payments/ORD-FIX-1'));
    expect(check.body.transaction_id).toBe('RIGHTTRX01');
  });

  it('rejects a correction that collides with a live TrxID', async () => {
    const res = await server(http().patch('/api/v1/payments/ORD-FIX-1/transaction-id')).send({
      transaction_id: 'DA56RP7N7C',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION_ID');
  });

  it('refuses to correct a cancelled order', async () => {
    const res = await server(http().patch('/api/v1/payments/ORD-CANCEL-1/transaction-id')).send({
      transaction_id: 'ANYTHING01',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_PENDING');
  });
});

describe('expiry sweep', () => {
  it('marks past-TTL PENDING orders EXPIRED', async () => {
    const prisma = app.get(PrismaService);
    const company = await prisma.company.findUniqueOrThrow({
      where: { company_code: COMPANY_CODE },
    });
    await prisma.paymentRequest.create({
      data: {
        company_id: company.id,
        order_id: 'ORD-EXP-1',
        transaction_id: 'EXPTRX0001',
        expected_amount: '10.00',
        match_mode: 'EXACT',
        amount_tolerance: '0.00',
        callback_url: CALLBACK,
        expires_at: new Date(Date.now() - 60_000),
      },
    });
    const { ExpiryService } = await import('../../src/modules/payments/expiry.service.js');
    const count = await app.get(ExpiryService).sweep(new Date());
    expect(count).toBeGreaterThanOrEqual(1);
    const row = await prisma.paymentRequest.findFirstOrThrow({
      where: { company_id: company.id, order_id: 'ORD-EXP-1' },
    });
    expect(row.status).toBe('EXPIRED');
  });
});
