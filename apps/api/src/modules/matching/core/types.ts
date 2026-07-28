import type { Money } from '@paysync/shared';

/** A parse direction as produced by the parser (packages/parsers). */
export type Direction = 'CREDIT' | 'DEBIT' | 'INFO';
export type ParseStatusValue = 'PARSED' | 'PARTIAL' | 'UNPARSED' | 'IGNORED';
export type PaymentStatusValue =
  | 'PENDING'
  | 'VERIFIED'
  | 'MANUAL_REVIEW'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REJECTED';

/**
 * The facts the pure core needs about one SMS. No Prisma rows, no clock — the
 * runner reads the DB and hands a plain snapshot in. Amounts are already `Money`.
 */
export interface SmsFacts {
  smsLogId: string;
  provider: string;
  direction: Direction | null;
  parseStatus: ParseStatusValue;
  trxId: string | null;
  amount: Money | null;
  senderMsisdn: string | null;
  smsAt: Date | null;
  companyStatus: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  deviceStatus: 'ACTIVE' | 'BLOCKED' | 'RETIRED' | null;
}

/** The facts the core needs about one candidate order. */
export interface OrderFacts {
  paymentRequestId: string;
  orderId: string;
  trxId: string | null;
  expectedAmount: Money;
  tolerance: Money;
  status: PaymentStatusValue;
  expiresAt: Date;
  createdAt: Date;
  matchMode: 'EXACT' | 'HEURISTIC';
  expectedProvider: string | null;
  expectedSenderMsisdn: string | null;
}

export interface MatchSettings {
  allowedProviders: string[];
  lateMatchGraceHours: number;
  notifyOnReview: boolean;
  heuristicEnabled: boolean;
  heuristicWindowMinutes: number;
  requireSenderMatch: boolean;
  autoVerifyMinConfidence: number;
}

export interface MatchInput {
  sms: SmsFacts;
  /** Exact-pass candidates: PENDING/EXPIRED orders sharing the SMS TrxID. */
  candidates: OrderFacts[];
  /** Heuristic-pass candidates: PENDING, transaction_id IS NULL, amount+window+sender (Task 10). */
  heuristicCandidates: OrderFacts[];
  settings: MatchSettings;
  /** TrxIDs already consumed by a verified_transaction for this company. */
  spentTrxIds: Set<string>;
  now: Date;
}

export type GuardName =
  | 'COMPANY_NOT_ACTIVE'
  | 'DEVICE_NOT_ACTIVE'
  | 'DIRECTION_NOT_CREDIT'
  | 'PROVIDER_NOT_ALLOWED'
  | 'PARSE_STATUS_UNUSABLE'
  | 'AMOUNT_MISSING_OR_ZERO';

export type IgnoreReason = 'DEBIT_MESSAGE' | 'INFO_MESSAGE';
export type ReviewReasonValue =
  | 'AMBIGUOUS_CANDIDATES'
  | 'AMOUNT_MISMATCH'
  | 'DUPLICATE_TXN_ID'
  | 'SUSPICIOUS_SMS'
  | 'UNPARSED_MESSAGE';

export interface ScoredCandidate {
  paymentRequestId: string;
  orderId: string;
  expectedAmount: string;
  receivedAmount: string;
  amountDelta: string;
  note: string;
  score?: number;
  signals?: Record<string, number>;
  why?: string[];
}

export type MatchDecision =
  | {
      result: 'VERIFIED';
      pass: 'EXACT' | 'HEURISTIC';
      paymentRequestId: string;
      orderId: string;
      confidence: number;
      amountDelta: Money;
      wasLate: boolean;
      flags: string[];
    }
  | { result: 'REVIEW'; reason: ReviewReasonValue; candidates: ScoredCandidate[] }
  | { result: 'DUPLICATE'; trxId: string }
  | { result: 'IGNORED'; reason: IgnoreReason }
  | { result: 'GUARD_REJECTED'; guard: GuardName }
  | { result: 'UNMATCHED' };
