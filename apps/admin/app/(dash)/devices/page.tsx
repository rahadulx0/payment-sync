'use client';
import Link from 'next/link';

import { DataTable, type Column } from '../../../components/data-table';
import { PageHeader, RelativeTime, StatusBadge } from '../../../components/primitives';
import { isOnline } from '../../../lib/format';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

interface DeviceRow {
  id: string;
  device_name: string;
  status: string;
  model: string | null;
  app_version: string | null;
  battery_pct: number | null;
  last_heartbeat_at: string | null;
}

const columns: Column<DeviceRow>[] = [
  {
    header: '',
    cell: (r) => (
      <span
        className={`inline-block h-2 w-2 rounded-full ${isOnline(r.last_heartbeat_at) ? 'bg-success' : 'bg-danger'}`}
        title={isOnline(r.last_heartbeat_at) ? 'online' : 'offline'}
      />
    ),
  },
  {
    header: 'Name',
    cell: (r) => (
      <Link href={`/devices/${r.id}`} className="font-medium text-primary underline">
        {r.device_name}
      </Link>
    ),
  },
  { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { header: 'Model', cell: (r) => r.model ?? '—' },
  { header: 'App', cell: (r) => r.app_version ?? '—' },
  { header: 'Battery', cell: (r) => (r.battery_pct != null ? `${String(r.battery_pct)}%` : '—') },
  {
    header: 'Last seen',
    cell: (r) =>
      r.last_heartbeat_at != null ? <RelativeTime iso={r.last_heartbeat_at} /> : 'never',
  },
];

export default function DevicesPage() {
  const { data, isLoading, error } = useApiQuery<{ items: DeviceRow[] }>('/admin/devices', {
    limit: 100,
  });
  return (
    <div>
      <PageHeader
        title="Devices"
        subtitle="Merchant phones running the capture app (auto-refreshes)."
      />
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        error={(error as ApiErrorException | null)?.api ?? null}
        emptyMessage="No devices enrolled yet."
        rowKey={(r) => r.id}
      />
    </div>
  );
}
