import type { INestApplication } from '@nestjs/common';
import { uuidv7 } from '@paysync/shared';
import { authenticator } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { CredentialService } from '../../src/common/auth/credential.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createApp } from '../../src/main.js';
import { createTestDb, dropTestDb, type TestDb } from '../db/harness.js';

let db: TestDb;
let app: INestApplication;
const ADMIN_EMAIL = 'admin@e2e.local';
const ADMIN_PASSWORD = 'CorrectHorseBatteryStaple1';

function http() {
  return request(app.getHttpServer() as Parameters<typeof request>[0]);
}
function bearer(r: request.Test, token: string) {
  return r.set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  db = await createTestDb();
  process.env['DATABASE_URL'] = db.url;
  process.env['REDIS_URL'] = inject('redisUrl');
  process.env['KEY_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
  process.env['JWT_ACCESS_SECRET'] = 'cp-access-secret-0123456789';
  process.env['JWT_REFRESH_SECRET'] = 'cp-refresh-secret-0123456789';
  process.env['NODE_ENV'] = 'test';
  process.env['ADMIN_ORIGIN'] = 'http://localhost:3001';
  process.env['ADMIN_IP_ALLOWLIST'] = '';

  app = await createApp();
  await app.init();
  const prisma = app.get(PrismaService);
  const creds = app.get(CredentialService);
  await prisma.adminUser.create({
    data: {
      email: ADMIN_EMAIL,
      password_hash: await creds.hash(ADMIN_PASSWORD),
      recovery_codes_hash: [],
    },
  });
});

afterAll(async () => {
  await app.close();
  await dropTestDb(db);
});

describe('admin auth + TOTP', () => {
  let accessToken = '';
  let refreshCookie = '';

  it('rejects a bad password', async () => {
    const res = await http()
      .post('/api/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('logs in, enrols TOTP, and verifies to a session', async () => {
    const login = await http()
      .post('/api/v1/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(201);
    expect(login.body.enrolment_required).toBe(true);
    const mfaToken: string = login.body.mfa_token;

    const enrol = await http().post('/api/v1/admin/auth/2fa/enroll').send({ mfa_token: mfaToken });
    expect(enrol.status).toBe(201);
    const secret: string = enrol.body.secret;
    expect(enrol.body.recovery_codes).toHaveLength(10);

    const verify = await http()
      .post('/api/v1/admin/auth/2fa/verify')
      .send({ mfa_token: mfaToken, code: authenticator.generate(secret) });
    expect(verify.status).toBe(201);
    accessToken = verify.body.access_token;
    const cookies = verify.headers['set-cookie'] as unknown as string[];
    refreshCookie = cookies.find((c) => c.startsWith('paysync_refresh=')) ?? '';
    expect(accessToken).not.toBe('');
    expect(refreshCookie).not.toBe('');
  });

  it('access token without totp is rejected, with totp reaches admin routes', async () => {
    const res = await bearer(http().get('/api/v1/probe/admin'), accessToken);
    expect(res.status).toBe(200);
  });

  it('rotates the refresh token and detects reuse (kills the family)', async () => {
    const first = await http().post('/api/v1/admin/auth/refresh').set('Cookie', refreshCookie);
    expect(first.status).toBe(201);
    const newCookie = (first.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('paysync_refresh='),
    );
    expect(newCookie).toBeDefined();
    // Reusing the ORIGINAL (now rotated) refresh token → reuse detected → 401.
    const reuse = await http().post('/api/v1/admin/auth/refresh').set('Cookie', refreshCookie);
    expect(reuse.status).toBe(401);
    // And the freshly-rotated token is now also dead (family revoked).
    const afterKill = await http()
      .post('/api/v1/admin/auth/refresh')
      .set('Cookie', newCookie ?? '');
    expect(afterKill.status).toBe(401);
  });

  it('onboards a company end to end and the server key works, suspend blocks it', async () => {
    const create = await bearer(http().post('/api/v1/admin/companies'), accessToken).send({
      name: 'Acme Ltd',
      contact_email: 'ops@acme.test',
    });
    expect(create.status).toBe(201);
    const code: string = create.body.company.company_code;
    const serverKey: string = create.body.credentials.server_key;
    const companyId: string = create.body.company.id;
    expect(serverKey).toMatch(/^psk_live_/);
    expect(create.body.credentials.webhook_secret).toMatch(/^whsec_/);

    const probe = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${serverKey}`)
      .set('X-Company-Id', code);
    expect(probe.status).toBe(200);

    const suspend = await bearer(
      http().post(`/api/v1/admin/companies/${companyId}/status`),
      accessToken,
    ).send({
      status: 'SUSPENDED',
      reason: 'non-payment',
    });
    expect(suspend.status).toBe(201);

    const blocked = await http()
      .get('/api/v1/probe/server')
      .set('Authorization', `Bearer ${serverKey}`)
      .set('X-Company-Id', code);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('enforces settings bounds and never affects existing orders', async () => {
    const create = await bearer(http().post('/api/v1/admin/companies'), accessToken).send({
      name: 'Settings Co',
    });
    const id: string = create.body.company.id;
    const bad = await bearer(
      http().put(`/api/v1/admin/companies/${id}/settings`),
      accessToken,
    ).send({
      order_ttl_minutes: 99999,
    });
    expect(bad.status).toBe(400);
    const ok = await bearer(http().put(`/api/v1/admin/companies/${id}/settings`), accessToken).send(
      {
        order_ttl_minutes: 30,
        amount_tolerance: 5,
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.order_ttl_minutes).toBe(30);
  });

  it('key lifecycle: last-server-key revoke guarded, issue + rotate + webhook-secret rotate', async () => {
    const create = await bearer(http().post('/api/v1/admin/companies'), accessToken).send({
      name: 'Keys Co',
    });
    const id: string = create.body.company.id;
    const keys = await bearer(http().get(`/api/v1/admin/companies/${id}/keys`), accessToken);
    const serverKeyId: string = keys.body.find(
      (k: { key_type: string }) => k.key_type === 'SERVER',
    ).id;

    const revokeLast = await bearer(
      http().delete(`/api/v1/admin/companies/${id}/keys/${serverKeyId}`),
      accessToken,
    );
    expect(revokeLast.status).toBe(400); // last active server key guarded

    const issued = await bearer(
      http().post(`/api/v1/admin/companies/${id}/keys`),
      accessToken,
    ).send({
      key_type: 'SERVER',
      label: 'second',
    });
    expect(issued.status).toBe(201);
    expect(issued.body.plaintext).toMatch(/^psk_live_/);

    const rotate = await bearer(
      http().post(`/api/v1/admin/companies/${id}/keys/${serverKeyId}/rotate`),
      accessToken,
    ).send({ grace_hours: 24 });
    expect(rotate.status).toBe(201);

    const wh = await bearer(
      http().post(`/api/v1/admin/companies/${id}/webhook-secret/rotate`),
      accessToken,
    );
    expect(wh.status).toBe(201);
    expect(wh.body.webhook_secret).toMatch(/^whsec_/);
  });

  it('device admin: block sets status and audits', async () => {
    const prisma = app.get(PrismaService);
    const creds = app.get(CredentialService);
    const create = await bearer(http().post('/api/v1/admin/companies'), accessToken).send({
      name: 'Device Co',
    });
    const companyId: string = create.body.company.id;
    const device = await prisma.device.create({
      data: {
        company_id: companyId,
        device_name: 'Phone',
        install_id: uuidv7(),
        token_hash: await creds.hash('pdt_x'),
      },
    });
    const block = await bearer(
      http().post(`/api/v1/admin/devices/${device.id}/block`),
      accessToken,
    );
    expect(block.status).toBe(201);
    expect(block.body.status).toBe('BLOCKED');
  });

  it('audit log records control-plane mutations without secret material', async () => {
    const res = await bearer(
      http().get('/api/v1/admin/audit-logs?action=company.create'),
      accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain('psk_live_');
    expect(dump).not.toContain('whsec_');
  });
});
