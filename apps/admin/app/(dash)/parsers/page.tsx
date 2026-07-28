'use client';
import { PageHeader } from '../../../components/primitives';
import { Card } from '../../../components/ui';
import { useApiQuery } from '../../../lib/hooks';

interface ParserHealth {
  by_status: Record<string, number>;
  as_of: string;
}
interface UnparsedGroup {
  groups?: { shape: string; count: number; sample: string }[];
}

export default function ParsersPage() {
  const health = useApiQuery<ParserHealth>('/admin/analytics/parser-health');
  const unparsed = useApiQuery<UnparsedGroup>('/admin/sms-logs/unparsed');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parser health"
        subtitle="The parser-improvement workflow: see the shape → add a fixture → ship a rule."
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Parse status distribution</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          {Object.entries(health.data?.by_status ?? {}).map(([k, v]) => (
            <div key={k}>
              <div className="text-xs text-muted">{k}</div>
              <div className="text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Unparsed / partial queue</h2>
        {(unparsed.data?.groups ?? []).length === 0 ? (
          <div className="text-sm text-muted">No unparsed messages — the healthy state.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {(unparsed.data?.groups ?? []).map((g) => (
              <li key={g.shape} className="rounded border border-border p-2">
                <div className="flex justify-between">
                  <code className="font-mono text-xs">{g.shape}</code>
                  <span className="text-muted">{g.count}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted">{g.sample}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
