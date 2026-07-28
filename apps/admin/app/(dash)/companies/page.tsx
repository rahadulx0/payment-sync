'use client';
import Link from 'next/link';
import { useState } from 'react';

import { DataTable, type Column } from '../../../components/data-table';
import { PageHeader, StatusBadge } from '../../../components/primitives';
import { Button, Input } from '../../../components/ui';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

interface CompanyRow {
  id: string;
  company_code: string;
  name: string;
  status: string;
}

const columns: Column<CompanyRow>[] = [
  {
    header: 'Name',
    cell: (r) => (
      <Link href={`/companies/${r.id}`} className="font-medium text-primary underline">
        {r.name}
      </Link>
    ),
  },
  { header: 'Code', cell: (r) => <code className="font-mono text-xs">{r.company_code}</code> },
  { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
];

export default function CompaniesPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useApiQuery<{
    items: CompanyRow[];
    next_cursor: string | null;
  }>('/admin/companies', q.length > 0 ? { q } : undefined);
  return (
    <div>
      <PageHeader
        title="Companies"
        actions={
          <Link href="/companies/new">
            <Button>New company</Button>
          </Link>
        }
      />
      <div className="mb-3 max-w-xs">
        <Input
          placeholder="Search name or code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        error={(error as ApiErrorException | null)?.api ?? null}
        emptyMessage="No companies yet — create one to onboard a client."
        rowKey={(r) => r.id}
      />
    </div>
  );
}
