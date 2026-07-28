'use client';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { formatDateTimeDhaka, formatMoney, relativeTime } from '../lib/format';
import { cn } from '../lib/cn';

import type { ApiError } from '../lib/errors';

/** Money is rendered from a decimal string — never a float. */
export function Money({ amount, currency }: { amount: string; currency?: string }) {
  return <span className="tabular-nums">{formatMoney(amount, currency)}</span>;
}

/** Relative time, with the absolute Dhaka value on hover. */
export function RelativeTime({ iso }: { iso: string }) {
  // Recompute on client to avoid SSR/CSR drift, and refresh once a minute.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return <time title={formatDateTimeDhaka(iso)}>{relativeTime(iso)}</time>;
}

const TONE: Record<string, string> = {
  ACTIVE: 'bg-success/15 text-success',
  VERIFIED: 'bg-success/15 text-success',
  PENDING: 'bg-warning/15 text-warning',
  SUSPENDED: 'bg-warning/15 text-warning',
  DISABLED: 'bg-danger/15 text-danger',
  BLOCKED: 'bg-danger/15 text-danger',
  EXPIRED: 'bg-muted/15 text-muted',
  OPEN: 'bg-warning/15 text-warning',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        TONE[status] ?? 'bg-muted/15 text-muted',
      )}
    >
      {status}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
      {message}
    </div>
  );
}

export function ErrorState({ error }: { error: ApiError }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm">
      <div className="font-medium text-danger">{error.message}</div>
      {error.requestId !== '' && (
        <div className="mt-1 text-xs text-muted">request id: {error.requestId}</div>
      )}
    </div>
  );
}
