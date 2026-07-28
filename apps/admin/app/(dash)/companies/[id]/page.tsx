'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { PageHeader, StatusBadge } from '../../../../components/primitives';
import { Button, Card } from '../../../../components/ui';
import { apiRequest } from '../../../../lib/api-client';
import { useApiMutation, useApiQuery } from '../../../../lib/hooks';

interface Company {
  id: string;
  company_code: string;
  name: string;
  status: string;
  default_callback_url: string | null;
}

interface WebhookTestResult {
  delivered: boolean;
  status_code: number | null;
  latency_ms: number | null;
  signature_sent: string;
  expected_v1: string;
  error_class: string | null;
}

const STATUS_EFFECT: Record<string, string> = {
  SUSPENDED: 'SMS still ingested, but new orders are rejected and webhooks are paused.',
  DISABLED: 'Everything stops and device tokens are revoked.',
  ACTIVE: 'Normal operation resumes.',
};

export default function CompanyDetailPage() {
  const id = String(useParams()['id']);
  const { data, refetch } = useApiQuery<Company>(`/admin/companies/${id}`);
  const [dialog, setDialog] = useState<{ status: string } | null>(null);
  const [test, setTest] = useState<WebhookTestResult | null>(null);

  const setStatus = useApiMutation<unknown, { status: string; reason: string }>((vars) => ({
    path: `/admin/companies/${id}/status`,
    options: { method: 'POST', body: vars },
  }));

  async function runWebhookTest() {
    const res = await apiRequest<WebhookTestResult>('/webhooks/test', {
      method: 'POST',
      body: {},
    }).catch(() => null);
    setTest(res);
  }

  if (data === undefined) return <div>Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={data.name}
        subtitle={data.company_code}
        actions={<StatusBadge status={data.status} />}
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Status</h2>
        <div className="flex flex-wrap gap-2">
          {data.status !== 'ACTIVE' && (
            <Button variant="secondary" onClick={() => setDialog({ status: 'ACTIVE' })}>
              Reactivate
            </Button>
          )}
          {data.status === 'ACTIVE' && (
            <Button variant="secondary" onClick={() => setDialog({ status: 'SUSPENDED' })}>
              Suspend
            </Button>
          )}
          <Button variant="danger" onClick={() => setDialog({ status: 'DISABLED' })}>
            Disable
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Webhook test</h2>
        <p className="mb-3 text-sm text-muted">
          Delivers a signed <code>test.ping</code> to the callback and reports the result.
        </p>
        <Button variant="secondary" onClick={() => void runWebhookTest()}>
          Send test.ping
        </Button>
        {test !== null && (
          <div className="mt-3 space-y-1 rounded-md border border-border bg-bg p-3 text-xs">
            <div>
              Delivered: <strong>{test.delivered ? 'yes' : 'no'}</strong> · status{' '}
              {test.status_code ?? '—'} · {test.latency_ms ?? '—'} ms
              {test.error_class !== null ? ` · ${test.error_class}` : ''}
            </div>
            <div className="truncate">
              signature sent: <code className="font-mono">{test.signature_sent}</code>
            </div>
            <div>
              expected v1: <code className="font-mono">{test.expected_v1}</code>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={dialog !== null}
        title={`Set status to ${dialog?.status ?? ''}`}
        body={
          <span>
            {dialog !== null ? STATUS_EFFECT[dialog.status] : ''} This affects a live client.
          </span>
        }
        confirmLabel={`Set ${dialog?.status ?? ''}`}
        typeToConfirm={data.company_code}
        requireReason
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => {
          if (dialog !== null) {
            setStatus.mutate(
              { status: dialog.status, reason },
              { onSuccess: () => void refetch() },
            );
          }
          setDialog(null);
        }}
      />
    </div>
  );
}
