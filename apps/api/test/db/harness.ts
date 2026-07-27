// Per-file test database harness. Clones the migrated template into an isolated
// database, hands back a PrismaClient, and provides typed row factories. Money
// is passed as decimal strings; ids use app-side uuidv7 for index locality.
import { randomBytes } from 'node:crypto';

import { uuidv7 } from '@paysync/shared';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDb {
  prisma: PrismaClient;
  name: string;
  url: string;
}

let seq = 0;

function conn(database: string): pg.Client {
  const info = inject('pg');
  return new pg.Client({
    host: info.host,
    port: info.port,
    user: info.user,
    password: info.password,
    database,
  });
}

export async function createTestDb(): Promise<TestDb> {
  const info = inject('pg');
  const name = `paysync_test_${process.pid.toString()}_${Date.now().toString()}_${(seq++).toString()}`;
  const admin = conn('postgres');
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${info.template}"`);
  await admin.end();
  const url = `postgresql://${info.user}:${info.password}@${info.host}:${info.port.toString()}/${name}`;
  const prisma = new PrismaClient({ datasourceUrl: url });
  return { prisma, name, url };
}

export async function dropTestDb(db: TestDb): Promise<void> {
  await db.prisma.$disconnect();
  const admin = conn('postgres');
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
  await admin.end();
}

/** Truncate every data table (keeps schema), for isolation between tests. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

// ---- factories -----------------------------------------------------------

export async function makeCompany(
  prisma: PrismaClient,
  overrides: Partial<Prisma.CompanyUncheckedCreateInput> = {},
) {
  const company = await prisma.company.create({
    data: {
      company_code: `COMP${(++seq).toString().padStart(6, '0')}`,
      name: 'Test Company',
      ...overrides,
    },
  });
  await prisma.companySettings.create({ data: { company_id: company.id } });
  return company;
}

export async function makeDevice(
  prisma: PrismaClient,
  companyId: string,
  overrides: Partial<Prisma.DeviceUncheckedCreateInput> = {},
) {
  return prisma.device.create({
    data: {
      company_id: companyId,
      device_name: 'Shop Counter Phone',
      install_id: uuidv7(),
      token_hash: `$argon2id$${randomHex(16)}`,
      ...overrides,
    },
  });
}

export async function makeSmsLog(
  prisma: PrismaClient,
  companyId: string,
  overrides: Partial<Prisma.SmsLogUncheckedCreateInput> = {},
) {
  return prisma.smsLog.create({
    data: {
      company_id: companyId,
      client_msg_hash: randomHex(32),
      content_hash: randomHex(32),
      sms_address: 'bKash',
      raw_message: 'Cash In Tk 1,250.00 from 017XXXXXXXX. TrxID 8A7BCD1234 at 27/07/2026 10:15',
      device_received_at: new Date(),
      ...overrides,
    },
  });
}

export async function makePaymentRequest(
  prisma: PrismaClient,
  companyId: string,
  overrides: Partial<Prisma.PaymentRequestUncheckedCreateInput> = {},
) {
  return prisma.paymentRequest.create({
    data: {
      company_id: companyId,
      order_id: `ORD-${(++seq).toString()}`,
      expected_amount: '1250.00',
      callback_url: 'https://client.example.com/webhook',
      match_mode: 'EXACT',
      amount_tolerance: '0.00',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  });
}

export async function makeVerifiedTransaction(
  prisma: PrismaClient,
  args: {
    companyId: string;
    paymentRequestId: string;
    smsLogId: string;
    overrides?: Partial<Prisma.VerifiedTransactionUncheckedCreateInput>;
  },
) {
  return prisma.verifiedTransaction.create({
    data: {
      company_id: args.companyId,
      payment_request_id: args.paymentRequestId,
      sms_log_id: args.smsLogId,
      verification_method: 'EXACT_TXN_ID',
      confidence: '1.00',
      amount_delta: '0.00',
      ...args.overrides,
    },
  });
}
