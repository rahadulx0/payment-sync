'use client';
import Link from 'next/link';
import { useState } from 'react';

import { DataTable, type Column } from '../../../components/data-table';
import { Money, PageHeader, RelativeTime, StatusBadge } from '../../../components/primitives';
import { Input } from '../../../components/ui';
import { useApiQuery } from '../../../lib/hooks';
import type { ApiErrorException } from '../../../lib/errors';

type Tab = 'sms' | 'pending' | 'verified' | 'failed';
const TABS: { key: Tab; label: string }[] = [
  { key: 'sms', label: 'SMS logs' },
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'failed', label: 'Failed / Unmatched' },
];

interface SmsRow {
  id: string;
  provider: string;
  transaction_id: string | null;
  amount: string | null;
  parse_status: string;
  match_status: string;
  created_at: string;
}
interface OrderRow {
  id: string;
  order_id: string;
  amount: string;
  status: string;
  match_mode: string;
  transaction_id: string | null;
  created_at: string;
}

export default function TransactionsPage() {
  const [tab, setTab] = useState<Tab>('sms');
  const [q, setQ] = useState('');
  const search = q.length > 1 ? { q } : undefined;

  const smsQ = useApiQuery<{ items: SmsRow[] }>(
    '/admin/ops/sms-logs',
    search,
    tab === 'sms' || tab === 'failed',
  );
  const orderQ = useApiQuery<{ items: OrderRow[] }>(
    '/admin/ops/orders',
    {
      ...(tab === 'pending'
        ? { status: 'PENDING' }
        : tab === 'verified'
          ? { status: 'VERIFIED' }
          : {}),
      ...(search ?? {}),
    },
    tab === 'pending' || tab === 'verified',
  );

  const smsColumns: Column<SmsRow>[] = [
    { header: 'Received', cell: (r) => <RelativeTime iso={r.created_at} /> },
    { header: 'Provider', cell: (r) => r.provider },
    { header: 'Amount', cell: (r) => (r.amount !== null ? <Money amount={r.amount} /> : '—') },
    {
      header: 'TrxID',
      cell: (r) => <span className="font-mono text-xs">{r.transaction_id ?? '—'}</span>,
    },
    { header: 'Parse', cell: (r) => <StatusBadge status={r.parse_status} /> },
    {
      header: 'Match',
      cell: (r) => (
        <Link href={`/transactions/sms/${r.id}`}>
          <StatusBadge status={r.match_status} />
        </Link>
      ),
    },
  ];
  const orderColumns: Column<OrderRow>[] = [
    {
      header: 'Order',
      cell: (r) => (
        <Link href={`/transactions/orders/${r.id}`} className="text-primary underline">
          {r.order_id}
        </Link>
      ),
    },
    { header: 'Amount', cell: (r) => <Money amount={r.amount} /> },
    { header: 'Mode', cell: (r) => r.match_mode },
    {
      header: 'TrxID',
      cell: (r) => <span className="font-mono text-xs">{r.transaction_id ?? '—'}</span>,
    },
    { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { header: 'Created', cell: (r) => <RelativeTime iso={r.created_at} /> },
  ];

  const showOrders = tab === 'pending' || tab === 'verified';

  return (
    <div>
      <PageHeader title="Transactions" />
      <div className="mb-3 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`px-3 py-2 text-sm ${tab === t.key ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mb-3 max-w-sm">
        <Input
          placeholder="Search TrxID / MSISDN / order id / message…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {showOrders ? (
        <DataTable
          columns={orderColumns}
          rows={orderQ.data?.items ?? []}
          loading={orderQ.isLoading}
          error={(orderQ.error as ApiErrorException | null)?.api ?? null}
          rowKey={(r) => r.id}
        />
      ) : (
        <DataTable
          columns={smsColumns}
          rows={smsQ.data?.items ?? []}
          loading={smsQ.isLoading}
          error={(smsQ.error as ApiErrorException | null)?.api ?? null}
          emptyMessage="No SMS — this is the healthy state."
          rowKey={(r) => r.id}
        />
      )}
    </div>
  );
}
