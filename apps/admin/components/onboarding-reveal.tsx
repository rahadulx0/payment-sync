'use client';
import { useState } from 'react';

import { Button } from './ui';
import { SecretReveal } from './secret-reveal';

export interface RevealedCredentials {
  company_code: string;
  server_key: string;
  enroll_key: string;
  webhook_secret: string;
}

/**
 * The one-time credential reveal (Task 11 §4.4, §8). Secrets are shown ONCE; the
 * only recovery is rotation (downtime for a live client). Hence the download, the
 * copy buttons, and the blocking "I have saved these" confirm before leaving.
 */
export function OnboardingReveal({
  creds,
  onDone,
}: {
  creds: RevealedCredentials;
  onDone: () => void;
}) {
  const [saved, setSaved] = useState(false);

  function downloadPacket() {
    const blob = new Blob([JSON.stringify(creds, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paysync-onboarding-${creds.company_code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        These credentials are shown <strong>once</strong>. Save them now — recovering a lost key
        means rotating it, which takes the client&apos;s website down until they update it.
      </div>
      <SecretReveal label="Company code" value={creds.company_code} />
      <SecretReveal label="Server key (psk_live_)" value={creds.server_key} />
      <SecretReveal label="Device enroll key (pde_live_)" value={creds.enroll_key} />
      <SecretReveal label="Webhook secret (whsec_)" value={creds.webhook_secret} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={downloadPacket}>
          Download onboarding packet
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I
          have saved these credentials
        </label>
        <Button disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
