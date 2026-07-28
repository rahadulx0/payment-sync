'use client';
import { BarChart } from '../../../components/charts/bar-chart';
import { PageHeader } from '../../../components/primitives';
import { Card } from '../../../components/ui';
import { useApiQuery } from '../../../lib/hooks';

interface Daily {
  days: { day: string; registered: number; verified: number; amount: string }[];
  as_of: string;
}
interface Providers {
  providers: {
    provider: string;
    received: number;
    parsed: number;
    matched: number;
    parse_failure_rate: number;
  }[];
}
interface Methods {
  methods: { method: string; count: number; mean_confidence: number | null }[];
}

function csv(rows: Record<string, string | number>[]): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});
  const body = rows.map((r) => headers.map((h) => `"${String(r[h] ?? '')}"`).join(','));
  const blob = new Blob(['﻿' + [headers.join(','), ...body].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'analytics.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const daily = useApiQuery<Daily>('/admin/analytics/daily', { range: '30d' });
  const providers = useApiQuery<Providers>('/admin/analytics/providers', { range: '30d' });
  const methods = useApiQuery<Methods>('/admin/analytics/verification-methods', { range: '30d' });

  const bars = (daily.data?.days ?? []).map((d) => ({ label: d.day, value: d.verified }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle={
          daily.data !== undefined
            ? `as of ${new Date(daily.data.as_of).toLocaleString()}`
            : 'Last 30 days (Asia/Dhaka)'
        }
      />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Verified per day</h2>
          <button
            className="text-xs text-primary underline"
            onClick={() => csv(daily.data?.days ?? [])}
          >
            Export CSV
          </button>
        </div>
        <BarChart data={bars} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">By provider</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1">Provider</th>
              <th>Received</th>
              <th>Parsed</th>
              <th>Matched</th>
              <th>Parse fail</th>
            </tr>
          </thead>
          <tbody>
            {(providers.data?.providers ?? []).map((p) => (
              <tr key={p.provider} className="border-t border-border">
                <td className="py-1">{p.provider}</td>
                <td>{p.received}</td>
                <td>{p.parsed}</td>
                <td>{p.matched}</td>
                <td>{Math.round(p.parse_failure_rate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Verification methods</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {(methods.data?.methods ?? []).map((m) => (
            <div key={m.method}>
              <div className="text-xs text-muted">{m.method}</div>
              <div className="text-lg font-semibold">{m.count}</div>
              <div className="text-xs text-muted">
                mean conf {m.mean_confidence != null ? m.mean_confidence.toFixed(2) : '—'}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
