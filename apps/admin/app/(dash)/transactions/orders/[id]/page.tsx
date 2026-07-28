'use client';
import { useParams } from 'next/navigation';

import { DecisionTrace, type Attempt } from '../../../../../components/ops/decision-trace';
import { Money, PageHeader, RelativeTime, StatusBadge } from '../../../../../components/primitives';
import { Card } from '../../../../../components/ui';
import { useApiQuery } from '../../../../../lib/hooks';

interface OrderDetail {
  order: {
    order_id: string;
    status: string;
    match_mode: string;
    expected_amount: string;
    transaction_id: string | null;
    created_at: string;
    expires_at: string;
    verified_at: string | null;
  };
  attempts: Attempt[];
}

export default function OrderDetailPage() {
  const id = String(useParams()['id']);
  const { data } = useApiQuery<OrderDetail>(`/admin/ops/orders/${id}`);
  if (data === undefined) return <div>Loading…</div>;
  const o = data.order;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={o.order_id}
        subtitle="Order state and why it did or didn't verify."
        actions={<StatusBadge status={o.status} />}
      />
      <Card className="mb-4">
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">Amount</dt>
          <dd>
            <Money amount={o.expected_amount} />
          </dd>
          <dt className="text-muted">Mode</dt>
          <dd>{o.match_mode}</dd>
          <dt className="text-muted">TrxID</dt>
          <dd className="font-mono text-xs">{o.transaction_id ?? '—'}</dd>
          <dt className="text-muted">Registered</dt>
          <dd>
            <RelativeTime iso={o.created_at} />
          </dd>
          <dt className="text-muted">Expires</dt>
          <dd>
            <RelativeTime iso={o.expires_at} />
          </dd>
          <dt className="text-muted">Verified</dt>
          <dd>{o.verified_at != null ? <RelativeTime iso={o.verified_at} /> : '—'}</dd>
        </dl>
      </Card>
      <h2 className="mb-2 text-sm font-semibold">Decision trace</h2>
      <DecisionTrace attempts={data.attempts} />
    </div>
  );
}
