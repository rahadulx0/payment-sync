import { Money, type WebhookVerifiedData } from '@paysync/shared';
import { Prisma } from '@prisma/client';

import type { MatchDecision, SmsFacts } from './core/types.js';

type Tx = Prisma.TransactionClient;

export interface ApplyResult {
  createdWebhookEventIds: string[];
  verifiedAt: Date | null;
}

/**
 * Persist the effects of a decision inside the caller's transaction. Every
 * write here — verification, order status, SMS status, webhook event — commits
 * atomically. Webhook rows are created here and only *enqueued* after commit
 * (architecture §14); if the process dies in between, the Task 09 sweeper picks
 * them up from `next_attempt_at`.
 *
 * A unique-violation on `verified_transactions` is NOT caught here — it is the
 * DB doing its job, and the runner's conflict handler turns it into a no-op.
 */
export async function applyDecision(
  tx: Tx,
  decision: MatchDecision,
  sms: SmsFacts,
  companyId: string,
  now: Date,
): Promise<ApplyResult> {
  switch (decision.result) {
    case 'VERIFIED':
      return applyVerified(tx, decision, sms, companyId, now);
    case 'REVIEW':
      return applyReview(tx, decision, sms, companyId);
    case 'DUPLICATE':
      return applyDuplicate(tx, decision, sms, companyId);
    case 'IGNORED':
    case 'GUARD_REJECTED':
      await setSmsStatus(tx, sms.smsLogId, 'IGNORED');
      return { createdWebhookEventIds: [], verifiedAt: null };
    case 'UNMATCHED':
      await setSmsStatus(tx, sms.smsLogId, 'UNMATCHED');
      return { createdWebhookEventIds: [], verifiedAt: null };
  }
}

async function applyVerified(
  tx: Tx,
  decision: Extract<MatchDecision, { result: 'VERIFIED' }>,
  sms: SmsFacts,
  companyId: string,
  now: Date,
): Promise<ApplyResult> {
  const pr = await tx.paymentRequest.findUniqueOrThrow({
    where: { id: decision.paymentRequestId },
  });

  await tx.verifiedTransaction.create({
    data: {
      company_id: companyId,
      payment_request_id: decision.paymentRequestId,
      sms_log_id: sms.smsLogId,
      verification_method: decision.pass === 'EXACT' ? 'EXACT_TXN_ID' : 'HEURISTIC_AMOUNT_WINDOW',
      confidence: decision.confidence,
      amount_delta: decision.amountDelta.toDecimalString(),
      was_late: decision.wasLate,
      verified_at: now,
    },
  });

  await tx.paymentRequest.update({
    where: { id: decision.paymentRequestId },
    data: { status: 'VERIFIED', verified_at: now },
  });

  await setSmsStatus(tx, sms.smsLogId, 'MATCHED', decision.flags);

  const received = sms.amount ?? Money.zero();
  const data: WebhookVerifiedData = {
    status: 'VERIFIED',
    order_id: pr.order_id,
    payment_request_id: pr.id,
    transaction_id: pr.transaction_id,
    amount: received.toDecimalString(),
    expected_amount: Money.fromPrismaDecimal(pr.expected_amount).toDecimalString(),
    provider: sms.provider,
    sender_msisdn: sms.senderMsisdn,
    verified_at: now.toISOString(),
    verification_method: decision.pass === 'EXACT' ? 'EXACT_TXN_ID' : 'HEURISTIC_AMOUNT_WINDOW',
    confidence: decision.confidence,
    was_late: decision.wasLate,
    metadata: (pr.metadata as Record<string, unknown> | null) ?? {},
  };
  const event = await tx.webhookEvent.create({
    data: {
      company_id: companyId,
      payment_request_id: pr.id,
      event_type: 'payment.verified',
      payload: data as unknown as Prisma.InputJsonValue,
      status: 'PENDING',
      next_attempt_at: now,
    },
  });

  return { createdWebhookEventIds: [event.id], verifiedAt: now };
}

async function applyReview(
  tx: Tx,
  decision: Extract<MatchDecision, { result: 'REVIEW' }>,
  sms: SmsFacts,
  companyId: string,
): Promise<ApplyResult> {
  await insertReview(tx, {
    company_id: companyId,
    sms_log_id: sms.smsLogId,
    payment_request_id: decision.candidates[0]?.paymentRequestId ?? null,
    reason: decision.reason,
    candidates: decision.candidates as unknown as Prisma.InputJsonValue,
  });
  await setSmsStatus(tx, sms.smsLogId, 'IN_REVIEW');
  return { createdWebhookEventIds: [], verifiedAt: null };
}

async function applyDuplicate(
  tx: Tx,
  decision: Extract<MatchDecision, { result: 'DUPLICATE' }>,
  sms: SmsFacts,
  companyId: string,
): Promise<ApplyResult> {
  await insertReview(tx, {
    company_id: companyId,
    sms_log_id: sms.smsLogId,
    payment_request_id: null,
    reason: 'DUPLICATE_TXN_ID',
    candidates: { trxId: decision.trxId } as unknown as Prisma.InputJsonValue,
  });
  await setSmsStatus(tx, sms.smsLogId, 'DUPLICATE_TXN', ['DUPLICATE_TXN']);
  return { createdWebhookEventIds: [], verifiedAt: null };
}

async function setSmsStatus(
  tx: Tx,
  smsLogId: string,
  status: 'MATCHED' | 'IN_REVIEW' | 'IGNORED' | 'UNMATCHED' | 'DUPLICATE_TXN',
  appendFlags: string[] = [],
): Promise<void> {
  if (appendFlags.length === 0) {
    await tx.smsLog.update({ where: { id: smsLogId }, data: { match_status: status } });
    return;
  }
  // Append flags without clobbering existing ones (raw array_cat + dedupe).
  await tx.$executeRaw`
    UPDATE sms_logs
       SET match_status = ${status}::"MatchStatus",
           flags = ARRAY(SELECT DISTINCT unnest(flags || ${appendFlags}::text[]))
     WHERE id = ${smsLogId}::uuid`;
}

/** At most one OPEN review per (sms, order) — the partial unique index does the enforcing. */
async function insertReview(
  tx: Tx,
  data: {
    company_id: string;
    sms_log_id: string | null;
    payment_request_id: string | null;
    reason: string;
    candidates: Prisma.InputJsonValue;
  },
): Promise<void> {
  try {
    await tx.matchReview.create({
      data: {
        company_id: data.company_id,
        sms_log_id: data.sms_log_id,
        payment_request_id: data.payment_request_id,
        reason: data.reason as never,
        candidates: data.candidates,
      },
    });
  } catch (e) {
    // A duplicate OPEN review is expected under rescans — never fail the match.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
  }
}
