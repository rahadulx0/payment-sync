'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { OfflineDevicesBanner } from '../../components/offline-devices-banner';
import { Providers } from '../../components/providers';
import { apiRequest } from '../../lib/api-client';
import { authToken } from '../../lib/auth-store';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/parsers', label: 'Parsers' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/companies', label: 'Companies' },
  { href: '/devices', label: 'Devices' },
  { href: '/audit', label: 'Audit log' },
  { href: '/sessions', label: 'Sessions' },
];

const ENV = process.env['NEXT_PUBLIC_ENV'] ?? 'STAGING';

export default function DashLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiRequest('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
    authToken.set(null);
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border bg-card p-4">
        <div className="mb-6 font-semibold">payment-sync</div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`block rounded-md px-3 py-2 text-sm ${pathname.startsWith(n.href) ? 'bg-primary/10 text-primary' : 'hover:bg-bg'}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${ENV === 'PRODUCTION' ? 'bg-danger text-white' : 'bg-warning/20 text-warning'}`}
          >
            {ENV}
          </span>
          <button className="text-sm text-muted hover:text-fg" onClick={() => void logout()}>
            Sign out
          </button>
        </header>
        <main className="flex-1 p-6">
          <OfflineDevicesBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
