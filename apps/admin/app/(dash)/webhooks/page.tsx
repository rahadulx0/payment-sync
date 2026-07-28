'use client';
import Link from 'next/link';
import { useState } from 'react';

import { DataTable, type Column } from '../../../components/data-table';
import { PageHeader, RelativeTime, StatusBadge } from '../../../components/primitives';
import { Input } from '../../../components/ui';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

interface EventRow {
  id: string;
  company_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  reason: string | null;
  created_at: string;
}

export default function WebhooksPage() {
  const [status, setStatus] = useState('');
  const { data, isLoading, error } = useApiQuery<{ items: EventRow[] }>(
    '/admin/webhooks/events',
    status.length > 0 ? { status } : undefined,
  );
  const columns: Column<EventRow>[] = [
    {
      header: 'Type',
      cell: (r) => (
        <Link href={`/webhooks/${r.id}`} className="text-primary underline">
          {r.event_type}
        </Link>
      ),
    },
    { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { header: 'Attempts', cell: (r) => r.attempt_count },
    {
      header: 'Next',
      cell: (r) => (r.next_attempt_at != null ? <RelativeTime iso={r.next_attempt_at} /> : '—'),
    },
    {
      header: 'Delivered',
      cell: (r) => (r.delivered_at != null ? <RelativeTime iso={r.delivered_at} /> : '—'),
    },
    { header: 'Reason', cell: (r) => r.reason ?? '' },
    { header: 'Created', cell: (r) => <RelativeTime iso={r.created_at} /> },
  ];
  return (
    <div>
      <PageHeader title="Webhooks" />
      <div className="mb-3 max-w-xs">
        <Input
          placeholder="Filter by status (DEAD, FAILED…)"
          value={status}
          onChange={(e) => setStatus(e.target.value.toUpperCase())}
        />
      </div>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        error={(error as ApiErrorException | null)?.api ?? null}
        rowKey={(r) => r.id}
      />
    </div>
  );
}
