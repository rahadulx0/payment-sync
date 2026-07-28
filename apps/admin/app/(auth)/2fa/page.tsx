'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, Input, Label } from '../../../components/ui';
import { authToken, useAuthStore } from '../../../lib/auth-store';
import { postPublic } from '../../../lib/public-api';

export default function TotpVerifyPage() {
  const router = useRouter();
  const mfaToken = useAuthStore((s) => s.mfaToken);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mfaToken === null) {
      router.replace('/login');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postPublic<{ access_token: string }>('/admin/auth/2fa/verify', {
        mfa_token: mfaToken,
        code,
      });
      authToken.set(res.access_token);
      useAuthStore.getState().setMfaToken(null);
      router.replace('/dashboard');
    } catch {
      setError('Invalid or reused code. Codes are single-use and time-based.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="code">Authenticator code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            autoFocus
          />
        </div>
        {error !== null && <div className="text-sm text-danger">{error}</div>}
        <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
    </Card>
  );
}
