'use client';
import { useState } from 'react';

import { CopyButton } from './copy-button';

/**
 * A masked-by-default secret with a reveal toggle and a copy button. Used by the
 * one-time credential reveal — the highest-stakes UI in the product (Task 11 §8).
 */
export function SecretReveal({ label, value }: { label: string; value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <code className="block truncate font-mono text-sm">
          {shown ? value : '•'.repeat(Math.min(value.length, 32))}
        </code>
      </div>
      <div className="flex shrink-0 gap-2">
        <button className="text-xs text-primary underline" onClick={() => setShown((s) => !s)}>
          {shown ? 'Hide' : 'Reveal'}
        </button>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
