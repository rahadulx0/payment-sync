import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { uuidv7 } from '@paysync/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { CredentialService } from '../../src/common/auth/credential.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';

let db: TestDb;
let app: INestApplication;

const SERVER_KEY = 'psk_live_e2eserverkeyABC123456789';
const COMPANY_CODE = 'COMP-E2E-1';
const DEVICE_TOKEN = 'pdt_e2edevicetokenABC123456789';
const DEVICE_INSTALL = uuidv7();

let companyId = '';
let adminJwt = '';
let adminJwtNoTotp = '';
let suspendedKey = '';
let suspendedCode = '';
let revokedKey = '';

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'test-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  process.env['ADMIN_ORIGIN'] = 'http://localhost:3001';
  process.env['ADMIN_IP_ALLOWLIST'] = '';

  app = await createApp();
  await app.init();

  const prisma = app.get(PrismaService);
  const creds = app.get(CredentialService);
  const jwt = app.get(JwtService);

  const company = await prisma.company.create({
    data: { company_code: COMPANY_CODE, name: 'E2E Co', settings: { create: {} } },
  });
  companyId = company.id;
  await prisma.apiKey.create({
    data: {
      company_id: companyId,
      key_type: 'SERVER',
      prefix: 'psk_live_',
      key_hash: await creds.hash(SERVER_KEY),
      label: 'e2e server',
      scopes: ['payments:read', 'payments:write'],
    },
  });
  revokedKey = 'psk_live_e2erevokedkey000000000000';
  await prisma.apiKey.create({
    data: {
      company_id: companyId,
      key_type: 'SERVER',
      prefix: 'psk_live_',
      key_hash: await creds.hash(revokedKey),
      label: 'revoked',
      scopes: ['payments:read'],
      revoked_at: new Date(),
    },
  });
  await prisma.device.create({
    data: {
      company_id: companyId,
      device_name: 'E2E Phone',
      install_id: DEVICE_INSTALL,
      token_hash: await creds.hash(DEVICE_TOKEN),
    },
  });

  suspendedCode = 'COMP-E2E-SUSP';
  suspendedKey = 'psk_live_e2esuspendedkey0000000000';
  const suspended = await prisma.company.create({
    data: {
      company_code: suspendedCode,
      name: 'Suspended Co',
      status: 'SUSPENDED',
      settings: { create: {} },
    },
  });
  await prisma.apiKey.create({
    data: {
      company_id: suspended.id,
      key_type: 'SERVER',
      prefix: 'psk_live_',
      key_hash: await creds.hash(suspendedKey),
      label: 'suspended',
      scopes: ['payments:read'],
    },
  });

  const adminId = uuidv7();
  adminJwt = jwt.sign({ sub: adminId, totp_verified: true });
  adminJwtNoTotp = jwt.sign({ sub: adminId, totp_verified: false });
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('health', () => {
  it('healthz is public and ok', async () => {
    const res = await http().get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeDefined();
  });
  it('readyz reports db and redis healthy', async () => {
    const res = await http().get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ db: true, redis: true });
  });
});

describe('auth matrix', () => {
  it('server key + matching company id → 200', async () => {
    const res = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${SERVER_KEY}`)
      .set('X-Company-Id', COMPANY_CODE);
    expect(res.status).toBe(200);
    expect(res.body.audience).toBe('server');
    expect(res.body.company.companyId).toBe(companyId);
  });

  it('server key with a mismatched company id → 401', async () => {
    const res = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${SERVER_KEY}`)
      .set('X-Company-Id', 'COMP-OTHER');
    expect(res.status).toBe(401);
  });

  it('server route without X-Company-Id → 401', async () => {
    const res = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${SERVER_KEY}`);
    expect(res.status).toBe(401);
  });

  it('revoked key → 401', async () => {
    const res = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${revokedKey}`)
      .set('X-Company-Id', COMPANY_CODE);
    expect(res.status).toBe(401);
  });

  it('suspended company → 403 COMPANY_SUSPENDED', async () => {
    const res = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${suspendedKey}`)
      .set('X-Company-Id', suspendedCode);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('device token + install id → 200', async () => {
    const res = await http()
      .get('/api/v1/probe/device')
      .set('Authorization', `Bearer ${DEVICE_TOKEN}`)
      .set('X-Install-Id', DEVICE_INSTALL);
    expect(res.status).toBe(200);
    expect(res.body.device.installId).toBe(DEVICE_INSTALL);
  });

  it('device token on the server route → 401', async () => {
    const res = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${DEVICE_TOKEN}`)
      .set('X-Company-Id', COMPANY_CODE);
    expect(res.status).toBe(401);
  });

  it('server key on the device route → 401', async () => {
    const res = await http()
      .get('/api/v1/probe/device')
      .set('Authorization', `Bearer ${SERVER_KEY}`)
      .set('X-Install-Id', DEVICE_INSTALL);
    expect(res.status).toBe(401);
  });

  it('admin JWT with totp_verified → 200', async () => {
    const res = await http().get('/api/v1/probe/admin').set('Authorization', `Bearer ${adminJwt}`);
    expect(res.status).toBe(200);
    expect(res.body.audience).toBe('admin');
  });

  it('admin JWT without totp_verified → 401', async () => {
    const res = await http()
      .get('/api/v1/probe/admin')
      .set('Authorization', `Bearer ${adminJwtNoTotp}`);
    expect(res.status).toBe(401);
  });

  it('missing credentials → 401', async () => {
    expect((await http().get('/api/v1/probe/server')).status).toBe(401);
    expect((await http().get('/api/v1/probe/admin')).status).toBe(401);
  });
});

describe('default-deny', () => {
  it('a route with no audience decorator is not reachable', async () => {
    const res = await http().get('/api/v1/probe/undecorated');
    expect(res.status).toBe(401);
  });
});

describe('idempotency', () => {
  const serverAuth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${SERVER_KEY}`).set('X-Company-Id', COMPANY_CODE);

  it('replays the stored response for the same key + body, and 409s on reuse with a different body', async () => {
    const first = await serverAuth(
      http().post('/api/v1/probe/idempotent').set('Idempotency-Key', 'idem-1').send({ a: 1 }),
    );
    expect(first.status).toBe(201);
    expect(first.body.received).toEqual({ a: 1 });

    const replay = await serverAuth(
      http().post('/api/v1/probe/idempotent').set('Idempotency-Key', 'idem-1').send({ a: 1 }),
    );
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.received).toEqual({ a: 1 });

    const reused = await serverAuth(
      http().post('/api/v1/probe/idempotent').set('Idempotency-Key', 'idem-1').send({ a: 2 }),
    );
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('rate limiting', () => {
  it('rejects past the limit with 429 and rate-limit headers', async () => {
    const call = () =>
      http()
        .get('/api/v1/probe/rate-limited')
        .set('Authorization', `Bearer ${SERVER_KEY}`)
        .set('X-Company-Id', COMPANY_CODE);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await call();
      statuses.push(res.status);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses[3]).toBe(429);
  });
});

describe('tenant isolation', () => {
  it('a company-scoped client sees only its own rows', async () => {
    const prisma = app.get(PrismaService);
    const other = await prisma.company.create({
      data: {
        company_code: `COMP-OTHER-${uuidv7().slice(0, 8)}`,
        name: 'Other',
        settings: { create: {} },
      },
    });
    const mk = (cid: string) =>
      prisma.smsLog.create({
        data: {
          company_id: cid,
          client_msg_hash: uuidv7().replace(/-/g, '').padEnd(64, '0'),
          content_hash: uuidv7().replace(/-/g, '').padEnd(64, '0'),
          sms_address: 'bKash',
          raw_message: 'x',
          device_received_at: new Date(),
        },
      });
    await mk(companyId);
    await mk(companyId);
    await mk(other.id);

    const scoped = prisma.forCompany(companyId);
    const mine = await scoped.smsLog.findMany();
    expect(mine.length).toBe(2);
    expect(mine.every((r) => r.company_id === companyId)).toBe(true);

    const otherScoped = prisma.forCompany(other.id);
    expect(await otherScoped.smsLog.count()).toBe(1);
  });
});
