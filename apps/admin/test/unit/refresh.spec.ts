import { describe, expect, it, vi } from 'vitest';

import { createRefresher, singleFlight } from '../../lib/refresh';

describe('singleFlight', () => {
  it('collapses N concurrent calls into one execution', async () => {
    let calls = 0;
    const wrapped = singleFlight(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 'ok';
    });
    const results = await Promise.all([wrapped(), wrapped(), wrapped(), wrapped()]);
    expect(calls).toBe(1);
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('allows a fresh execution after the previous settles', async () => {
    let calls = 0;
    const wrapped = singleFlight(() => {
      calls++;
      return Promise.resolve(calls);
    });
    await wrapped();
    await wrapped();
    expect(calls).toBe(2);
  });
});

describe('createRefresher', () => {
  it('stores the new token on success and single-flights parallel refreshes', async () => {
    let fetchCalls = 0;
    const tokens: (string | null)[] = [];
    const refresh = createRefresher({
      apiOrigin: 'http://api',
      fetchImpl: vi.fn(async () => {
        fetchCalls++;
        await new Promise((r) => setTimeout(r, 5));
        return new Response(JSON.stringify({ access_token: 'new-token' }), { status: 200 });
      }) as unknown as typeof fetch,
      onToken: (t) => tokens.push(t),
    });
    const [a, b] = await Promise.all([refresh(), refresh()]);
    expect(fetchCalls).toBe(1);
    expect(a).toBe('new-token');
    expect(b).toBe('new-token');
  });

  it('clears the token and returns null on failure', async () => {
    let cleared = false;
    const refresh = createRefresher({
      apiOrigin: 'http://api',
      fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
      onToken: (t) => {
        if (t === null) cleared = true;
      },
    });
    expect(await refresh()).toBeNull();
    expect(cleared).toBe(true);
  });
});
