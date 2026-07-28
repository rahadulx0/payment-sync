import { authToken } from './auth-store';
import { ApiErrorException, toApiError } from './errors';
import { createRefresher } from './refresh';

const API_ORIGIN =
  typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://localhost:3000')
    : '';
const BASE = `${API_ORIGIN}/api/v1`;

const refresh = createRefresher({
  apiOrigin: API_ORIGIN,
  fetchImpl: (...args) => fetch(...args),
  onToken: (t) => {
    authToken.set(t);
  },
});

let onUnauthenticated: (() => void) | null = null;
/** Registered by the app shell to redirect to /login when refresh fails. */
export function setUnauthenticatedHandler(fn: () => void): void {
  onUnauthenticated = fn;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE}${path}`);
  if (query !== undefined) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function once(url: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/**
 * Auth-aware fetch: attaches the in-memory access token, and on a 401 performs a
 * single-flight refresh and retries exactly once before giving up and signalling
 * the shell to redirect to login (Task 11 §4.1–4.2).
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, opts.query);
  let res = await once(url, opts, authToken.get());

  if (res.status === 401) {
    const token = await refresh();
    if (token === null) {
      onUnauthenticated?.();
      throw new ApiErrorException(
        toApiError(
          401,
          await res
            .clone()
            .json()
            .catch(() => ({})),
        ),
      );
    }
    res = await once(url, opts, token);
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiErrorException(toApiError(res.status, body));
  return body as T;
}
