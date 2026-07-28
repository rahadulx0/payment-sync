'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  OnboardingReveal,
  type RevealedCredentials,
} from '../../../../components/onboarding-reveal';
import { PageHeader } from '../../../../components/primitives';
import { Button, Card, Input, Label } from '../../../../components/ui';
import { apiRequest } from '../../../../lib/api-client';
import { ApiErrorException } from '../../../../lib/errors';

interface CreateResult {
  company: { id: string };
  credentials: {
    company_code: string;
    server_key: string;
    device_enroll_key: string;
    webhook_secret: string;
  };
}

export default function NewCompanyPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    contact_email: '',
    default_callback_url: '',
    notes: '',
  });
  const [reveal, setReveal] = useState<RevealedCredentials | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: form.name };
      if (form.contact_email) body['contact_email'] = form.contact_email;
      if (form.default_callback_url) body['default_callback_url'] = form.default_callback_url;
      if (form.notes) body['notes'] = form.notes;
      const res = await apiRequest<CreateResult>('/admin/companies', { method: 'POST', body });
      setCreatedId(res.company.id);
      setReveal({
        company_code: res.credentials.company_code,
        server_key: res.credentials.server_key,
        enroll_key: res.credentials.device_enroll_key,
        webhook_secret: res.credentials.webhook_secret,
      });
    } catch (err) {
      setError(
        err instanceof ApiErrorException ? err.api.message : 'Could not create the company.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (reveal !== null) {
    return (
      <div className="max-w-lg">
        <PageHeader
          title="Company created"
          subtitle="Save these credentials — they are shown once."
        />
        <OnboardingReveal
          creds={reveal}
          onDone={() => router.push(createdId !== null ? `/companies/${createdId}` : '/companies')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <PageHeader
        title="New company"
        subtitle="Details now; settings can be tuned after creation."
      />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="name">Business name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="email">Contact email</Label>
            <Input
              id="email"
              type="email"
              value={form.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cb">Default callback URL</Label>
            <Input
              id="cb"
              placeholder="https://client.example.com/webhook"
              value={form.default_callback_url}
              onChange={(e) => set('default_callback_url', e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Must be https. Used when an order does not specify one.
            </p>
          </div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {error !== null && <div className="text-sm text-danger">{error}</div>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create company'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
