'use client';
import { useState } from 'react';

import { Button } from './ui';

/** Places the exact value on the clipboard; brief confirmation. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={label}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}
