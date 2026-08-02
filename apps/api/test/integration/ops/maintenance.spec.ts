import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { createApp } from '../../../src/main.js';
import { CleanupCredentialsProcessor } from '../../../src/workers/cleanup-credentials.processor.js';
import { RetentionPurgeProcessor } from '../../../src/workers/retention-purge.processor.js';
import { createTestDb, dropTestDb, truncateAll, type TestDb } from '../../db/harness.js';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let purge: RetentionPurgeProcessor;
let cleanup: CleanupCredentialsProcessor;

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function company(retentionDays = 180): Promise<string> {
  const c = await prisma.company.create({
    data: {
      company_code: `C-${(seq++).toString()}-${uuidv7().slice(-8)}`,
      name: 'Ops Co',
      settings: { create: { sms_retention_days: retentionDays } },
    },
  });
  return c.id;
}

async function sms(companyId: string, createdAt: Date, body = 'Cash In Tk 1000 TrxID ABC123XYZ') {
  return prisma.smsLog.create({
    data: {
      company_id: companyId,
      client_msg_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      content_hash: uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, ''),
      sms_address: 'bKash',
      provider: 'BKASH',
      raw_message: body,
      transaction_id: 'ABC123XYZ',
      amount: '1000.00',
      parse_status: 'PARSED',
      device_received_at: createdAt,
      created_at: createdAt,
    },
  });
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 11).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'ops16-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'ops16-refresh-secret-0123456789';
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
  purge = app.get(RetentionPurgeProcessor);
  cleanup = app.get(CleanupCredentialsProcessor);
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

beforeEach(async () => {
  await truncateAll(db.prisma as unknown as Parameters<typeof truncateAll>[0]);
});

describe('retention purge (architecture §17.3)', () => {
  it('redacts the message text past retention but KEEPS the audit trail', async () => {
    const c = await company(180);
    const now = new Date();
    const old = await sms(c, new Date(now.getTime() - 200 * DAY));

    await purge.tick(now);

    const after = await prisma.smsLog.findUniqueOrThrow({ where: { id: old.id } });
    expect(after.raw_message).toBe('[redacted]'); // personal content gone
    // The extracted fields survive — they are the record of money that moved.
    expect(after.transaction_id).toBe('ABC123XYZ');
    expect(after.amount?.toString()).toBe('1000');
  });

  it('leaves in-window messages untouched', async () => {
    const c = await company(180);
    const now = new Date();
    const recent = await sms(c, new Date(now.getTime() - 10 * DAY));
    await purge.tick(now);
    const after = await prisma.smsLog.findUniqueOrThrow({ where: { id: recent.id } });
    expect(after.raw_message).not.toBe('[redacted]');
  });

  it("honours each company's retention setting independently", async () => {
    const shortCo = await company(30);
    const longCo = await company(365);
    const now = new Date();
    const a = await sms(shortCo, new Date(now.getTime() - 60 * DAY));
    const b = await sms(longCo, new Date(now.getTime() - 60 * DAY));

    await purge.tick(now);

    expect((await prisma.smsLog.findUniqueOrThrow({ where: { id: a.id } })).raw_message).toBe(
      '[redacted]',
    );
    expect((await prisma.smsLog.findUniqueOrThrow({ where: { id: b.id } })).raw_message).not.toBe(
      '[redacted]',
    );
  });

  it('is idempotent — a second run redacts nothing new', async () => {
    const c = await company(30);
    const now = new Date();
    await sms(c, new Date(now.getTime() - 60 * DAY));
    const first = await purge.tick(now);
    const second = await purge.tick(now);
    expect(first.smsRedacted).toBe(1);
    expect(second.smsRedacted).toBe(0);
  });
});

describe('credential cleanup', () => {
  it('applies the revoke_at grace period', async () => {
    const c = await company();
    const now = new Date();
    const key = await prisma.apiKey.create({
      data: {
        company_id: c,
        key_type: 'SERVER',
        prefix: 'psk_live_',
        key_hash: 'hash',
        label: 'rotated',
        scopes: ['payments:read'],
        revoke_at: new Date(now.getTime() - 1000), // grace expired
      },
    });
    await cleanup.tick(now);
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revoked_at,
    ).not.toBeNull();
  });

  it('does not revoke a key whose grace period is still running', async () => {
    const c = await company();
    const now = new Date();
    const key = await prisma.apiKey.create({
      data: {
        company_id: c,
        key_type: 'SERVER',
        prefix: 'psk_live_',
        key_hash: 'hash',
        label: 'rotating',
        scopes: ['payments:read'],
        revoke_at: new Date(now.getTime() + DAY),
      },
    });
    await cleanup.tick(now);
    expect(
      (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revoked_at,
    ).toBeNull();
  });

  it('drops the previous webhook secret once the dual-signing window closes', async () => {
    const now = new Date();
    const c = await prisma.company.create({
      data: {
        company_code: `C-rot-${uuidv7().slice(-8)}`,
        name: 'Rot Co',
        webhook_secret_prev_enc: Buffer.from('old-secret-blob'),
        webhook_secret_rotated_at: new Date(now.getTime() - 8 * DAY), // past 7 days
        settings: { create: {} },
      },
    });
    await cleanup.tick(now);
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: c.id } })).webhook_secret_prev_enc,
    ).toBeNull();
  });

  it('keeps the previous secret inside the 7-day window', async () => {
    const now = new Date();
    const c = await prisma.company.create({
      data: {
        company_code: `C-rot2-${uuidv7().slice(-8)}`,
        name: 'Rot Co 2',
        webhook_secret_prev_enc: Buffer.from('old-secret-blob'),
        webhook_secret_rotated_at: new Date(now.getTime() - 2 * DAY),
        settings: { create: {} },
      },
    });
    await cleanup.tick(now);
    expect(
      (await prisma.company.findUniqueOrThrow({ where: { id: c.id } })).webhook_secret_prev_enc,
    ).not.toBeNull();
  });

  it('purges expired idempotency keys', async () => {
    const c = await company();
    const now = new Date();
    await prisma.idempotencyKey.create({
      data: {
        company_id: c,
        endpoint: 'payments.register',
        key: 'k1',
        request_hash: 'a'.repeat(64),
        state: 'DONE',
        expires_at: new Date(now.getTime() - 1000),
      },
    });
    const report = await cleanup.tick(now);
    expect(report.idempotencyKeysPurged).toBe(1);
  });
});
