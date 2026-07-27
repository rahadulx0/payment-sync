/**
 * Single source of truth for domain enums. Prisma enums (Task 02) are asserted
 * identical to these by an enum-parity test, so drift is impossible.
 */

export const Provider = {
  BKASH: 'BKASH',
  NAGAD: 'NAGAD',
  UPAY: 'UPAY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Provider = (typeof Provider)[keyof typeof Provider];

export const CompanyStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
} as const;
export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus];

export const DeviceStatus = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  RETIRED: 'RETIRED',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];

export const KeyType = {
  SERVER: 'SERVER',
  DEVICE_ENROLL: 'DEVICE_ENROLL',
} as const;
export type KeyType = (typeof KeyType)[keyof typeof KeyType];

export const ParseStatus = {
  PARSED: 'PARSED',
  PARTIAL: 'PARTIAL',
  UNPARSED: 'UNPARSED',
  IGNORED: 'IGNORED',
} as const;
export type ParseStatus = (typeof ParseStatus)[keyof typeof ParseStatus];

export const MatchStatus = {
  UNMATCHED: 'UNMATCHED',
  MATCHED: 'MATCHED',
  IN_REVIEW: 'IN_REVIEW',
  IGNORED: 'IGNORED',
  DUPLICATE_TXN: 'DUPLICATE_TXN',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const MatchMode = {
  EXACT: 'EXACT',
  HEURISTIC: 'HEURISTIC',
} as const;
export type MatchMode = (typeof MatchMode)[keyof typeof MatchMode];

export const VerificationMethod = {
  EXACT_TXN_ID: 'EXACT_TXN_ID',
  HEURISTIC_AMOUNT_WINDOW: 'HEURISTIC_AMOUNT_WINDOW',
  MANUAL_ADMIN: 'MANUAL_ADMIN',
} as const;
export type VerificationMethod = (typeof VerificationMethod)[keyof typeof VerificationMethod];

export const UploadSource = {
  REALTIME: 'REALTIME',
  MANUAL_SYNC: 'MANUAL_SYNC',
  RECONCILE: 'RECONCILE',
} as const;
export type UploadSource = (typeof UploadSource)[keyof typeof UploadSource];

export const ReviewReason = {
  AMBIGUOUS_CANDIDATES: 'AMBIGUOUS_CANDIDATES',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  DUPLICATE_TXN_ID: 'DUPLICATE_TXN_ID',
  SUSPICIOUS_SMS: 'SUSPICIOUS_SMS',
  UNPARSED_MESSAGE: 'UNPARSED_MESSAGE',
} as const;
export type ReviewReason = (typeof ReviewReason)[keyof typeof ReviewReason];

export const ReviewStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export const MatchTrigger = {
  SMS_UPLOAD: 'SMS_UPLOAD',
  ORDER_REGISTER: 'ORDER_REGISTER',
  RESCAN: 'RESCAN',
  REPARSE: 'REPARSE',
  ADMIN: 'ADMIN',
} as const;
export type MatchTrigger = (typeof MatchTrigger)[keyof typeof MatchTrigger];

export const MatchResult = {
  VERIFIED: 'VERIFIED',
  UNMATCHED: 'UNMATCHED',
  REVIEW: 'REVIEW',
  IGNORED: 'IGNORED',
  DUPLICATE: 'DUPLICATE',
  GUARD_REJECTED: 'GUARD_REJECTED',
} as const;
export type MatchResult = (typeof MatchResult)[keyof typeof MatchResult];

export const MatchPass = {
  EXACT: 'EXACT',
  HEURISTIC: 'HEURISTIC',
  NONE: 'NONE',
} as const;
export type MatchPass = (typeof MatchPass)[keyof typeof MatchPass];

export const WebhookEventStatus = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
  CANCELLED: 'CANCELLED',
} as const;
export type WebhookEventStatus = (typeof WebhookEventStatus)[keyof typeof WebhookEventStatus];

export const ActorType = {
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
  CLIENT: 'CLIENT',
  DEVICE: 'DEVICE',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

/** Wire-level webhook event types (dotted strings; stored as text, not a DB enum). */
export const WebhookEventType = {
  PAYMENT_VERIFIED: 'payment.verified',
  PAYMENT_EXPIRED: 'payment.expired',
  PAYMENT_REVIEW_REQUIRED: 'payment.review_required',
  TEST_PING: 'test.ping',
} as const;
export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

/**
 * The enums that must match Prisma one-for-one (Task 02 parity test). Wire-only
 * enums with dotted values (WebhookEventType) are stored as text, not DB enums,
 * and are intentionally excluded.
 */
export const PRISMA_MIRRORED_ENUMS = {
  Provider,
  CompanyStatus,
  DeviceStatus,
  KeyType,
  ParseStatus,
  MatchStatus,
  PaymentStatus,
  MatchMode,
  VerificationMethod,
  UploadSource,
  ReviewReason,
  ReviewStatus,
  MatchTrigger,
  MatchResult,
  MatchPass,
  WebhookEventStatus,
  ActorType,
} as const;

/** name → sorted value list, for the parity assertion. */
export function enumValues(e: Record<string, string>): string[] {
  return Object.values(e).sort();
}
