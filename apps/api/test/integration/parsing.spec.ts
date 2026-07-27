import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { ParserService } from '../../src/modules/parsing/parser.service.js';
import { createTestDb, dropTestDb, makeCompany, makeSmsLog, type TestDb } from '../db/harness.js';

const CASH_IN =
  'Cash In Tk 1,500.00 from 01759584276 successful. Fee Tk 0.00. Balance Tk 1,502.70. TrxID DA56RP7N7C at 05/01/2026 16:55. Download App: https://bKa.sh/8app';
const CASH_OUT =
  'Cash Out Tk 2,000.00 to 01700000000 successful. Fee Tk 18.50. Balance Tk 500.00. TrxID DZ99XYZ123 at 05/01/2026 17:10';

let db: TestDb;
let app: INestApplication;
const now = new Date('2026-08-01T00:00:00.000Z');

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 5).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'parse-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'parse-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  // Seed active parser rules BEFORE the app boots its RuleRepository cache.
  await seed(db.prisma, {
    isProd: false,
    seedDev: false,
    adminEmail: 'a@b.co',
    adminPassword: 'seedpassword1',
  });
  app = await createApp();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('server ParserService (rules loaded from the database)', () => {
  it('parses a bKash Cash In using the active rule', () => {
    const res = app.get(ParserService).parse('bKash', CASH_IN, now);
    expect(res.status).toBe('PARSED');
    expect(res.provider).toBe('BKASH');
    expect(res.messageType).toBe('CASH_IN');
    expect(res.fields.transactionId).toBe('DA56RP7N7C');
    expect(res.fields.amount).toBe('1500.00');
    expect(res.fields.senderMsisdn).toBe('+8801759584276');
  });

  it('ignores a Cash Out (debit) with no extractable money fields', () => {
    const res = app.get(ParserService).parse('bKash', CASH_OUT, now);
    expect(res.status).toBe('IGNORED');
    expect(res.direction).toBe('DEBIT');
    expect(res.fields.transactionId).toBeUndefined();
    expect(res.fields.amount).toBeUndefined();
  });

  it('leaves a non-provider address UNPARSED', () => {
    const res = app.get(ParserService).parse('FRIEND', CASH_IN, now);
    expect(res.status).toBe('UNPARSED');
    expect(res.provider).toBe('UNKNOWN');
  });

  it('persists the extraction and flags a device hint mismatch', async () => {
    const company = await makeCompany(db.prisma);
    const sms = await makeSmsLog(db.prisma, company.id, {
      sms_address: 'bKash',
      raw_message: CASH_IN,
      parse_status: 'UNPARSED',
    });
    const ext = app
      .get(ParserService)
      .extract('bKash', CASH_IN, now, { transaction_id: 'WRONGID999' });
    expect(ext.hintMismatch).toBe(true);

    const prisma = app.get(PrismaService);
    const updated = await prisma.smsLog.update({ where: { id: sms.id }, data: ext.update });
    expect(updated.parse_status).toBe('PARSED');
    expect(updated.transaction_id).toBe('DA56RP7N7C');
    expect(updated.amount?.toFixed(2)).toBe('1500.00');
    expect(updated.sms_timestamp?.toISOString()).toBe('2026-01-05T10:55:00.000Z');
  });
});
