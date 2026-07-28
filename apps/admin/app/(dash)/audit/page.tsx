'use client';
import { useState } from 'react';

import { DataTable, type Column } from '../../../components/data-table';
import { PageHeader, RelativeTime } from '../../../components/primitives';
import { Input } from '../../../components/ui';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

interface AuditRow {
  id: string;
  actor_type: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  before: unknown;
  after: unknown;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const { data, isLoading, error } = useApiQuery<{ items: AuditRow[] }>(
    '/admin/audit-logs',
    action.length > 0 ? { action } : undefined,
  );

  const columns: Column<AuditRow>[] = [
    { header: 'When', cell: (r) => <RelativeTime iso={r.created_at} /> },
    { header: 'Actor', cell: (r) => r.actor_type },
    { header: 'Action', cell: (r) => <code className="font-mono text-xs">{r.action}</code> },
    {
      header: 'Entity',
      cell: (r) =>
        r.entity_type != null
          ? `${r.entity_type}${r.entity_id != null ? `:${r.entity_id.slice(0, 8)}` : ''}`
          : '—',
    },
    {
      header: 'Detail',
      cell: (r) => (
        <details>
          <summary className="cursor-pointer text-xs text-muted">view</summary>
          <pre className="mt-1 max-w-md overflow-x-auto rounded bg-bg p-2 text-xs">
            {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
          </pre>
        </details>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every mutation, with redaction markers preserved." />
      <div className="mb-3 max-w-xs">
        <Input
          placeholder="Filter by action…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
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
