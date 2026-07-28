/**
 * Delivery outcome classification (architecture §10.2, Task 09 §4.3). Pure:
 * an HTTP status or a transport error class in, a terminal/retry decision out.
 */
export type DeliveryOutcome = 'DELIVERED' | 'RETRY' | 'FAILED' | 'CANCELLED';

export interface Classification {
  outcome: DeliveryOutcome;
  errorClass: string | null;
  reason: string | null;
}

/** Transport-level failures (no HTTP response). All are retryable. */
export function classifyTransportError(errorClass: string): Classification {
  return { outcome: 'RETRY', errorClass, reason: null };
}

/** SSRF re-validation failure at send time — terminal, never retried, request never sent. */
export const UNSAFE_CALLBACK: Classification = {
  outcome: 'FAILED',
  errorClass: 'UNSAFE_CALLBACK_URL',
  reason: 'UNSAFE_CALLBACK_URL',
};

export function classifyResponse(status: number): Classification {
  if (status >= 200 && status < 300) {
    return { outcome: 'DELIVERED', errorClass: null, reason: null };
  }
  if (status >= 300 && status < 400) {
    // Redirects are never followed (SSRF hardening); treat as a bad endpoint.
    return { outcome: 'FAILED', errorClass: 'BAD_BODY', reason: 'REDIRECT_NOT_FOLLOWED' };
  }
  if (status === 410) {
    return { outcome: 'CANCELLED', errorClass: 'GONE', reason: 'CLIENT_GONE' };
  }
  if (status === 408 || status === 425 || status === 429) {
    return { outcome: 'RETRY', errorClass: `HTTP_${String(status)}`, reason: null };
  }
  if (status >= 400 && status < 500) {
    // Other 4xx is a client misconfiguration — stop retrying.
    return { outcome: 'FAILED', errorClass: `HTTP_${String(status)}`, reason: 'CLIENT_ERROR' };
  }
  // 5xx and anything else → retry per schedule.
  return { outcome: 'RETRY', errorClass: `HTTP_${String(status)}`, reason: null };
}
