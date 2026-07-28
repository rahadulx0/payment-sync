import type { WebhookEnvelope, WebhookEventType } from '@paysync/shared';

/**
 * Build the webhook envelope and its canonical raw body **once**, at event
 * creation (architecture §10.1, Task 09 §4.1). The raw string is stored frozen
 * in `webhook_events.payload_raw` and re-sent byte-for-byte on every retry —
 * re-serialising would reorder JSON keys and invalidate a client's signature.
 */
export function buildEnvelope<T>(
  eventId: string,
  eventType: WebhookEventType,
  createdAtIso: string,
  data: T,
): { envelope: WebhookEnvelope<T>; raw: string } {
  const envelope: WebhookEnvelope<T> = {
    event_id: eventId,
    event_type: eventType,
    created_at: createdAtIso,
    data,
  };
  return { envelope, raw: JSON.stringify(envelope) };
}
