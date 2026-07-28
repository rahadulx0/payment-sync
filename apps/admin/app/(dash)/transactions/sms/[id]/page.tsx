'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { DecisionTrace, type Attempt } from '../../../../../components/ops/decision-trace';
import { Money, PageHeader, RelativeTime, StatusBadge } from '../../../../../components/primitives';
import { Button, Card } from '../../../../../components/ui';
import { apiRequest } from '../../../../../lib/api-client';
import { useApiQuery } from '../../../../../lib/hooks';

interface SmsDetail {
  sms: {
    id: string;
    sms_address: string;
    raw_message: string;
    provider: string;
    transaction_id: string | null;
    amount: string | null;
    sender_msisdn: string | null;
    parse_status: string;
    parse_confidence: string;
    match_status: string;
    flags: string[];
    sms_timestamp: string | null;
    device_received_at: string;
  };
  attempts: Attempt[];
  verification: unknown;
}

function maskDigits(s: string): string {
  return s.replace(/\d/g, '•');
}

export default function SmsDetailPage() {
  const id = String(useParams()['id']);
  const { data, refetch } = useApiQuery<SmsDetail>(`/admin/ops/sms-logs/${id}`);
  const [masked, setMasked] = useState(false);

  async function reparse() {
    await apiRequest(`/admin/sms-logs/${id}/reparse`, { method: 'POST' }).catch(() => undefined);
    void refetch();
  }

  if (data === undefined) return <div>Loading…</div>;
  const s = data.sms;

  return (
    <div>
      <PageHeader
        title="SMS decision trace"
        subtitle="Why this message did or didn't verify a payment."
        actions={
          <Button variant="secondary" onClick={() => void reparse()}>
            Re-parse
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
            Message as received
            <button className="text-xs text-primary underline" onClick={() => setMasked((m) => !m)}>
              {masked ? 'Unmask' : 'Mask digits'}
            </button>
          </h2>
          <div className="text-xs text-muted">{s.sms_address}</div>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-bg p-2 font-mono text-xs">
            {masked ? maskDigits(s.raw_message) : s.raw_message}
          </pre>
          <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-muted">Device time</dt>
            <dd>
              <RelativeTime iso={s.device_received_at} />
            </dd>
            <dt className="text-muted">Flags</dt>
            <dd>{s.flags.length > 0 ? s.flags.join(', ') : '—'}</dd>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold">Server extraction</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Provider</dt>
            <dd>{s.provider}</dd>
            <dt className="text-muted">TrxID</dt>
            <dd className="font-mono text-xs">{s.transaction_id ?? '—'}</dd>
            <dt className="text-muted">Amount</dt>
            <dd>{s.amount !== null ? <Money amount={s.amount} /> : '—'}</dd>
            <dt className="text-muted">Sender</dt>
            <dd>{s.sender_msisdn ?? '—'}</dd>
            <dt className="text-muted">Parse</dt>
            <dd>
              <StatusBadge status={s.parse_status} /> ({s.parse_confidence})
            </dd>
            <dt className="text-muted">Match</dt>
            <dd>
              <StatusBadge status={s.match_status} />
            </dd>
          </dl>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Decision trace</h2>
          <DecisionTrace attempts={data.attempts} />
        </div>
      </div>
    </div>
  );
}
