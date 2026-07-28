'use client';
import Link from 'next/link';

import { useApiQuery } from '../lib/hooks';
import { isOnline } from '../lib/format';

interface DeviceRow {
  id: string;
  device_name: string;
  last_heartbeat_at: string | null;
}

/**
 * The single most operationally important thing on the screen (architecture
 * §15.3): any device offline >30 min. A merchant with an offline phone is a
 * merchant silently missing payments.
 */
export function OfflineDevicesBanner() {
  const { data } = useApiQuery<{ items: DeviceRow[] }>('/admin/devices', { limit: 200 });
  const offline = (data?.items ?? []).filter((d) => !isOnline(d.last_heartbeat_at));
  if (offline.length === 0) return null;
  return (
    <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm">
      <strong>{offline.length}</strong> device{offline.length > 1 ? 's' : ''} offline &gt;30 min:{' '}
      {offline.slice(0, 5).map((d, i) => (
        <span key={d.id}>
          <Link href={`/devices/${d.id}`} className="underline">
            {d.device_name}
          </Link>
          {i < Math.min(offline.length, 5) - 1 ? ', ' : ''}
        </span>
      ))}
      {offline.length > 5 && ` +${offline.length - 5} more`}
    </div>
  );
}
