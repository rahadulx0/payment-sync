/**
 * Single-flight helper: N concurrent callers share ONE in-flight execution.
 * This is what makes parallel 401s trigger exactly one refresh (Task 11 §4.2,
 * acceptance criterion). Pure and framework-free, so it is unit-tested directly.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight !== null) return inFlight;
    inFlight = fn().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export interface RefreshDeps {
  apiOrigin: string;
  fetchImpl: typeof fetch;
  onToken: (token: string | null) => void;
}

/**
 * Build a single-flight refresh. It POSTs to /auth/refresh with credentials so
 * the httpOnly refresh cookie is sent; on success it stores the new access token
 * and returns it, on failure it clears the token and returns null.
 */
export function createRefresher(deps: RefreshDeps): () => Promise<string | null> {
  return singleFlight(async () => {
    try {
      const res = await deps.fetchImpl(`${deps.apiOrigin}/api/v1/admin/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        deps.onToken(null);
        return null;
      }
      const body = (await res.json()) as { access_token?: string };
      const token = body.access_token ?? null;
      deps.onToken(token);
      return token;
    } catch {
      deps.onToken(null);
      return null;
    }
  });
}
