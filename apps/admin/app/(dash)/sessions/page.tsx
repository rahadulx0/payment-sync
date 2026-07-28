'use client';
import { useRouter } from 'next/navigation';

import { DataTable, type Column } from '../../../components/data-table';
import { PageHeader, RelativeTime } from '../../../components/primitives';
import { Button } from '../../../components/ui';
import { apiRequest } from '../../../lib/api-client';
import { authToken } from '../../../lib/auth-store';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

interface SessionRow {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
}

export default function SessionsPage() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useApiQuery<{ items: SessionRow[] }>(
    '/admin/auth/sessions',
  );

  async function logoutAll() {
    await apiRequest('/admin/auth/logout-all', { method: 'POST' }).catch(() => undefined);
    authToken.set(null);
    router.replace('/login');
  }

  const columns: Column<SessionRow>[] = [
    { header: 'IP', cell: (r) => r.ip ?? '—' },
    {
      header: 'Device',
      cell: (r) => <span className="truncate text-xs text-muted">{r.user_agent ?? '—'}</span>,
    },
    { header: 'Started', cell: (r) => <RelativeTime iso={r.created_at} /> },
    {
      header: 'Last used',
      cell: (r) => (r.last_used_at != null ? <RelativeTime iso={r.last_used_at} /> : '—'),
    },
    {
      header: '',
      cell: (r) => (r.current ? <span className="text-xs text-success">this session</span> : null),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Active sign-ins for your account."
        actions={
          <Button variant="danger" onClick={() => void logoutAll()}>
            Sign out everywhere
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        error={(error as ApiErrorException | null)?.api ?? null}
        rowKey={(r) => r.id}
      />
      <button className="sr-only" onClick={() => void refetch()} />
    </div>
  );
}
