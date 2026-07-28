'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { setUnauthenticatedHandler } from '../lib/api-client';
import { createRefresher } from '../lib/refresh';
import { authToken, useAuthStore } from '../lib/auth-store';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://localhost:3000';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } }),
  );
  const router = useRouter();
  const bootstrapped = useRef(false);

  useEffect(() => {
    setUnauthenticatedHandler(() => router.replace('/login'));
    // On hard reload, silently recover a session from the refresh cookie.
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      const refresh = createRefresher({
        apiOrigin: API_ORIGIN,
        fetchImpl: (...a) => fetch(...a),
        onToken: (t) => authToken.set(t),
      });
      void refresh();
    }
  }, [router]);

  // Idle-timeout watcher: drop the token after 30 min of inactivity.
  useEffect(() => {
    const bump = () => useAuthStore.getState().touch();
    for (const ev of ['click', 'keydown', 'mousemove'] as const)
      window.addEventListener(ev, bump, { passive: true });
    const id = setInterval(() => {
      if (useAuthStore.getState().isIdle()) {
        useAuthStore.getState().clear();
        router.replace('/login');
      }
    }, 60_000);
    return () => {
      for (const ev of ['click', 'keydown', 'mousemove'] as const)
        window.removeEventListener(ev, bump);
      clearInterval(id);
    };
  }, [router]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
