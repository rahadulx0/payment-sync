import { Injectable, Logger } from '@nestjs/common';
import { nowUtc, uuidv7, WEBHOOK_HEADERS, type WebhookTestResponse } from '@paysync/shared';
import type { Company } from '@prisma/client';

import { SafeUrlService } from '../../../common/http/safe-url.service.js';
import { MetricsService } from '../../../common/metrics/metrics.service.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { ConfigService } from '../../../config/config.service.js';
import { buildEnvelope } from '../signing/payload.js';
import { SignerService } from '../signing/signer.service.js';

import {
  type Classification,
  classifyResponse,
  classifyTransportError,
  UNSAFE_CALLBACK,
} from './classify.js';
import { nextAttemptAt, retryAfterMs } from './schedule.js';

const BREAKER_THRESHOLD = 10;
const BODY_EXCERPT_MAX = 2048;
const DEFAULT_TIMEOUT_MS = 8000;

interface SendResult {
  status: number | null;
  body: string;
  durationMs: number;
  errorClass: string | null;
  retryAfter: string | null;
}

/**
 * Signs and delivers a single webhook event with the retry/breaker policy from
 * architecture §10.2. Redirects are never followed and the callback is
 * re-validated against SSRF immediately before the send (DNS can be re-pointed
 * after registration). Delivery is idempotent on the event: it transitions
 * PENDING → DELIVERED at most once.
 */
@Injectable()
export class DeliveryService {
  private readonly log = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: SignerService,
    private readonly safeUrl: SafeUrlService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async deliverEvent(eventId: string): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
      include: { company: { include: { settings: true } } },
    });
    if (event === null || event.status !== 'PENDING' || event.paused) return;
    const company = event.company;
    if (company.status !== 'ACTIVE') {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { paused: true, next_attempt_at: null },
      });
      return;
    }
    if (event.callback_url === null || event.payload_raw === null) {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'FAILED', reason: 'NO_CALLBACK_URL' },
      });
      return;
    }

    const now = nowUtc();
    const attempt = event.attempt_count + 1;
    const maxAttempts = event.company.settings?.webhook_max_attempts ?? 8;
    const timeoutMs = event.company.settings?.webhook_timeout_ms ?? DEFAULT_TIMEOUT_MS;

    // Re-validate against SSRF at send time; never send if it fails.
    if (!this.config.webhookInsecureAllowed) {
      try {
        await this.safeUrl.validate(event.callback_url);
      } catch {
        await this.recordDelivery(
          eventId,
          attempt,
          event.callback_url,
          null,
          '',
          0,
          'UNSAFE_CALLBACK_URL',
        );
        await this.applyOutcome(
          event.id,
          company,
          UNSAFE_CALLBACK,
          attempt,
          maxAttempts,
          now,
          null,
        );
        return;
      }
    }

    const sig = this.signer.sign(company, event.payload_raw, now);
    const headers = this.buildHeaders(
      event.id,
      event.event_type,
      sig.header,
      sig.timestamp,
      attempt,
    );
    const sent = await this.send(event.callback_url, event.payload_raw, headers, timeoutMs);

    const cls =
      sent.status === null
        ? classifyTransportError(sent.errorClass ?? 'TRANSPORT')
        : classifyResponse(sent.status);

    await this.recordDelivery(
      eventId,
      attempt,
      event.callback_url,
      sent.status,
      sent.body,
      sent.durationMs,
      cls.errorClass,
      headers,
    );
    this.metrics.webhookDeliveryLatency.observe(sent.durationMs / 1000);
    this.metrics.webhookAttempts.inc({ status: cls.outcome, error_class: cls.errorClass ?? '' });
    await this.applyOutcome(
      event.id,
      company,
      cls,
      attempt,
      maxAttempts,
      now,
      sent.retryAfter,
      event.created_at,
    );
  }

  /** Synchronous single-attempt delivery for POST /webhooks/test. */
  async sendTestPing(company: Company, callbackUrl: string): Promise<WebhookTestResponse> {
    const now = nowUtc();
    const id = uuidv7();
    const { raw } = buildEnvelope(id, 'test.ping', now.toISOString(), {
      message: 'This is a test webhook from payment-sync.',
      company_code: company.company_code,
    });
    const sig = this.signer.sign(company, raw, now);
    const headers = this.buildHeaders(id, 'test.ping', sig.header, sig.timestamp, 1);
    const sent = await this.send(callbackUrl, raw, headers, DEFAULT_TIMEOUT_MS);
    return {
      delivered: sent.status !== null && sent.status >= 200 && sent.status < 300,
      status_code: sent.status,
      latency_ms: Math.round(sent.durationMs),
      response_excerpt: sent.body.slice(0, 500) || null,
      signature_sent: sig.header,
      expected_v1: sig.expectedV1,
      error_class: sent.errorClass,
    };
  }

  private async send(
    url: string,
    body: string,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<SendResult> {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
    }, timeoutMs);
    const start = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - start) / 1e6;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: ac.signal,
      });
      // redirect:'manual' surfaces 3xx as an opaqueredirect (status 0).
      const status = res.type === 'opaqueredirect' || res.status === 0 ? 302 : res.status;
      const text = (await res.text().catch(() => '')).slice(0, BODY_EXCERPT_MAX);
      return {
        status,
        body: text,
        durationMs: ms(),
        errorClass: null,
        retryAfter: res.headers.get('retry-after'),
      };
    } catch (err) {
      const errorClass = ac.signal.aborted ? 'TIMEOUT' : transportErrorClass(err);
      return { status: null, body: '', durationMs: ms(), errorClass, retryAfter: null };
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(
    eventId: string,
    eventType: string,
    signature: string,
    timestamp: number,
    attempt: number,
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'User-Agent': this.config.webhookUserAgent,
      [WEBHOOK_HEADERS.EVENT_ID]: eventId,
      [WEBHOOK_HEADERS.EVENT_TYPE]: eventType,
      [WEBHOOK_HEADERS.TIMESTAMP]: String(timestamp),
      [WEBHOOK_HEADERS.SIGNATURE]: signature,
      [WEBHOOK_HEADERS.ATTEMPT]: String(attempt),
      'X-Request-Id': uuidv7(),
    };
  }

  private async recordDelivery(
    eventId: string,
    attemptNo: number,
    url: string,
    status: number | null,
    body: string,
    durationMs: number,
    errorClass: string | null,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this.prisma.webhookDelivery.create({
      data: {
        event_id: eventId,
        attempt_no: attemptNo,
        request_url: url,
        request_headers: redactHeaders(headers ?? {}),
        response_status: status,
        response_body: body.slice(0, BODY_EXCERPT_MAX),
        error_class: errorClass,
        duration_ms: Math.round(durationMs),
      },
    });
  }

  private async applyOutcome(
    eventId: string,
    company: Company,
    cls: Classification,
    attempt: number,
    maxAttempts: number,
    now: Date,
    retryAfter: string | null,
    createdAt?: Date,
  ): Promise<void> {
    if (cls.outcome === 'DELIVERED') {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'DELIVERED', delivered_at: now, attempt_count: attempt },
      });
      await this.closeBreaker(company.id, now);
      if (createdAt !== undefined) {
        this.metrics.webhookTimeToDelivery.observe((now.getTime() - createdAt.getTime()) / 1000);
      }
      return;
    }
    if (cls.outcome === 'CANCELLED') {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'CANCELLED', reason: cls.reason, attempt_count: attempt },
      });
      return;
    }
    if (cls.outcome === 'FAILED') {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'FAILED', reason: cls.reason, attempt_count: attempt },
      });
      await this.recordFailure(company.id, now);
      return;
    }
    // RETRY
    const breakerOpen = company.webhook_breaker_state === 'OPEN';
    const override = retryAfterMs(retryAfter);
    let next = nextAttemptAt(attempt, maxAttempts, now, jitterRng(eventId, attempt), breakerOpen);
    if (next !== null && override !== null) next = new Date(now.getTime() + override);
    if (next === null) {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'DEAD', attempt_count: attempt, next_attempt_at: null },
      });
      this.metrics.webhookDead.inc();
      this.log.error(`webhook event ${eventId} DEAD after ${String(attempt)} attempts`);
    } else {
      await this.prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'PENDING', attempt_count: attempt, next_attempt_at: next },
      });
    }
    await this.recordFailure(company.id, now);
  }

  private async recordFailure(companyId: string, now: Date): Promise<void> {
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { webhook_consecutive_failures: { increment: 1 } },
    });
    if (
      updated.webhook_consecutive_failures >= BREAKER_THRESHOLD &&
      updated.webhook_breaker_state !== 'OPEN'
    ) {
      await this.prisma.company.update({
        where: { id: companyId },
        data: { webhook_breaker_state: 'OPEN', webhook_breaker_opened_at: now },
      });
      this.metrics.webhookBreakerOpen.set({ company: companyId }, 1);
      this.log.warn(`webhook circuit breaker OPEN for company ${companyId}`);
    }
  }

  private async closeBreaker(companyId: string, now: Date): Promise<void> {
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        webhook_consecutive_failures: 0,
        webhook_breaker_state: 'CLOSED',
        webhook_breaker_opened_at: null,
        webhook_last_success_at: now,
      },
    });
    this.metrics.webhookBreakerOpen.set({ company: companyId }, 0);
  }
}

/** Deterministic per-(event,attempt) jitter — no Math.random, reproducible in tests. */
function jitterRng(eventId: string, attempt: number): () => number {
  let h = attempt >>> 0;
  for (const ch of eventId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return () => (h = (h * 1664525 + 1013904223) >>> 0) / 0xffffffff;
}

function transportErrorClass(err: unknown): string {
  const cause = (err as { cause?: unknown }).cause;
  const causeCode =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  const direct = (err as { code?: unknown }).code;
  const code = typeof causeCode === 'string' ? causeCode : typeof direct === 'string' ? direct : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS';
  if (code === 'ECONNREFUSED') return 'CONN_REFUSED';
  if (code.startsWith('CERT_')) return 'TLS';
  if (code.includes('TIMEOUT')) return 'TIMEOUT';
  return 'TRANSPORT';
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'authorization' || k === WEBHOOK_HEADERS.SIGNATURE) {
      out[k] = '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}
