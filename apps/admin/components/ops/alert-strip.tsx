'use client';
import Link from 'next/link';

import { useApiQuery } from '../../lib/hooks';

interface Overview {
  open_reviews: number;
  dead_webhooks: number;
  unmatched_sms: number;
  as_of: string;
}
interface Invariants {
  results: { check: string; count: number }[];
  clean: boolean;
}

interface Alert {
  tone: 'danger' | 'warning';
  text: string;
  href: string;
}

/**
 * The alert strip (Task 12 §4.1): only what needs action, each linking to the
 * fix. When healthy it shows a single quiet "all clear" — the strip must not cry
 * wolf, or it stops being read.
 */
export function AlertStrip() {
  const overview = useApiQuery<Overview>('/admin/analytics/overview', { range: '7d' });
  const invariants = useApiQuery<Invariants>('/admin/invariants');

  const alerts: Alert[] = [];
  const violated = (invariants.data?.results ?? []).filter((r) => r.count > 0);
  if (violated.length > 0) {
    alerts.push({
      tone: 'danger',
      text: `Invariant violation: ${violated.map((v) => v.check).join(', ')} — see the runbook`,
      href: '/dashboard',
    });
  }
  if ((overview.data?.dead_webhooks ?? 0) > 0) {
    alerts.push({
      tone: 'danger',
      text: `${overview.data?.dead_webhooks ?? 0} dead webhook(s)`,
      href: '/webhooks?status=DEAD',
    });
  }
  if ((overview.data?.open_reviews ?? 0) > 0) {
    alerts.push({
      tone: 'warning',
      text: `${overview.data?.open_reviews ?? 0} open review(s)`,
      href: '/reviews',
    });
  }
  if ((overview.data?.unmatched_sms ?? 0) > 0) {
    alerts.push({
      tone: 'warning',
      text: `${overview.data?.unmatched_sms ?? 0} unmatched SMS`,
      href: '/transactions',
    });
  }

  if (alerts.length === 0) {
    return (
      <div className="mb-4 rounded-md border border-success/40 bg-success/5 px-4 py-2 text-sm text-success">
        All clear
        {overview.data !== undefined
          ? ` · as of ${new Date(overview.data.as_of).toLocaleTimeString()}`
          : ''}
      </div>
    );
  }
  return (
    <div className="mb-4 space-y-2">
      {alerts.map((a, i) => (
        <Link
          key={i}
          href={a.href}
          className={`block rounded-md border px-4 py-2 text-sm ${a.tone === 'danger' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-warning/40 bg-warning/10 text-warning'}`}
        >
          {a.text}
        </Link>
      ))}
    </div>
  );
}
