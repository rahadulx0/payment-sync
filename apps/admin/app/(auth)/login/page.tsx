'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, Input, Label } from '../../../components/ui';
import { useAuthStore } from '../../../lib/auth-store';
import { ApiErrorException } from '../../../lib/errors';
import { postPublic } from '../../../lib/public-api';

interface LoginResult {
  mfa_required?: boolean;
  enrolment_required?: boolean;
  mfa_token: string;
}

export default function LoginPage() {
  const router = useRouter();
  const setMfaToken = useAuthStore((s) => s.setMfaToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await postPublic<LoginResult>('/admin/auth/login', { email, password });
      setMfaToken(res.mfa_token);
      router.push(res.enrolment_required === true ? '/2fa/enroll' : '/2fa');
    } catch (err) {
      if (err instanceof ApiErrorException) {
        setError(
          err.api.status === 429
            ? 'Too many attempts — try again shortly.'
            : 'Invalid email or password.',
        );
      } else {
        setError('Unexpected error.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error !== null && <div className="text-sm text-danger">{error}</div>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}
