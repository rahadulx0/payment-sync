import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Central Prometheus registry. Metric names are declared here (empty) so they
 * form a stable contract; later tasks increment them (architecture §15.2).
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly smsUploads = new Counter({
    name: 'sms_uploads_total',
    help: 'SMS uploads received',
    labelNames: ['provider', 'source', 'status'],
    registers: [this.registry],
  });
  readonly smsParseFailures = new Counter({
    name: 'sms_parse_failures_total',
    help: 'SMS parse failures',
    labelNames: ['provider'],
    registers: [this.registry],
  });
  readonly parserHintMismatch = new Counter({
    name: 'parser_hint_mismatch_total',
    help: 'Device parse hint vs server parse mismatches',
    labelNames: ['provider'],
    registers: [this.registry],
  });
  readonly matchDecisions = new Counter({
    name: 'match_decisions_total',
    help: 'Match decisions by result and pass',
    labelNames: ['result', 'pass'],
    registers: [this.registry],
  });
  readonly webhookAttempts = new Counter({
    name: 'webhook_attempts_total',
    help: 'Webhook delivery attempts',
    labelNames: ['status', 'error_class'],
    registers: [this.registry],
  });
  readonly verificationLatency = new Histogram({
    name: 'verification_latency_seconds',
    help: 'sms_timestamp to verified_at',
    buckets: [1, 5, 15, 30, 60, 300, 900, 3600],
    registers: [this.registry],
  });
  readonly webhookDeliveryLatency = new Histogram({
    name: 'webhook_delivery_latency_seconds',
    help: 'verified_at to delivered_at',
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
    registers: [this.registry],
  });
  readonly devicesOnline = new Gauge({
    name: 'devices_online',
    help: 'Devices considered online',
    registers: [this.registry],
  });
  readonly pendingOrders = new Gauge({
    name: 'pending_orders',
    help: 'Orders in PENDING',
    registers: [this.registry],
  });
  readonly openReviews = new Gauge({
    name: 'open_reviews',
    help: 'Open match reviews',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
