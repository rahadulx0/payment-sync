/**
 * Maps the API's error envelope (architecture §7.1) into a shape the UI can show,
 * always surfacing `requestId` so a support conversation can reference it.
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
  status: number;
}

interface Envelope {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

export function toApiError(status: number, body: unknown): ApiError {
  const env = (body ?? {}) as Envelope;
  const e = env.error ?? {};
  return {
    code: e.code ?? 'UNKNOWN',
    message: e.message ?? 'Something went wrong.',
    ...(e.details !== undefined ? { details: e.details } : {}),
    requestId: e.request_id ?? '',
    status,
  };
}

export class ApiErrorException extends Error {
  constructor(readonly api: ApiError) {
    super(api.message);
    this.name = 'ApiErrorException';
  }
}

/** Field-level server errors → a map keyed by field name, for form mapping. */
export function fieldErrors(err: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  const details = err.details;
  if (details === undefined) return out;
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
