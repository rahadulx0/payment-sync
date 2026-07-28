'use client';
import { Card } from '../ui';
import { Money, RelativeTime, StatusBadge } from '../primitives';

/** Plain-language explanations of guard rejections — no enums shown to a human. */
const GUARD_TEXT: Record<string, string> = {
  DIRECTION_NOT_CREDIT:
    'Ignored: this is an outgoing payment (e.g. Cash Out), not an incoming one.',
  PROVIDER_NOT_ALLOWED: 'Ignored: this provider is not enabled for the company.',
  PARSE_STATUS_UNUSABLE: 'Ignored: the message could not be parsed into a usable payment.',
  AMOUNT_MISSING_OR_ZERO: 'Ignored: no positive amount was found in the message.',
  COMPANY_NOT_ACTIVE: 'Ignored: the company is disabled.',
  DEVICE_NOT_ACTIVE: 'Ignored: the sending device is blocked or retired.',
};

const RESULT_TEXT: Record<string, string> = {
  VERIFIED: 'Matched an order and verified the payment.',
  UNMATCHED: 'No order matched — waiting for a matching order to be registered.',
  REVIEW: 'Sent to manual review — the match was ambiguous or the amount did not agree.',
  DUPLICATE: 'This TrxID was already used by a verified payment (duplicate / replay).',
  IGNORED: 'Not treated as an incoming payment.',
  GUARD_REJECTED: 'Rejected before matching by a safety guard.',
};

export interface Attempt {
  id: string;
  trigger: string;
  result: string;
  pass: string;
  guard_failed: string | null;
  candidates: unknown;
  chosen_score: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface Candidate {
  orderId?: string;
  paymentRequestId?: string;
  expectedAmount?: string;
  receivedAmount?: string;
  amountDelta?: string;
  score?: number;
  why?: string[];
  note?: string;
}

/**
 * The decision trace (Task 12 §4.3) — the screen that answers "why wasn't this
 * verified?". One card per `match_attempts` row, newest first, with the guard/
 * result rendered in plain language and the ranked candidates with their scores.
 */
export function DecisionTrace({ attempts }: { attempts: Attempt[] }) {
  if (attempts.length === 0) {
    return <div className="text-sm text-muted">No matching has run for this message yet.</div>;
  }
  return (
    <div className="space-y-3">
      {attempts.map((a) => {
        const candidates = (Array.isArray(a.candidates) ? a.candidates : []) as Candidate[];
        return (
          <Card key={a.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusBadge status={a.result} />
                <span className="text-xs text-muted">
                  {a.trigger} · {a.pass}
                </span>
              </div>
              <span className="text-xs text-muted">
                <RelativeTime iso={a.created_at} /> · {a.duration_ms ?? 0} ms
              </span>
            </div>
            <p className="mt-2 text-sm">
              {a.guard_failed !== null
                ? (GUARD_TEXT[a.guard_failed] ?? `Rejected by guard: ${a.guard_failed}`)
                : RESULT_TEXT[a.result]}
            </p>
            {candidates.length > 0 && (
              <div className="mt-3 space-y-2">
                {candidates.map((c, i) => (
                  <div
                    key={c.paymentRequestId ?? i}
                    className="rounded-md border border-border bg-bg p-2 text-xs"
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{c.orderId ?? c.paymentRequestId}</span>
                      {c.score !== undefined && <span>score {c.score.toFixed(2)}</span>}
                    </div>
                    {c.expectedAmount !== undefined && (
                      <div className="mt-1 text-muted">
                        expected <Money amount={c.expectedAmount} /> · received{' '}
                        {c.receivedAmount !== undefined ? <Money amount={c.receivedAmount} /> : '—'}
                      </div>
                    )}
                    {c.why !== undefined && (
                      <ul className="mt-1 list-inside list-disc text-muted">
                        {c.why.map((w, j) => (
                          <li key={j}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
