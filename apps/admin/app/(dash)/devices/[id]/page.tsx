'use client';
import { useParams } from 'next/navigation';

import { PageHeader, RelativeTime, StatusBadge } from '../../../../components/primitives';
import { Button, Card } from '../../../../components/ui';
import { useApiMutation, useApiQuery } from '../../../../lib/hooks';

interface Device {
  id: string;
  device_name: string;
  status: string;
  model: string | null;
  manufacturer: string | null;
  android_version: string | null;
  app_version: string | null;
  battery_pct: number | null;
  is_ignoring_battery_opt: boolean | null;
  has_sms_permission: boolean | null;
  clock_skew_seconds: number;
  last_heartbeat_at: string | null;
  force_sync_requested: boolean;
}

export default function DeviceDetailPage() {
  const id = String(useParams()['id']);
  const { data, refetch } = useApiQuery<Device>(`/admin/devices/${id}`);
  const action = useApiMutation<unknown, { verb: string }>((v) => ({
    path: `/admin/devices/${id}/${v.verb}`,
    options: { method: 'POST' },
  }));

  function run(verb: string) {
    action.mutate({ verb }, { onSuccess: () => void refetch() });
  }

  if (data === undefined) return <div>Loading…</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={data.device_name}
        subtitle={`${data.manufacturer ?? ''} ${data.model ?? ''}`.trim()}
        actions={<StatusBadge status={data.status} />}
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Telemetry</h2>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Last heartbeat</dt>
          <dd>
            {data.last_heartbeat_at != null ? (
              <RelativeTime iso={data.last_heartbeat_at} />
            ) : (
              'never'
            )}
          </dd>
          <dt className="text-muted">App / Android</dt>
          <dd>
            {data.app_version ?? '—'} / {data.android_version ?? '—'}
          </dd>
          <dt className="text-muted">Battery</dt>
          <dd>{data.battery_pct != null ? `${String(data.battery_pct)}%` : '—'}</dd>
          <dt className="text-muted">SMS permission</dt>
          <dd>{data.has_sms_permission === true ? 'granted' : 'missing'}</dd>
          <dt className="text-muted">Battery optimisation</dt>
          <dd>{data.is_ignoring_battery_opt === true ? 'exempt (good)' : 'not exempt'}</dd>
          <dt className="text-muted">Clock skew</dt>
          <dd>{data.clock_skew_seconds}s</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => run('force-sync')}>
            Force sync
          </Button>
          <Button variant="secondary" onClick={() => run('rotate-token')}>
            Rotate token
          </Button>
          {data.status === 'ACTIVE' ? (
            <Button variant="danger" onClick={() => run('block')}>
              Block
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => run('unblock')}>
              Unblock
            </Button>
          )}
          <Button variant="danger" onClick={() => run('retire')}>
            Retire
          </Button>
        </div>
        {data.force_sync_requested && (
          <p className="mt-3 text-xs text-muted">
            Force-sync queued — applies at the next heartbeat (≤15 min).
          </p>
        )}
      </Card>
    </div>
  );
}
