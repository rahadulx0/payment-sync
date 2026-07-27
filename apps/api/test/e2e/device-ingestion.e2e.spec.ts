import { randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { seed } from '../../prisma/seed.js';
import { CredentialService } from '../../src/common/auth/credential.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';

const ENROLL_KEY = 'pde_live_deviceenrolkeyABC123456789';
const COMPANY_CODE = 'COMP-DEV-06';
const CASH_IN =
  'Cash In Tk 1,500.00 from 01759584276 successful. Fee Tk 0.00. Balance Tk 1,502.70. TrxID DA56RP7N7C at 05/01/2026 16:55';
const CASH_OUT =
  'Cash Out Tk 2,000.00 to 01700000000 successful. Fee Tk 18.50. Balance Tk 500.00. TrxID DZ99XYZ123 at 05/01/2026 17:10';

let db: TestDb;
let app: INestApplication;
const installId = uuidv7();
let deviceToken = '';

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}
function hex64() {
  return randomBytes(32).toString('hex');
}
function deviceAuth(r: request.Test) {
  return r.set('Authorization', `Bearer ${deviceToken}`).set('X-Install-Id', installId);
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 3).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'dev06-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'dev06-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  await seed(db.prisma, {
    isProd: false,
    seedDev: false,
    adminEmail: 'a@b.co',
    adminPassword: 'seedpassword1',
  });
  app = await createApp();
  await app.init();

  const prisma = app.get(PrismaService);
  const creds = app.get(CredentialService);
  const company = await prisma.company.create({
    data: { company_code: COMPANY_CODE, name: 'Dev06 Co', settings: { create: {} } },
  });
  await prisma.apiKey.create({
    data: {
      company_id: company.id,
      key_type: 'DEVICE_ENROLL',
      prefix: 'pde_live_',
      key_hash: await creds.hash(ENROLL_KEY),
      label: 'enrol',
      scopes: ['device:enroll'],
    },
  });
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('device enrollment', () => {
  it('enrols with the company code + enrol key and returns a device token + config', async () => {
    const res = await http().post('/api/v1/device/register').send({
      company_code: COMPANY_CODE,
      enroll_key: ENROLL_KEY,
      install_id: installId,
      model: 'Redmi Note 12',
      manufacturer: 'Xiaomi',
      android_version: '14',
      app_version: '1.0.0',
    });
    expect(res.status).toBe(201);
    expect(res.body.device_token).toMatch(/^pdt_/);
    expect(res.body.config.providers.length).toBeGreaterThan(0);
    expect(res.body.config.parser_rules.bkash).toBeDefined();
    deviceToken = res.body.device_token;
  });

  it('rejects a bad enrol key', async () => {
    const res = await http().post('/api/v1/device/register').send({
      company_code: COMPANY_CODE,
      enroll_key: 'pde_live_wrong000000000000000000000',
      install_id: uuidv7(),
      model: 'x',
      manufacturer: 'x',
      android_version: '14',
      app_version: '1.0.0',
    });
    expect(res.status).toBe(401);
  });
});

describe('device config', () => {
  it('serves config with an ETag and 304s on a matching If-None-Match', async () => {
    const first = await deviceAuth(http().get('/api/v1/device/config'));
    expect(first.status).toBe(200);
    const etag = first.headers['etag'];
    expect(etag).toBeDefined();
    const second = await deviceAuth(http().get('/api/v1/device/config')).set(
      'If-None-Match',
      etag ?? '',
    );
    expect(second.status).toBe(304);
  });
});

describe('sms upload', () => {
  const hash = hex64();

  it('accepts a bKash Cash In, parses it server-side, and returns per-message results', async () => {
    const res = await deviceAuth(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: hash,
          sms_address: 'bKash',
          raw_message: CASH_IN,
          device_received_at: '2026-01-05T10:56:00.000Z',
        },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.body.summary).toMatchObject({ accepted: 1, duplicates: 0, rejected: 0 });
    const r = res.body.results[0];
    expect(r.status).toBe('ACCEPTED');
    expect(r.parse_status).toBe('PARSED');
    expect(r.server_extraction.transaction_id).toBe('DA56RP7N7C');
    expect(r.server_extraction.amount).toBe('1500.00');
  });

  it('returns DUPLICATE (2xx) with the existing id on re-upload', async () => {
    const res = await deviceAuth(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: hash,
          sms_address: 'bKash',
          raw_message: CASH_IN,
          device_received_at: '2026-01-05T10:56:00.000Z',
        },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.body.results[0].status).toBe('DUPLICATE');
    expect(res.body.results[0].sms_log_id).toBeDefined();
  });

  it('accepts a Cash Out but marks it IGNORED (debit never matches)', async () => {
    const res = await deviceAuth(http().post('/api/v1/sms/upload')).send({
      upload_source: 'REALTIME',
      messages: [
        {
          client_msg_hash: hex64(),
          sms_address: 'bKash',
          raw_message: CASH_OUT,
          device_received_at: '2026-01-05T17:11:00.000Z',
        },
      ],
    });
    expect(res.status).toBe(202);
    expect(res.body.results[0].status).toBe('ACCEPTED');
    expect(res.body.results[0].parse_status).toBe('IGNORED');
  });

  it('dedupes identical messages within one batch', async () => {
    const dup = hex64();
    const res = await deviceAuth(http().post('/api/v1/sms/upload')).send({
      upload_source: 'MANUAL_SYNC',
      messages: [
        {
          client_msg_hash: dup,
          sms_address: 'bKash',
          raw_message:
            'You have received Tk 10.00 from 01712345678. Fee Tk 0.00. Balance Tk 20.00. TrxID ZZ11YY22XX at 27/07/2026 10:15',
          device_received_at: '2026-07-27T04:16:00.000Z',
        },
        {
          client_msg_hash: dup,
          sms_address: 'bKash',
          raw_message:
            'You have received Tk 10.00 from 01712345678. Fee Tk 0.00. Balance Tk 20.00. TrxID ZZ11YY22XX at 27/07/2026 10:15',
          device_received_at: '2026-07-27T04:16:00.000Z',
        },
      ],
    });
    expect(res.body.summary.accepted).toBe(1);
    expect(res.body.summary.duplicates).toBe(1);
  });
});

describe('heartbeat', () => {
  it('records telemetry, computes clock skew, and returns directives', async () => {
    const res = await deviceAuth(http().post('/api/v1/device/heartbeat')).send({
      app_version: '1.0.0',
      android_version: '14',
      battery_pct: 82,
      is_charging: true,
      is_ignoring_battery_opt: true,
      has_sms_permission: true,
      network_type: 'wifi',
      pending_upload_count: 0,
      failed_upload_count: 0,
      device_now: new Date().toISOString(),
      config_version: 0,
    });
    expect(res.status).toBe(201);
    expect(res.body.directives).toBeDefined();
    expect(res.body.directives.config_changed).toBe(true);
    expect(res.body.next_heartbeat_after_sec).toBe(900);
  });
});
