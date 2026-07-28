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
  readonly matchingDuration = new Histogram({
    name: 'matching_duration_seconds',
    help: 'Wall-clock duration of a single match run',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
    registers: [this.registry],
  });
  readonly matchingConflicts = new Counter({
    name: 'matching_conflicts_total',
    help: 'Unique-violation conflicts during apply (a concurrency path to review; money never moved twice)',
    registers: [this.registry],
  });
  readonly matchingLockWait = new Histogram({
    name: 'matching_lock_wait_seconds',
    help: 'Time spent waiting on the per-company advisory lock',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [this.registry],
  });
  readonly duplicateTxn = new Counter({
    name: 'duplicate_txn_total',
    help: 'Duplicate-TrxID credit SMS detected',
    registers: [this.registry],
  });
  readonly invariantViolations = new Counter({
    name: 'invariant_violations_total',
    help: 'Invariant check violations detected by the periodic job',
    labelNames: ['check'],
    registers: [this.registry],
  });
  readonly unmatchedSms = new Gauge({
    name: 'unmatched_sms_gauge',
    help: 'Unmatched SMS per company',
    labelNames: ['company'],
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
