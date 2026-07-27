/** Public API of @paysync/shared. Explicit re-exports only (no `export *`). */

// Money
export { Money, MoneyParseError } from './money.js';

// Time
export {
  nowUtc,
  clockSkewSeconds,
  parseProviderTimestamp,
  toDhaka,
  TimeParseError,
} from './time.js';

// IDs / tokens / hashing
export {
  KEY_PREFIXES,
  keyPrefix,
  uuidv7,
  randomToken,
  issueCredential,
  hashSha256,
  clientMsgHash,
} from './ids.js';
export type { KeyPrefixKind } from './ids.js';

// HMAC (the single implementation)
export { signWebhook, verifyWebhook } from './hmac.js';
export type { SignWebhookInput, VerifyWebhookInput } from './hmac.js';

// Enums (const objects double as their union types)
export {
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
  WebhookEventType,
  PRISMA_MIRRORED_ENUMS,
  enumValues,
} from './enums.js';

// Errors
export { ERROR_HTTP_STATUS, AppError } from './errors.js';
export type { ErrorCode, ErrorEnvelope } from './errors.js';

// DTOs
export type { DecimalString, IsoTimestamp, CursorPageQuery, CursorPage } from './dto/common.js';
export type {
  DeviceRegisterRequest,
  DeviceRegisterResponse,
  DeviceConfig,
  ProviderConfig,
  HeartbeatRequest,
  HeartbeatResponse,
  HeartbeatDirectives,
  SmsUploadRequest,
  SmsUploadResponse,
  SmsUploadMessage,
  SmsUploadResult,
  SmsUploadResultStatus,
} from './dto/device.js';
export type {
  RegisterPaymentRequest,
  RegisterPaymentResponse,
  PaymentStatusResponse,
  PaymentVerificationDetail,
  CancelPaymentRequest,
  CorrectTransactionIdRequest,
  CorrectTransactionIdResponse,
  PaymentListQuery,
  PaymentListItem,
  PaymentListResponse,
} from './dto/payments.js';
export { WEBHOOK_HEADERS } from './dto/webhooks.js';
export type { WebhookVerifiedData, WebhookEnvelope, WebhookTestResponse } from './dto/webhooks.js';
export type {
  AdminLoginRequest,
  AdminLoginResponse,
  TotpVerifyRequest,
  AdminSessionTokens,
  CreateCompanyRequest,
  CompanyCredentialReveal,
  IssueKeyRequest,
  CompanyStatusChangeRequest,
} from './dto/admin.js';
