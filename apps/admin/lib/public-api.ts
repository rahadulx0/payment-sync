import { ApiErrorException, toApiError } from './errors';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://localhost:3000';

/** POST to a pre-auth (public) admin endpoint, sending/receiving the refresh cookie. */
export async function postPublic<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiErrorException(toApiError(res.status, data));
  return data as T;
}
