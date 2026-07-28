'use client';
import { useParams } from 'next/navigation';

import { PageHeader, RelativeTime, StatusBadge } from '../../../../components/primitives';
import { Button, Card } from '../../../../components/ui';
import { apiRequest } from '../../../../lib/api-client';
import { useApiQuery } from '../../../../lib/hooks';

interface Delivery {
  id: string;
  attempt_no: number;
  response_status: number | null;
  error_class: string | null;
  duration_ms: number | null;
  attempted_at: string;
  response_body: string | null;
}

export default function WebhookDetailPage() {
  const id = String(useParams()['id']);
  const { data, refetch } = useApiQuery<Delivery[]>(`/admin/webhooks/events/${id}/deliveries`);

  async function retry() {
    await apiRequest(`/admin/webhooks/events/${id}/retry`, { method: 'POST' }).catch(
      () => undefined,
    );
    void refetch();
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Webhook event"
        subtitle="Delivery attempt history"
        actions={
          <Button variant="secondary" onClick={() => void retry()}>
            Retry now
          </Button>
        }
      />
      <div className="space-y-2">
        {(data ?? []).map((d) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between text-sm">
              <span>
                Attempt {d.attempt_no} ·{' '}
                {d.response_status !== null ? (
                  <StatusBadge status={String(d.response_status)} />
                ) : (
                  (d.error_class ?? 'error')
                )}
              </span>
              <span className="text-xs text-muted">
                <RelativeTime iso={d.attempted_at} /> · {d.duration_ms ?? 0} ms
              </span>
            </div>
            {d.response_body !== null && d.response_body.length > 0 && (
              <pre className="mt-2 max-h-24 overflow-auto rounded bg-bg p-2 text-xs">
                {d.response_body}
              </pre>
            )}
          </Card>
        ))}
        {(data ?? []).length === 0 && (
          <div className="text-sm text-muted">No delivery attempts yet.</div>
        )}
      </div>
    </div>
  );
}
