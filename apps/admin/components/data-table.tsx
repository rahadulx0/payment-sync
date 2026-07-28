'use client';
import type { ReactNode } from 'react';

import { EmptyState, ErrorState } from './primitives';
import { Button } from './ui';
import type { ApiError } from '../lib/errors';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
}

/**
 * A minimal server-cursor-paged table. The parent owns the query (URL-synced
 * filters/cursor in the pages), so a view is shareable and survives reload
 * (Task 11 §4.8).
 */
export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  emptyMessage = 'Nothing here yet.',
  nextCursor,
  onLoadMore,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: ApiError | null;
  emptyMessage?: string;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  rowKey: (row: T) => string;
}) {
  if (error != null) return <ErrorState error={error} />;
  if (!loading && rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-card text-left text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className="px-3 py-2 font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border last:border-0 hover:bg-card">
              {columns.map((c) => (
                <td key={c.header} className="px-3 py-2">
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {loading && <div className="p-3 text-center text-xs text-muted">Loading…</div>}
      {nextCursor != null && onLoadMore !== undefined && (
        <div className="border-t border-border p-2 text-center">
          <Button variant="secondary" onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
