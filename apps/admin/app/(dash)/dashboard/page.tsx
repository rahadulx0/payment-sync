'use client';
import { AlertStrip } from '../../../components/ops/alert-strip';
import { Card } from '../../../components/ui';
import { Money, PageHeader } from '../../../components/primitives';
import { useApiQuery } from '../../../lib/hooks';

interface Overview {
  verified: number;
  verified_amount: string;
  pending: number;
  success_rate: number | null;
  open_reviews: number;
  dead_webhooks: number;
  unmatched_sms: number;
  as_of: string;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

export default function OverviewPage() {
  const { data } = useApiQuery<Overview>('/admin/analytics/overview', { range: '30d' });
  return (
    <div>
      <PageHeader title="Overview" subtitle="Platform health at a glance (last 30 days)" />
      <AlertStrip />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Verified" value={data?.verified ?? '—'} />
        <Stat
          label="Verified amount"
          value={data !== undefined ? <Money amount={data.verified_amount} /> : '—'}
        />
        <Stat label="Pending orders" value={data?.pending ?? '—'} />
        <Stat
          label="Success rate"
          value={data?.success_rate != null ? `${Math.round(data.success_rate * 100)}%` : '—'}
        />
        <Stat label="Open reviews" value={data?.open_reviews ?? '—'} />
        <Stat label="Unmatched SMS" value={data?.unmatched_sms ?? '—'} />
        <Stat label="Dead webhooks" value={data?.dead_webhooks ?? '—'} />
      </div>
    </div>
  );
}
