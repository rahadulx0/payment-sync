import type { INestApplication } from '@nestjs/common';
import { uuidv7, verifyWebhook } from '@paysync/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { CredentialService } from '../../src/common/auth/credential.service.js';
import { SafeUrlService } from '../../src/common/http/safe-url.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { CryptoService } from '../../src/config/crypto.service.js';
import { createApp } from '../../src/main.js';
import { DeliveryService } from '../../src/modules/webhooks/delivery/delivery.service.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';
import { WebhookReceiver } from '../helpers/webhook-receiver.js';

const ENROLL_KEY = 'pde_live_whkjourneyenrol0123456789';
const SERVER_KEY = 'psk_live_whkjourneyserver0123456789';
const WEBHOOK_SECRET = 'whsec_journeysecret0123456789';
const COMPANY_CODE = 'COMP-WHK-09';

let db: TestDb;
let app: INestApplication;
let deviceToken = '';
const installId = uuidv7();
const receiver = new WebhookReceiver();
let receiverUrl = '';

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 6).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'whkj9-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'whkj9-refresh-secret-0123456789';
  process.env['WEBHOOK_INSECURE_ALLOWED'] = 'true';
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
  receiverUrl = await receiver.start();

  const prisma = app.get(PrismaService);
  const creds = app.get(CredentialService);
  const crypto = app.get(CryptoService);
  const company = await prisma.company.create({
    data: {
      company_code: COMPANY_CODE,
      name: 'Webhook Journey Co',
      webhook_secret_enc: crypto.encrypt(WEBHOOK_SECRET),
      settings: { create: {} },
    },
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
  await receiver.stop();
  await app.close();
  await dropTestDb(db);
});

describe('§5.1 journey: register → upload → verified → signed webhook delivered', () => {
  it('delivers a valid, verifiable webhook carrying the right payload', async () => {
    const prisma = app.get(PrismaService);

    await http()
      .post('/api/v1/payments/register')
      .set('Authorization', `Bearer ${SERVER_KEY}`)
      .set('X-Company-Id', COMPANY_CODE)
      .send({
        order_id: 'ORD-WHK',
        amount: '1500.00',
        transaction_id: 'WHKJRN0001',
        provider: 'BKASH',
        callback_url: 'https://merchant.example.com/hook',
      });

    await http()
      .post('/api/v1/sms/upload')
      .set('Authorization', `Bearer ${deviceToken}`)
      .set('X-Install-Id', installId)
      .send({
        upload_source: 'REALTIME',
        messages: [
          {
            client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
            sms_address: 'bKash',
            raw_message:
              'Cash In Tk 1,500.00 from 01759584276 successful. Fee Tk 0.00. Balance Tk 2,000.00. TrxID WHKJRN0001 at 05/01/2026 16:55',
            device_received_at: '2026-05-01T16:56:00.000Z',
          },
        ],
      });

    const company = await prisma.company.findUniqueOrThrow({
      where: { company_code: COMPANY_CODE },
    });
    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { company_id: company.id, event_type: 'payment.verified' },
    });
    // Point the frozen event at the local receiver (register enforces https).
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { callback_url: receiverUrl },
    });

    await app.get(DeliveryService).deliverEvent(event.id);

    expect(receiver.received.length).toBe(1);
    const req = receiver.received[0];
    const header = req?.headers['x-paysync-signature'] as string;
    expect(verifyWebhook({ secret: WEBHOOK_SECRET, header, rawBody: req?.body ?? '' })).toBe(true);

    const body = JSON.parse(req?.body ?? '{}') as {
      event_type: string;
      data: { order_id: string; status: string; amount: string; transaction_id: string };
    };
    expect(body.event_type).toBe('payment.verified');
    expect(body.data.order_id).toBe('ORD-WHK');
    expect(body.data.status).toBe('VERIFIED');
    expect(body.data.amount).toBe('1500.00');
    expect(body.data.transaction_id).toBe('WHKJRN0001');

    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe(
      'DELIVERED',
    );
  });
});
