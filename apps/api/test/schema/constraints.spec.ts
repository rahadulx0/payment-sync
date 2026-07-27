import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDb,
  dropTestDb,
  makeCompany,
  makePaymentRequest,
  makeSmsLog,
  makeVerifiedTransaction,
  truncateAll,
  type TestDb,
} from '../db/harness.js';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await dropTestDb(db);
});
beforeEach(async () => {
  await truncateAll(db.prisma);
});

/** Resolve the Prisma error code of a rejected promise (undefined if it resolved). */
async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

/** Resolve the message of a rejected promise (empty string if it resolved). */
async function errorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe('verified_transactions double-UNIQUE (the money guarantee)', () => {
  it('one order can be verified at most once', async () => {
    const c = await makeCompany(db.prisma);
    const pr = await makePaymentRequest(db.prisma, c.id, { transaction_id: 'TRXORDER1' });
    const s1 = await makeSmsLog(db.prisma, c.id);
    const s2 = await makeSmsLog(db.prisma, c.id);
    await makeVerifiedTransaction(db.prisma, {
      companyId: c.id,
      paymentRequestId: pr.id,
      smsLogId: s1.id,
    });
    expect(
      await errorCode(
        makeVerifiedTransaction(db.prisma, {
          companyId: c.id,
          paymentRequestId: pr.id,
          smsLogId: s2.id,
        }),
      ),
    ).toBe('P2002');
  });

  it('one SMS can be spent at most once', async () => {
    const c = await makeCompany(db.prisma);
    const pr1 = await makePaymentRequest(db.prisma, c.id, { order_id: 'O1', transaction_id: 'T1' });
    const pr2 = await makePaymentRequest(db.prisma, c.id, { order_id: 'O2', transaction_id: 'T2' });
    const s = await makeSmsLog(db.prisma, c.id);
    await makeVerifiedTransaction(db.prisma, {
      companyId: c.id,
      paymentRequestId: pr1.id,
      smsLogId: s.id,
    });
    expect(
      await errorCode(
        makeVerifiedTransaction(db.prisma, {
          companyId: c.id,
          paymentRequestId: pr2.id,
          smsLogId: s.id,
        }),
      ),
    ).toBe('P2002');
  });
});

describe('idempotency uniques', () => {
  it('blocks a duplicate (company_id, client_msg_hash)', async () => {
    const c = await makeCompany(db.prisma);
    const hash = 'a'.repeat(64);
    await makeSmsLog(db.prisma, c.id, { client_msg_hash: hash });
    expect(await errorCode(makeSmsLog(db.prisma, c.id, { client_msg_hash: hash }))).toBe('P2002');
  });

  it('blocks a duplicate (company_id, order_id)', async () => {
    const c = await makeCompany(db.prisma);
    await makePaymentRequest(db.prisma, c.id, { order_id: 'DUP' });
    expect(await errorCode(makePaymentRequest(db.prisma, c.id, { order_id: 'DUP' }))).toBe('P2002');
  });
});

describe('partial-unique live TrxID index', () => {
  it('blocks two live orders sharing a TrxID, but allows reuse after CANCELLED', async () => {
    const c = await makeCompany(db.prisma);
    await makePaymentRequest(db.prisma, c.id, { order_id: 'A', transaction_id: 'TX' });
    expect(
      await errorCode(makePaymentRequest(db.prisma, c.id, { order_id: 'B', transaction_id: 'TX' })),
    ).toBe('P2002');

    await db.prisma.paymentRequest.update({
      where: { company_id_order_id: { company_id: c.id, order_id: 'A' } },
      data: { status: 'CANCELLED' },
    });

    const reused = await makePaymentRequest(db.prisma, c.id, {
      order_id: 'C',
      transaction_id: 'TX',
    });
    expect(reused.transaction_id).toBe('TX');
  });
});

describe('one OPEN review per (sms, order) pair', () => {
  it('blocks a duplicate open review', async () => {
    const c = await makeCompany(db.prisma);
    const s = await makeSmsLog(db.prisma, c.id);
    const pr = await makePaymentRequest(db.prisma, c.id);
    const data = {
      company_id: c.id,
      sms_log_id: s.id,
      payment_request_id: pr.id,
      reason: 'AMBIGUOUS_CANDIDATES',
      candidates: [],
      status: 'OPEN',
    } as const;
    await db.prisma.matchReview.create({ data });
    expect(await errorCode(db.prisma.matchReview.create({ data }))).toBe('P2002');
  });
});

describe('CHECK constraints fail closed', () => {
  it('rejects a non-positive expected_amount', async () => {
    const c = await makeCompany(db.prisma);
    const sql = `INSERT INTO payment_requests (company_id, order_id, expected_amount, callback_url, match_mode, amount_tolerance, expires_at)
      VALUES ('${c.id}','Z', 0, 'https://x.example.com', 'EXACT', 0, now())`;
    expect(await errorMessage(db.prisma.$executeRawUnsafe(sql))).toMatch(/pr_amount_positive/);
  });

  it('rejects a non-https callback_url', async () => {
    const c = await makeCompany(db.prisma);
    const sql = `INSERT INTO payment_requests (company_id, order_id, expected_amount, callback_url, match_mode, amount_tolerance, expires_at)
      VALUES ('${c.id}','Z2', 100, 'http://x.example.com', 'EXACT', 0, now())`;
    expect(await errorMessage(db.prisma.$executeRawUnsafe(sql))).toMatch(/pr_callback_https/);
  });

  it('rejects a negative SMS amount', async () => {
    const c = await makeCompany(db.prisma);
    const sql = `INSERT INTO sms_logs (company_id, client_msg_hash, content_hash, sms_address, raw_message, device_received_at, amount)
      VALUES ('${c.id}','${'b'.repeat(64)}','${'c'.repeat(64)}','bKash','x', now(), -5)`;
    expect(await errorMessage(db.prisma.$executeRawUnsafe(sql))).toMatch(/sms_amount_nonneg/);
  });

  it('rejects a verification confidence outside (0,1]', async () => {
    const c = await makeCompany(db.prisma);
    const pr = await makePaymentRequest(db.prisma, c.id);
    const s = await makeSmsLog(db.prisma, c.id);
    const sql = `INSERT INTO verified_transactions (company_id, payment_request_id, sms_log_id, verification_method, confidence, amount_delta)
      VALUES ('${c.id}','${pr.id}','${s.id}','EXACT_TXN_ID', 1.5, 0)`;
    expect(await errorMessage(db.prisma.$executeRawUnsafe(sql))).toMatch(/vt_confidence_range/);
  });

  it('requires a review row to name at least one subject', async () => {
    const c = await makeCompany(db.prisma);
    const sql = `INSERT INTO match_reviews (company_id, reason, candidates, status)
      VALUES ('${c.id}','AMBIGUOUS_CANDIDATES','[]'::jsonb,'OPEN')`;
    expect(await errorMessage(db.prisma.$executeRawUnsafe(sql))).toMatch(/mr_subject_present/);
  });
});
