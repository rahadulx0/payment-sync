'use client';
import { useState, type ReactNode } from 'react';

import { Button, Input } from './ui';

/**
 * Destructive-action confirmation. For high-stakes actions (suspend/disable a
 * company) pass `typeToConfirm` — the operator must type the value exactly, as
 * in GitHub's delete flow (Task 11 §4.4). The same person runs staging and
 * production, so this friction is deliberate.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  typeToConfirm,
  requireReason = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  typeToConfirm?: string;
  requireReason?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  if (!open) return null;
  const typedOk = typeToConfirm === undefined || typed === typeToConfirm;
  const reasonOk = !requireReason || reason.trim().length >= 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{body}</div>
        {typeToConfirm !== undefined && (
          <div className="mt-4">
            <div className="mb-1 text-xs text-muted">
              Type <code className="font-mono">{typeToConfirm}</code> to confirm
            </div>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="confirmation text"
            />
          </div>
        )}
        {requireReason && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-muted">Reason (recorded in the audit log)</div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="reason" />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!typedOk || !reasonOk}
            onClick={() => onConfirm(reason)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
