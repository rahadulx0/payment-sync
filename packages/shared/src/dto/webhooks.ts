/** Webhook payload + headers (architecture §10.1). */

import type { VerificationMethod, WebhookEventType } from '../enums.js';

import type { DecimalString, IsoTimestamp } from './common.js';

export interface WebhookVerifiedData {
  status: 'VERIFIED';
  order_id: string;
  payment_request_id: string;
  transaction_id: string | null;
  amount: DecimalString;
  expected_amount: DecimalString;
  provider: string;
  sender_msisdn: string | null;
  verified_at: IsoTimestamp;
  verification_method: VerificationMethod;
  confidence: number;
  was_late: boolean;
  metadata: Record<string, unknown>;
}

export interface WebhookEnvelope<TData = Record<string, unknown>> {
  event_id: string;
  event_type: WebhookEventType;
  created_at: IsoTimestamp;
  data: TData;
}

/** Header names for the signed webhook POST. */
export const WEBHOOK_HEADERS = {
  EVENT_ID: 'X-PaySync-Event-Id',
  EVENT_TYPE: 'X-PaySync-Event-Type',
  TIMESTAMP: 'X-PaySync-Timestamp',
  SIGNATURE: 'X-PaySync-Signature',
  ATTEMPT: 'X-PaySync-Attempt',
} as const;

export interface WebhookTestResponse {
  delivered: boolean;
  status_code: number | null;
  latency_ms: number | null;
  response_excerpt: string | null;
  signature_sent: string;
  expected_v1: string;
  error_class: string | null;
}
