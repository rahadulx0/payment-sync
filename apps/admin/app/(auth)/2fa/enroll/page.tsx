'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { CopyButton } from '../../../../components/copy-button';
import { Button, Card, Input, Label } from '../../../../components/ui';
import { authToken, useAuthStore } from '../../../../lib/auth-store';
import { postPublic } from '../../../../lib/public-api';

interface EnrolResult {
  otpauth_uri: string;
  qr_data_url: string;
  recovery_codes: string[];
}

export default function TotpEnrollPage() {
  const router = useRouter();
  const mfaToken = useAuthStore((s) => s.mfaToken);
  const [data, setData] = useState<EnrolResult | null>(null);
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mfaToken === null) {
      router.replace('/login');
      return;
    }
    void postPublic<EnrolResult>('/admin/auth/2fa/enroll', { mfa_token: mfaToken })
      .then(setData)
      .catch(() => setError('Could not start enrolment.'));
  }, [mfaToken, router]);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (mfaToken === null) return;
    try {
      const res = await postPublic<{ access_token: string }>('/admin/auth/2fa/verify', {
        mfa_token: mfaToken,
        code,
      });
      authToken.set(res.access_token);
      useAuthStore.getState().setMfaToken(null);
      router.replace('/dashboard');
    } catch {
      setError('Invalid code — check your authenticator app.');
    }
  }

  if (error !== null && data === null) return <Card>{error}</Card>;
  if (data === null) return <Card>Loading…</Card>;

  return (
    <Card>
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium">1. Scan with your authenticator app</div>
          {/* Rendered by the API from the otpauth URI — no external QR service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.qr_data_url}
            alt="TOTP QR code"
            className="mx-auto h-40 w-40 rounded bg-white p-2"
          />
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <code className="truncate font-mono text-muted">{data.otpauth_uri}</code>
            <CopyButton value={data.otpauth_uri} label="Copy secret" />
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">2. Save your recovery codes</div>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-bg p-3 font-mono text-xs">
            {data.recovery_codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <CopyButton value={data.recovery_codes.join('\n')} label="Copy codes" />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I have stored these
            </label>
          </div>
        </div>
        <form onSubmit={verify} className="space-y-2">
          <Label htmlFor="code">3. Enter a code to finish</Label>
          <Input
            id="code"
            inputMode="numeric"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          {error !== null && <div className="text-sm text-danger">{error}</div>}
          <Button type="submit" className="w-full" disabled={!saved || code.length < 6}>
            Finish enrolment
          </Button>
        </form>
      </div>
    </Card>
  );
}
