/**
 * Stable error codes and the error envelope (architecture §7.1). Every non-2xx
 * response is one of these codes with a `request_id`.
 */

export const ERROR_HTTP_STATUS = {
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIAL: 401,
  COMPANY_SUSPENDED: 403,
  DEVICE_BLOCKED: 403,
  DEVICE_RETIRED: 403,
  DEVICE_LIMIT_REACHED: 409,
  FORBIDDEN_SCOPE: 403,
  VALIDATION_ERROR: 400,
  DUPLICATE_ORDER_ID: 409,
  DUPLICATE_TRANSACTION_ID: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  REQUEST_IN_PROGRESS: 409,
  ORDER_NOT_FOUND: 404,
  ORDER_NOT_PENDING: 409,
  INVALID_CALLBACK_URL: 400,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    request_id: string;
  };
}

/** Base application error carrying a stable code and HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    if (details !== undefined) {
      this.details = details;
    }
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
        request_id: requestId,
      },
    };
  }
}
