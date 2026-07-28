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

const ENROLL_KEY = 'pde_live_heurjourneyenrol012345678';
const SERVER_KEY = 'psk_live_heurjourneyserver012345678';
const COMPANY_CODE = 'COMP-HEU-10';

let db: TestDb;
let app: INestApplication;
let deviceToken = '';
const installId = uuidv7();

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 5).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'heu10-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'heu10-refresh-secret-0123456789';
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
    data: { company_code: COMPANY_CODE, name: 'Heuristic Journey Co', settings: { create: {} } },
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

describe('heuristic journey: no TrxID, sender + amount + window → VERIFIED', () => {
  it('verifies a heuristic order via an SMS with a matching sender and amount', async () => {
    // No transaction_id → HEURISTIC mode; sender registered for a safe match.
    const reg = await http()
      .post('/api/v1/payments/register')
      .set('Authorization', `Bearer ${SERVER_KEY}`)
      .set('X-Company-Id', COMPANY_CODE)
      .send({
        order_id: 'ORD-HEU',
        amount: '1500.00',
        provider: 'BKASH',
        sender_msisdn: '+8801759584276',
        callback_url: 'https://merchant.example.com/hook',
      });
    expect(reg.body.match_mode).toBe('HEURISTIC');

    // The SMS timestamp must fall inside the heuristic window of the just-created
    // order. Provider SMS times are Asia/Dhaka (UTC+6) local, so express "two
    // minutes ago" in Dhaka-local terms (bKash DD/MM/YYYY HH:MM).
    const when = new Date(Date.now() - 2 * 60_000);
    const dhaka = new Date(when.getTime() + 6 * 60 * 60_000);
    const p2 = (n: number) => n.toString().padStart(2, '0');
    const stamp = `${p2(dhaka.getUTCDate())}/${p2(dhaka.getUTCMonth() + 1)}/${String(dhaka.getUTCFullYear())} ${p2(dhaka.getUTCHours())}:${p2(dhaka.getUTCMinutes())}`;

    const up = await http()
      .post('/api/v1/sms/upload')
      .set('Authorization', `Bearer ${deviceToken}`)
      .set('X-Install-Id', installId)
      .send({
        upload_source: 'REALTIME',
        messages: [
          {
            client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
            sms_address: 'bKash',
            raw_message: `Cash In Tk 1,500.00 from 01759584276 successful. Fee Tk 0.00. Balance Tk 2,000.00. TrxID HEUJRN0001 at ${stamp}`,
            device_received_at: when.toISOString(),
          },
        ],
      });
    expect(up.status).toBe(202);
    expect(up.body.results[0].match_status).toBe('MATCHED');

    const status = await http()
      .get('/api/v1/payments/ORD-HEU')
      .set('Authorization', `Bearer ${SERVER_KEY}`)
      .set('X-Company-Id', COMPANY_CODE);
    expect(status.body.status).toBe('VERIFIED');

    const prisma = app.get(PrismaService);
    const company = await prisma.company.findUniqueOrThrow({
      where: { company_code: COMPANY_CODE },
    });
    const vt = await prisma.verifiedTransaction.findFirstOrThrow({
      where: { company_id: company.id },
    });
    expect(vt.verification_method).toBe('HEURISTIC_AMOUNT_WINDOW');
  });
});
