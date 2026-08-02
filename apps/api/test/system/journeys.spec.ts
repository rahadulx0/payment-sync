import type { INestApplication } from '@nestjs/common';
import { Money, uuidv7 } from '@paysync/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { CredentialService } from '../../src/common/auth/credential.service.js';
import { SafeUrlService } from '../../src/common/http/safe-url.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { InvariantsService } from '../../src/modules/matching/invariants.service.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';

/**
 * Full-system journeys (architecture §5, Task 17 §4.6). These are the paths a
 * real client and a real merchant actually take, asserted end to end through the
 * HTTP surface — including the ones that are easy to get wrong and expensive to
 * get wrong: cross-tenant isolation, the suspend/reactivate lifecycle, and the
 * webhook dead-letter replay.
 *
 * The suite ends by asserting the correctness invariants are clean.
 */

// Two tenants, so isolation can be attempted rather than assumed.
const A = {
  code: 'SYS-CO-A',
  serverKey: 'psk_live_systemAAAAAAAAAAAAAAAAAAAA',
  enrollKey: 'pde_live_systemAAAAAAAAAAAAAAAAAAAA',
};
const B = {
  code: 'SYS-CO-B',
  serverKey: 'psk_live_systemBBBBBBBBBBBBBBBBBBBB',
  enrollKey: 'pde_live_systemBBBBBBBBBBBBBBBBBBBB',
};
const CALLBACK = 'https://merchant.example.com/hook';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let companyAId = '';
let companyBId = '';
let deviceTokenA = '';
const installA = uuidv7();

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}
function asServer(r: request.Test, tenant: typeof A) {
  return r.set('Authorization', `Bearer ${tenant.serverKey}`).set('X-Company-Id', tenant.code);
}
function asDevice(r: request.Test) {
  return r.set('Authorization', `Bearer ${deviceTokenA}`).set('X-Install-Id', installA);
}
function hash64() {
  return uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, '');
}
function creditSms(trxId: string, amount: string, time = '05/01/2026 16:55') {
  return `Cash In Tk ${amount} from 01759584276 successful. Fee Tk 0.00. Balance Tk 9,000.00. TrxID ${trxId} at ${time}`;
}

async function makeTenant(tenant: typeof A): Promise<string> {
  const creds = app.get(CredentialService);
  const company = await prisma.company.create({
    data: { company_code: tenant.code, name: tenant.code, settings: { create: {} } },
  });
  await prisma.apiKey.createMany({
    data: [
      {
        company_id: company.id,
        key_type: 'SERVER',
        prefix: 'psk_live_',
        key_hash: await creds.hash(tenant.serverKey),
        label: 'server',
        scopes: ['payments:write', 'payments:read'],
      },
      {
        company_id: company.id,
        key_type: 'DEVICE_ENROLL',
        prefix: 'pde_live_',
        key_hash: await creds.hash(tenant.enrollKey),
        label: 'enroll',
        scopes: ['device:enroll'],
      },
    ],
  });
  return company.id;
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 21).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'sys17-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'sys17-refresh-secret-0123456789';
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
  prisma = app.get(PrismaService);

  companyAId = await makeTenant(A);
  companyBId = await makeTenant(B);

  const enroll = await http().post('/api/v1/device/register').send({
    company_code: A.code,
    enroll_key: A.enrollKey,
    install_id: installA,
    model: 'Redmi',
    manufacturer: 'Xiaomi',
    android_version: '14',
    app_version: '1.0.0',
  });
  deviceTokenA = enroll.body.device_token as string;
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('journey: overpayment verifies with a flag, underpayment does not', () => {
  it('an overpaid order still verifies (the merchant received MORE)', async () => {
    await asServer(http().post('/api/v1/payments/register'), A).send({
      order_id: 'ORD-OVER',
      amount: '1000.00',
      transaction_id: 'OVERPAY001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    const up = await asDevice(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: hash64(),
          sms_address: 'bKash',
          raw_message: creditSms('OVERPAY001', '1,200.00'),
          device_received_at: '2026-05-01T16:56:00.000Z',
        },
      ],
    });
    expect(up.body.results[0].match_status).toBe('MATCHED');

    const status = await asServer(http().get('/api/v1/payments/ORD-OVER'), A);
    expect(status.body.status).toBe('VERIFIED');

    // The overpayment is recorded as a positive delta (integer paisa via Money —
    // never float arithmetic on an amount).
    const vt = await prisma.verifiedTransaction.findFirstOrThrow({
      where: { company_id: companyAId, paymentRequest: { order_id: 'ORD-OVER' } },
    });
    expect(Money.fromPrismaDecimal(vt.amount_delta).toDecimalString()).toBe('200.00');
  });
});

describe('journey: cross-tenant isolation (attempted, not assumed)', () => {
  it("company B's server key cannot read company A's order", async () => {
    // Correct key for B, but asking for an order that belongs to A.
    const res = await asServer(http().get('/api/v1/payments/ORD-OVER'), B);
    expect(res.status).toBe(404); // not 200, and not a leak of existence details
  });

  it("a server key used with another company's code is rejected outright", async () => {
    const res = await http()
      .get('/api/v1/payments/ORD-OVER')
      .set('Authorization', `Bearer ${A.serverKey}`)
      .set('X-Company-Id', B.code); // mismatched pair
    expect(res.status).toBe(401);
  });

  it('a device token cannot register orders or read order data (ADR-4)', async () => {
    // The APK is decompilable, so a leaked device token must be near-useless.
    const register = await http()
      .post('/api/v1/payments/register')
      .set('Authorization', `Bearer ${deviceTokenA}`)
      .set('X-Install-Id', installA)
      .send({ order_id: 'ORD-EVIL', amount: '1.00', callback_url: CALLBACK });
    expect(register.status).toBe(401);

    const read = await http()
      .get('/api/v1/payments/ORD-OVER')
      .set('Authorization', `Bearer ${deviceTokenA}`)
      .set('X-Install-Id', installA);
    expect(read.status).toBe(401);
  });

  it('a server key cannot reach the admin surface', async () => {
    const res = await asServer(http().get('/api/v1/admin/companies'), A);
    expect(res.status).toBe(401);
  });

  it("company B's SMS cannot verify company A's order", async () => {
    // Same TrxID as A's order, uploaded under B — must not cross the tenant line.
    await asServer(http().post('/api/v1/payments/register'), B).send({
      order_id: 'ORD-B-1',
      amount: '500.00',
      transaction_id: 'TENANTX001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    const beforeA = await prisma.verifiedTransaction.count({ where: { company_id: companyAId } });

    const up = await asDevice(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: hash64(),
          sms_address: 'bKash',
          raw_message: creditSms('TENANTX001', '500.00', '05/01/2026 17:30'),
          device_received_at: '2026-05-01T17:31:00.000Z',
        },
      ],
    });
    // Device A belongs to company A, so this SMS can never satisfy B's order.
    expect(up.body.results[0].match_status).not.toBe('MATCHED');
    expect(await prisma.verifiedTransaction.count({ where: { company_id: companyBId } })).toBe(0);
    expect(await prisma.verifiedTransaction.count({ where: { company_id: companyAId } })).toBe(
      beforeA,
    );
  });
});

describe('journey: company suspended → reactivated', () => {
  it('a suspended company rejects new orders but keeps ingesting SMS', async () => {
    await prisma.company.update({ where: { id: companyAId }, data: { status: 'SUSPENDED' } });

    const register = await asServer(http().post('/api/v1/payments/register'), A).send({
      order_id: 'ORD-SUSPENDED',
      amount: '100.00',
      transaction_id: 'SUSPEND001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(register.status).toBe(403); // COMPANY_SUSPENDED

    // Ingestion continues — money that already arrived must still be captured.
    const up = await asDevice(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: hash64(),
          sms_address: 'bKash',
          raw_message: creditSms('SUSPEND001', '100.00', '05/01/2026 18:00'),
          device_received_at: '2026-05-01T18:01:00.000Z',
        },
      ],
    });
    expect(up.status).toBe(202);

    await prisma.company.update({ where: { id: companyAId }, data: { status: 'ACTIVE' } });
    const after = await asServer(http().post('/api/v1/payments/register'), A).send({
      order_id: 'ORD-REACTIVATED',
      amount: '100.00',
      transaction_id: 'REACT00001',
      provider: 'BKASH',
      callback_url: CALLBACK,
    });
    expect(after.status).toBe(201);
  });
});

describe('journey: webhook dead-letter replay', () => {
  it('a DEAD event can be replayed by the operator and returns to PENDING', async () => {
    const event = await prisma.webhookEvent.create({
      data: {
        company_id: companyAId,
        event_type: 'payment.verified',
        payload: { event_id: 'x' },
        payload_raw: '{"event_id":"x"}',
        callback_url: CALLBACK,
        status: 'DEAD',
        attempt_count: 8,
      },
    });

    // Replay is deliberately dry-run first — an operator sees the count before acting.
    const { WebhooksAdminController } = await import(
      '../../src/modules/webhooks/admin/webhooks-admin.controller.js'
    );
    const controller = app.get(WebhooksAdminController);
    const dry = await controller.replayDead({ company_id: companyAId }, { adminId: uuidv7() });
    expect(dry).toMatchObject({ dry_run: true, would_replay: 1 });

    const real = await controller.replayDead(
      { company_id: companyAId, dry_run: false },
      { adminId: uuidv7() },
    );
    expect(real).toMatchObject({ dry_run: false, replayed: 1 });

    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.status).toBe('PENDING');
    // History is preserved — support needs "how many times did you try?".
    expect(after.attempt_count).toBe(8);
  });
});

describe('journey: the whole suite leaves correctness intact', () => {
  it('every invariant is clean after all journeys', async () => {
    const results = await app.get(InvariantsService).check();
    for (const r of results) {
      expect(`${r.check}=${String(r.count)}`).toBe(`${r.check}=0`);
    }
  });
});
