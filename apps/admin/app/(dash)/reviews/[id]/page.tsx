'use client';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Money, PageHeader } from '../../../../components/primitives';
import { Button, Card, Input } from '../../../../components/ui';
import { apiRequest } from '../../../../lib/api-client';
import { ApiErrorException } from '../../../../lib/errors';
import { useApiQuery } from '../../../../lib/hooks';

interface Candidate {
  paymentRequestId: string;
  orderId: string;
  expectedAmount: string;
  receivedAmount: string;
  amountDelta: string;
  score?: number;
  why?: string[];
}
interface Review {
  id: string;
  reason: string;
  sms_log_id: string | null;
  candidates: Candidate[];
}

export default function ReviewDetailPage() {
  const id = String(useParams()['id']);
  const router = useRouter();
  const { data } = useApiQuery<{ items: Review[] }>('/admin/reviews', {
    status: 'OPEN',
    limit: 100,
  });
  const review = data?.items.find((r) => r.id === id);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function link(candidate: Candidate) {
    if (note.trim().length < 3) {
      setError('A note is required.');
      return;
    }
    try {
      await apiRequest(`/admin/reviews/${id}/resolve`, {
        method: 'POST',
        body: {
          note,
          link_sms_log_id: review?.sms_log_id,
          link_payment_request_id: candidate.paymentRequestId,
        },
      });
      router.push('/reviews');
    } catch (err) {
      setError(err instanceof ApiErrorException ? err.api.message : 'Could not resolve.');
    }
  }
  async function dismiss() {
    if (note.trim().length < 3) {
      setError('A note is required.');
      return;
    }
    await apiRequest(`/admin/reviews/${id}/resolve`, {
      method: 'POST',
      body: { note, dismiss_reason: 'not a payment for these orders' },
    }).catch(() => undefined);
    router.push('/reviews');
  }

  if (review === undefined) return <div>Loading… (or already resolved)</div>;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Resolve review" subtitle={review.reason} />
      <Card className="mb-4">
        <label className="mb-1 block text-sm font-medium">Note (required, audited)</label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. confirmed with merchant by phone"
        />
        {error !== null && <div className="mt-1 text-sm text-danger">{error}</div>}
        <div className="mt-2">
          <Button variant="secondary" onClick={() => void dismiss()}>
            Dismiss (not a match)
          </Button>
        </div>
      </Card>
      <div className="space-y-3">
        {review.candidates.map((c) => (
          <Card key={c.paymentRequestId}>
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.orderId}</span>
              {c.score !== undefined && (
                <span className="text-sm text-muted">score {c.score.toFixed(2)}</span>
              )}
            </div>
            <div className="mt-1 text-sm text-muted">
              expected <Money amount={c.expectedAmount} /> · received{' '}
              <Money amount={c.receivedAmount} /> · Δ <Money amount={c.amountDelta} />
            </div>
            {c.why !== undefined && (
              <ul className="mt-1 list-inside list-disc text-xs text-muted">
                {c.why.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Button onClick={() => void link(c)}>Link this order</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
