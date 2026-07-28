'use client';
import Link from 'next/link';

import { DataTable, type Column } from '../../../components/data-table';
import { PageHeader, StatusBadge } from '../../../components/primitives';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

interface ReviewRow {
  id: string;
  reason: string;
  company_id: string;
  age_minutes: number;
  candidates: unknown;
}

export default function ReviewsPage() {
  const { data, isLoading, error } = useApiQuery<{ items: ReviewRow[] }>('/admin/reviews', {
    status: 'OPEN',
  });
  const columns: Column<ReviewRow>[] = [
    { header: 'Reason', cell: (r) => <StatusBadge status={r.reason} /> },
    {
      header: 'Age',
      cell: (r) => (
        <span className={r.age_minutes > 30 ? 'text-danger' : ''}>{r.age_minutes} min</span>
      ),
    },
    { header: 'Candidates', cell: (r) => (Array.isArray(r.candidates) ? r.candidates.length : 0) },
    {
      header: '',
      cell: (r) => (
        <Link href={`/reviews/${r.id}`} className="text-primary underline">
          Work
        </Link>
      ),
    },
  ];
  return (
    <div>
      <PageHeader
        title="Review queue"
        subtitle="Oldest first. A review past 30 min is a merchant with an unfulfilled paid order."
      />
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        error={(error as ApiErrorException | null)?.api ?? null}
        emptyMessage="No open reviews — the healthy state."
        rowKey={(r) => r.id}
      />
    </div>
  );
}
