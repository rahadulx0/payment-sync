import { Inject, Injectable, Logger } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';
import { Prisma } from '@prisma/client';

import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

import { applyDecision, type ApplyResult } from './apply-decision.js';
import { CandidateRepository } from './candidate.repository.js';
import { decide } from './core/decide.js';
import type { MatchDecision, MatchSettings, SmsFacts } from './core/types.js';
import { HEURISTIC_PASS, type HeuristicPassProvider } from './heuristic.token.js';
import { TraceService } from './trace.service.js';

type Tx = Prisma.TransactionClient;
type Trigger = 'SMS_UPLOAD' | 'ORDER_REGISTER' | 'RESCAN' | 'REPARSE' | 'ADMIN';

const TX_TIMEOUT_MS = 5000;
const REVERSE_CANDIDATE_LIMIT = 200;

type MatchStatus = 'MATCHED' | 'IN_REVIEW' | 'IGNORED' | 'UNMATCHED' | 'DUPLICATE_TXN';

export interface MatchRunResult {
  result: MatchDecision['result'];
  matchStatus: MatchStatus;
  paymentRequestId: string | null;
  verified: boolean;
  createdWebhookEventIds: string[];
}

function statusFor(result: MatchDecision['result']): MatchStatus {
  switch (result) {
    case 'VERIFIED':
      return 'MATCHED';
    case 'REVIEW':
      return 'IN_REVIEW';
    case 'DUPLICATE':
      return 'DUPLICATE_TXN';
    case 'IGNORED':
    case 'GUARD_REJECTED':
      return 'IGNORED';
    case 'UNMATCHED':
      return 'UNMATCHED';
  }
}

/**
 * The transactional matching runner (architecture §9.3, Task 08 §4.2). Every
 * run takes a per-company advisory lock *inside* the transaction, so matching
 * within one tenant is serialised (removing a whole class of races) while other
 * tenants proceed in parallel. The DB unique constraints are the real guarantee;
 * this logic is the optimisation.
 */
@Injectable()
export class MatchingService {
  private readonly log = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidates: CandidateRepository,
    private readonly trace: TraceService,
    private readonly metrics: MetricsService,
    @Inject(HEURISTIC_PASS) private readonly heuristic: HeuristicPassProvider,
  ) {}

  /** Forward path: match a freshly-ingested (or rescanned) SMS. Never throws to the caller. */
  async matchBySms(smsLogId: string, trigger: Trigger = 'SMS_UPLOAD'): Promise<MatchRunResult> {
    const unmatched: MatchRunResult = {
      result: 'UNMATCHED',
      matchStatus: 'UNMATCHED',
      paymentRequestId: null,
      verified: false,
      createdWebhookEventIds: [],
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.runOnce(smsLogId, trigger);
      } catch (err) {
        if (this.isConflict(err)) {
          this.metrics.matchingConflicts.inc();
          return await this.reconcileAfterConflict(smsLogId);
        }
        if (attempt === 0) {
          this.log.warn(`match retrying after error: ${String(err)}`);
          continue;
        }
        this.log.error(`match gave up, leaving UNMATCHED: ${String(err)}`);
        return unmatched;
      }
    }
    return unmatched;
  }

  /**
   * Reverse path (register / TrxID-correction): scan UNMATCHED credit SMS that
   * already carry this order's TrxID and verify synchronously if one matches.
   */
  async reverseMatchOrder(
    paymentRequestId: string,
    trigger: Trigger = 'ORDER_REGISTER',
  ): Promise<MatchRunResult | null> {
    const now = nowUtc();
    let captured: MatchOutcome | null = null;
    try {
      captured = await this.prisma.$transaction(
        async (tx) => {
          const order = await tx.paymentRequest.findUnique({ where: { id: paymentRequestId } });
          if (
            order === null ||
            order.match_mode !== 'EXACT' ||
            order.transaction_id === null ||
            (order.status !== 'PENDING' && order.status !== 'EXPIRED')
          ) {
            return null;
          }
          await this.lock(tx, order.company_id);
          const smsRows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM sms_logs
             WHERE company_id = ${order.company_id}::uuid
               AND transaction_id = ${order.transaction_id}
               AND match_status = 'UNMATCHED'
             ORDER BY sms_timestamp ASC NULLS LAST
             LIMIT ${REVERSE_CANDIDATE_LIMIT}
             FOR UPDATE`;
          for (const row of smsRows) {
            const outcome = await this.decideAndApply(tx, row.id, trigger, now);
            if (outcome !== null && outcome.decision.result === 'VERIFIED') return outcome;
          }
          return null;
        },
        { timeout: TX_TIMEOUT_MS },
      );
    } catch (err) {
      if (this.isConflict(err)) {
        this.metrics.matchingConflicts.inc();
        return null;
      }
      this.log.warn(`reverse match failed (non-fatal): ${String(err)}`);
      return null;
    }
    if (captured === null) return null;
    this.postCommit(captured, now);
    return this.toRunResult(captured);
  }

  private async runOnce(smsLogId: string, trigger: Trigger): Promise<MatchRunResult> {
    const now = nowUtc();
    const captured = await this.prisma.$transaction(
      async (tx) => this.decideAndApply(tx, smsLogId, trigger, now),
      { timeout: TX_TIMEOUT_MS },
    );
    if (captured === null) {
      return {
        result: 'UNMATCHED',
        matchStatus: 'UNMATCHED',
        paymentRequestId: null,
        verified: false,
        createdWebhookEventIds: [],
      };
    }
    this.postCommit(captured, now);
    return this.toRunResult(captured);
  }

  /** The critical section: lock, load, decide, apply, trace. Runs inside `tx`. */
  private async decideAndApply(
    tx: Tx,
    smsLogId: string,
    trigger: Trigger,
    now: Date,
  ): Promise<MatchOutcome | null> {
    const facts = await this.candidates.loadSmsFacts(tx, smsLogId);
    if (facts === null) return null;
    const { sms, settings, companyId } = facts;

    await this.lock(tx, companyId);

    const started = process.hrtime.bigint();
    const candidates =
      sms.trxId === null ? [] : await this.candidates.loadExactCandidates(tx, companyId, sms.trxId);
    const spent = new Set<string>();
    if (sms.trxId !== null) {
      const spentId = await this.candidates.findSpentVerification(tx, companyId, sms.trxId);
      if (spentId !== null) spent.add(sms.trxId);
    }

    const decision = decide({ sms, candidates, settings, spentTrxIds: spent, now }, this.heuristic);
    const applied = await applyDecision(tx, decision, sms, companyId, now);
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;

    await this.trace.record(tx, {
      companyId,
      trigger,
      smsLogId,
      paymentRequestId: null,
      decision,
      parserRuleVersion: null,
      durationMs,
    });

    return { companyId, sms, settings, decision, applied, durationMs };
  }

  private async lock(tx: Tx, companyId: string): Promise<void> {
    const t0 = process.hrtime.bigint();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
    this.metrics.matchingLockWait.observe(Number(process.hrtime.bigint() - t0) / 1e9);
  }

  private postCommit(o: MatchOutcome, now: Date): void {
    this.metrics.matchDecisions.inc({
      result: o.decision.result,
      pass: o.decision.result === 'VERIFIED' ? o.decision.pass : 'NONE',
    });
    this.metrics.matchingDuration.observe(o.durationMs / 1000);
    if (o.decision.result === 'DUPLICATE') this.metrics.duplicateTxn.inc();
    if (o.decision.result === 'VERIFIED' && o.sms.smsAt !== null) {
      this.metrics.verificationLatency.observe((now.getTime() - o.sms.smsAt.getTime()) / 1000);
    }
    // Task 09 enqueues delivery for o.applied.createdWebhookEventIds here; until
    // then the events sit PENDING with next_attempt_at and the sweeper delivers.
  }

  private toRunResult(o: MatchOutcome): MatchRunResult {
    return {
      result: o.decision.result,
      matchStatus: statusFor(o.decision.result),
      paymentRequestId: o.decision.result === 'VERIFIED' ? o.decision.paymentRequestId : null,
      verified: o.decision.result === 'VERIFIED',
      createdWebhookEventIds: o.applied.createdWebhookEventIds,
    };
  }

  private async reconcileAfterConflict(smsLogId: string): Promise<MatchRunResult> {
    const sms = await this.prisma.smsLog.findUnique({ where: { id: smsLogId } });
    const matchStatus = (sms?.match_status ?? 'UNMATCHED') as MatchStatus;
    return {
      result: matchStatus === 'MATCHED' ? 'VERIFIED' : 'UNMATCHED',
      matchStatus,
      paymentRequestId: null,
      verified: matchStatus === 'MATCHED',
      createdWebhookEventIds: [],
    };
  }

  private isConflict(err: unknown): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }
}

interface MatchOutcome {
  companyId: string;
  sms: SmsFacts;
  settings: MatchSettings;
  decision: MatchDecision;
  applied: ApplyResult;
  durationMs: number;
}
