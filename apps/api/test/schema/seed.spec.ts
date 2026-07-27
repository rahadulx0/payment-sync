import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { createTestDb, dropTestDb, truncateAll, type TestDb } from '../db/harness.js';

let db: TestDb;
const base = { adminEmail: 'admin@test.local', adminPassword: 'Sup3rSecret!Dev' };

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await dropTestDb(db);
});
beforeEach(async () => {
  await truncateAll(db.prisma);
});

describe('seed', () => {
  it('always seeds provider profiles, parser placeholders, and the admin', async () => {
    await seed(db.prisma, { ...base, isProd: false, seedDev: false });
    expect(await db.prisma.providerProfile.count()).toBe(3);
    expect(await db.prisma.parserRule.count()).toBe(3);
    expect(await db.prisma.adminUser.count()).toBe(1);
    expect(await db.prisma.company.count()).toBe(0);
  });

  it('is idempotent (re-running creates no duplicates)', async () => {
    await seed(db.prisma, { ...base, isProd: false, seedDev: true });
    await seed(db.prisma, { ...base, isProd: false, seedDev: true });
    expect(await db.prisma.providerProfile.count()).toBe(3);
    expect(await db.prisma.company.count()).toBe(1);
    expect(await db.prisma.apiKey.count()).toBe(2);
    expect(await db.prisma.device.count()).toBe(1);
    expect(await db.prisma.paymentRequest.count()).toBe(2);
  });

  it('is production-safe: no dev company even when seedDev is requested', async () => {
    await seed(db.prisma, { ...base, isProd: true, seedDev: true });
    expect(await db.prisma.adminUser.count()).toBe(1);
    expect(await db.prisma.company.count()).toBe(0);
  });

  it('dev company has settings, both key types, a device, and sample rows', async () => {
    await seed(db.prisma, { ...base, isProd: false, seedDev: true });
    const c = await db.prisma.company.findUniqueOrThrow({
      where: { company_code: 'COMP-DEV-001' },
      include: { settings: true },
    });
    expect(c.settings).not.toBeNull();
    const keys = await db.prisma.apiKey.findMany({ where: { company_id: c.id } });
    expect(keys.map((k) => k.key_type).sort()).toEqual(['DEVICE_ENROLL', 'SERVER']);
    expect(await db.prisma.paymentRequest.count({ where: { company_id: c.id } })).toBe(2);
  });
});
