/** Client (website) API DTOs (architecture §7.3). Frozen in Task 07. */

import type {
  MatchMode,
  PaymentStatus,
  Provider,
  ReviewReason,
  VerificationMethod,
} from '../enums.js';

import type { DecimalString, IsoTimestamp } from './common.js';

export interface RegisterPaymentRequest {
  order_id: string;
  amount: DecimalString;
  transaction_id?: string;
  provider?: Provider;
  sender_msisdn?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentVerificationDetail {
  method: VerificationMethod;
  confidence: number;
  sender_msisdn: string | null;
  provider: Provider | null;
  received_amount: DecimalString | null;
  was_late: boolean;
}

export interface RegisterPaymentResponse {
  payment_request_id: string;
  order_id: string;
  status: PaymentStatus;
  match_mode: MatchMode;
  amount: DecimalString;
  transaction_id: string | null;
  expires_at: IsoTimestamp;
  created_at: IsoTimestamp;
  verified_at?: IsoTimestamp;
  verification?: PaymentVerificationDetail;
}

export interface PaymentStatusResponse {
  order_id: string;
  status: PaymentStatus;
  amount: DecimalString;
  transaction_id: string | null;
  provider: Provider | null;
  match_mode: MatchMode;
  expires_at: IsoTimestamp;
  created_at: IsoTimestamp;
  verified_at?: IsoTimestamp;
  verification?: PaymentVerificationDetail;
  review?: { reason: ReviewReason; opened_at: IsoTimestamp };
}

export interface CancelPaymentRequest {
  reason?: string;
}

/**
 * Correct a mistyped transaction id on a still-open order (ADR-14, resolved
 * architecture). Allowed only while PENDING or EXPIRED-within-grace; never
 * after VERIFIED. The server re-runs matching immediately and audits the change.
 */
export interface CorrectTransactionIdRequest {
  transaction_id: string;
}

export interface CorrectTransactionIdResponse {
  order_id: string;
  status: PaymentStatus;
  transaction_id: string;
  /** True if the correction immediately matched an already-captured SMS. */
  verified_now: boolean;
  verified_at?: IsoTimestamp;
}

export interface PaymentListQuery {
  status?: PaymentStatus;
  from?: IsoTimestamp;
  to?: IsoTimestamp;
  date_field?: 'created_at' | 'verified_at';
  provider?: Provider;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface PaymentListItem {
  order_id: string;
  status: PaymentStatus;
  amount: DecimalString;
  transaction_id: string | null;
  provider: Provider | null;
  created_at: IsoTimestamp;
  verified_at: IsoTimestamp | null;
}

export interface PaymentListResponse {
  items: PaymentListItem[];
  next_cursor: string | null;
  summary: {
    count_by_status: Record<string, number>;
    total_verified_amount: DecimalString;
  };
}
