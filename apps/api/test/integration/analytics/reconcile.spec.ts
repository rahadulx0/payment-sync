import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../../prisma/seed.js';
import { PrismaService } from '../../../src/common/prisma/prisma.service.js';
import { createApp } from '../../../src/main.js';
import { AnalyticsService } from '../../../src/modules/analytics/analytics.service.js';
import { createTestDb, dropTestDb, type TestDb } from '../../db/harness.js';

let db: TestDb;
let app: INestApplication;
let prisma: PrismaService;
let analytics: AnalyticsService;
let companyId = '';

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 3).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'ana-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'ana-refresh-secret-0123456789';
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
  analytics = app.get(AnalyticsService);

  const c = await prisma.company.create({
    data: { company_code: `C-${uuidv7().slice(0, 8)}`, name: 'A', settings: { create: {} } },
  });
  companyId = c.id;
  // 5 verified, 3 pending, 2 expired.
  for (let i = 0; i < 10; i++) {
    const status = i < 5 ? 'VERIFIED' : i < 8 ? 'PENDING' : 'EXPIRED';
    await prisma.paymentRequest.create({
      data: {
        company_id: c.id,
        order_id: `ORD-${uuidv7()}`,
        expected_amount: '100.00',
        callback_url: 'https://m.example.com/hook',
        match_mode: 'EXACT',
        transaction_id: `TRX${String(i).padStart(7, '0')}`,
        amount_tolerance: '0.00',
        status: status as never,
        ...(status === 'VERIFIED' ? { verified_at: new Date() } : {}),
        expires_at: new Date(Date.now() + 3600_000),
      },
    });
  }
});
afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('analytics reconciliation', () => {
  it('overview verified/pending counts match a naive count', async () => {
    const naiveVerified = await prisma.paymentRequest.count({
      where: { company_id: companyId, status: 'VERIFIED' },
    });
    const naivePending = await prisma.paymentRequest.count({
      where: { company_id: companyId, status: 'PENDING' },
    });
    const o = await analytics.overview('30d');
    expect(o.verified).toBe(naiveVerified);
    expect(o.pending).toBe(naivePending);
    expect(o.verified_amount).toBe('500.00'); // 5 × 100.00 (numeric sum text)
    expect(o.as_of).toBeDefined();
  });

  it('daily rows reconcile registered/verified against a naive count', async () => {
    const d = await analytics.daily('30d', companyId);
    const totalRegistered = d.days.reduce((s, row) => s + row.registered, 0);
    const totalVerified = d.days.reduce((s, row) => s + row.verified, 0);
    expect(totalRegistered).toBe(
      await prisma.paymentRequest.count({ where: { company_id: companyId } }),
    );
    expect(totalVerified).toBe(5);
  });

  it('companies league table includes the seeded company with correct success rate', async () => {
    const res = await analytics.companies('30d');
    const row = res.companies.find((r) => r.company_id === companyId);
    expect(row?.registered).toBe(10);
    expect(row?.verified).toBe(5);
    expect(row?.success_rate).toBeCloseTo(0.5, 5);
  });
});
