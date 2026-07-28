import type { INestApplication } from '@nestjs/common';
import { AppError, uuidv7, verifyWebhook } from '@paysync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { SafeUrlService } from '../../../src/common/http/safe-url.service.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { ConfigService } from '../../../src/config/config.service.js';
import { CryptoService } from '../../../src/config/crypto.service.js';
import { createApp } from '../../../src/main.js';
import { DeliveryService } from '../../../src/modules/webhooks/delivery/delivery.service.js';
import { WebhookSweeperProcessor } from '../../../src/workers/webhook-sweeper.processor.js';
import { createTestDb, dropTestDb, truncateAll, type TestDb } from '../../db/harness.js';
import { WebhookReceiver } from '../../helpers/webhook-receiver.js';

const SECRET = 'whsec_testsecret1234567890';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let delivery: DeliveryService;
let sweeper: WebhookSweeperProcessor;
let crypto: CryptoService;
const receiver = new WebhookReceiver();
let receiverUrl = '';

async function makeCompany(
  over: { status?: string; prevSecret?: boolean; rotatedAt?: Date } = {},
): Promise<string> {
  const c = await prisma.company.create({
    data: {
      company_code: `C-${uuidv7().slice(0, 8)}`,
      name: 'Hook Co',
      status: (over.status ?? 'ACTIVE') as never,
      webhook_secret_enc: crypto.encrypt(SECRET),
      ...(over.prevSecret === true ? { webhook_secret_prev_enc: crypto.encrypt('whsec_old') } : {}),
      ...(over.rotatedAt !== undefined ? { webhook_secret_rotated_at: over.rotatedAt } : {}),
      settings: { create: {} },
    },
  });
  return c.id;
}

async function makeEvent(companyId: string, url = receiverUrl): Promise<string> {
  const id = uuidv7();
  const raw = JSON.stringify({
    event_id: id,
    event_type: 'payment.verified',
    data: { order_id: 'O1' },
  });
  await prisma.webhookEvent.create({
    data: {
      id,
      company_id: companyId,
      event_type: 'payment.verified',
      payload: JSON.parse(raw) as object,
      payload_raw: raw,
      callback_url: url,
      status: 'PENDING',
      next_attempt_at: new Date(),
    },
  });
  return id;
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 4).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'whk09-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'whk09-refresh-secret-0123456789';
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
  prisma = app.get(PrismaService);
  delivery = app.get(DeliveryService);
  sweeper = app.get(WebhookSweeperProcessor);
  crypto = app.get(CryptoService);
  receiverUrl = await receiver.start();
});

afterAll(async () => {
  await receiver.stop();
  await app.close();
  await dropTestDb(db);
});

beforeEach(async () => {
  await truncateAll(db.prisma as unknown as Parameters<typeof truncateAll>[0]);
  receiver.reset();
});

describe('webhook delivery', () => {
  it('delivers a 2xx with a valid signature and marks DELIVERED', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    await delivery.deliverEvent(id);

    expect(receiver.received.length).toBe(1);
    const req = receiver.received[0];
    const header = req?.headers['x-paysync-signature'] as string;
    expect(verifyWebhook({ secret: SECRET, header, rawBody: req?.body ?? '' })).toBe(true);

    const ev = await prisma.webhookEvent.findUniqueOrThrow({ where: { id } });
    expect(ev.status).toBe('DELIVERED');
    expect(ev.delivered_at).not.toBeNull();
    const co = await prisma.company.findUniqueOrThrow({ where: { id: company } });
    expect(co.webhook_consecutive_failures).toBe(0);
  });

  it('a 500 keeps the event PENDING and schedules the next attempt', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    receiver.behaviour = { status: 500 };
    await delivery.deliverEvent(id);

    const ev = await prisma.webhookEvent.findUniqueOrThrow({ where: { id } });
    expect(ev.status).toBe('PENDING');
    expect(ev.attempt_count).toBe(1);
    expect(ev.next_attempt_at?.getTime()).toBeGreaterThan(Date.now());
    const deliveries = await prisma.webhookDelivery.findMany({ where: { event_id: id } });
    expect(deliveries[0]?.response_status).toBe(500);
  });

  it('a 404 stops retrying (FAILED, one attempt)', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    receiver.behaviour = { status: 404 };
    await delivery.deliverEvent(id);
    const ev = await prisma.webhookEvent.findUniqueOrThrow({ where: { id } });
    expect(ev.status).toBe('FAILED');
    expect(ev.reason).toBe('CLIENT_ERROR');
  });

  it('a 410 Gone cancels delivery', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    receiver.behaviour = { status: 410 };
    await delivery.deliverEvent(id);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).status).toBe(
      'CANCELLED',
    );
  });

  it('a redirect is not followed (FAILED BAD_BODY)', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    receiver.behaviour = { redirectTo: 'https://evil.example.com/' };
    await delivery.deliverEvent(id);
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { event_id: id } });
    expect(d.error_class).toBe('BAD_BODY');
  });

  it('a slow endpoint times out and is retryable', async () => {
    const company = await makeCompany();
    await prisma.companySettings.update({
      where: { company_id: company },
      data: { webhook_timeout_ms: 50 },
    });
    const id = await makeEvent(company);
    receiver.behaviour = { status: 200, delayMs: 400 };
    await delivery.deliverEvent(id);
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { event_id: id } });
    expect(d.error_class).toBe('TIMEOUT');
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it('opens the circuit breaker after 10 consecutive failures', async () => {
    const company = await makeCompany();
    await prisma.company.update({
      where: { id: company },
      data: { webhook_consecutive_failures: 9 },
    });
    const id = await makeEvent(company);
    receiver.behaviour = { status: 500 };
    await delivery.deliverEvent(id);
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: company } })).webhook_breaker_state,
    ).toBe('OPEN');
  });

  it('a SUSPENDED company pauses delivery (nothing sent)', async () => {
    const company = await makeCompany({ status: 'SUSPENDED' });
    const id = await makeEvent(company);
    await delivery.deliverEvent(id);
    expect(receiver.received.length).toBe(0);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).paused).toBe(true);
  });

  it('the orphan sweeper delivers a due PENDING event', async () => {
    const company = await makeCompany();
    await makeEvent(company);
    const n = await sweeper.tick();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(receiver.received.length).toBe(1);
  });

  it('redacts the signature header in stored delivery history', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    await delivery.deliverEvent(id);
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { event_id: id } });
    const headers = d.request_headers as Record<string, string>;
    expect(headers['X-PaySync-Signature']).toBe('[redacted]');
  });

  it('dual-signs during rotation so the old secret still verifies', async () => {
    const company = await makeCompany({ prevSecret: true, rotatedAt: new Date() });
    const id = await makeEvent(company);
    await delivery.deliverEvent(id);
    const req = receiver.received[0];
    const header = req?.headers['x-paysync-signature'] as string;
    expect(header).toContain('v0=');
    expect(verifyWebhook({ secret: 'whsec_old', header, rawBody: req?.body ?? '' })).toBe(true);
  });

  it('never marks DELIVERED twice (idempotent on the event)', async () => {
    const company = await makeCompany();
    const id = await makeEvent(company);
    await delivery.deliverEvent(id);
    await delivery.deliverEvent(id); // second call sees DELIVERED and skips
    expect(receiver.received.length).toBe(1);
  });

  it('re-validates SSRF at send time and never sends to a rejected host', async () => {
    const config = app.get(ConfigService);
    const safe = app.get(SafeUrlService);
    Object.defineProperty(config, 'webhookInsecureAllowed', {
      get: () => false,
      configurable: true,
    });
    const origValidate = safe.validate.bind(safe);
    (safe as { validate: SafeUrlService['validate'] }).validate = () => {
      throw new AppError('INVALID_CALLBACK_URL', 'resolves to private address');
    };
    try {
      const company = await makeCompany();
      const id = await makeEvent(company);
      await delivery.deliverEvent(id);
      expect(receiver.received.length).toBe(0);
      const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { event_id: id } });
      expect(d.error_class).toBe('UNSAFE_CALLBACK_URL');
      expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { id } })).status).toBe(
        'FAILED',
      );
    } finally {
      delete (config as { webhookInsecureAllowed?: boolean }).webhookInsecureAllowed;
      (safe as { validate: SafeUrlService['validate'] }).validate = origValidate;
    }
  });
});
