import { Injectable, Logger } from '@nestjs/common';

export type Severity = 'P1' | 'P2' | 'P3';

export interface Alert {
  severity: Severity;
  /** Stable key used for grouping/deduplication, e.g. `device.offline`. */
  key: string;
  title: string;
  detail: string;
  /** Anchor in docs/runbook.md — every alert must lead to a procedure. */
  runbook: string;
  /** Present when the alert concerns one tenant, so the company can be notified too. */
  companyId?: string | undefined;
}

export type Channel = 'telegram' | 'email';

/** Severity → channels (architecture §15.3). P3 is digest-only email. */
export function channelsFor(severity: Severity): Channel[] {
  switch (severity) {
    case 'P1':
    case 'P2':
      return ['telegram', 'email'];
    case 'P3':
      return ['email'];
  }
}

/** P1 repeats until acknowledged; the others fire once per dedupe window. */
export function repeatIntervalMs(severity: Severity): number | null {
  return severity === 'P1' ? 15 * 60 * 1000 : null;
}

const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

export interface AlertSink {
  send(channel: Channel, alert: Alert): Promise<void>;
}

/**
 * Alert routing (architecture §15.3). Two properties matter more than the
 * transport: **grouping** (ten offline devices must be one message, not ten) and
 * **recovery notices** (an alert that never clears trains you to ignore it).
 * Alert fatigue kills a one-operator system within two weeks.
 */
@Injectable()
export class AlertService {
  private readonly log = new Logger(AlertService.name);
  private readonly lastSent = new Map<string, number>();
  private readonly firing = new Set<string>();
  private sink: AlertSink | null = null;

  /** Set by the transport module (Telegram/email) or a test double. */
  setSink(sink: AlertSink): void {
    this.sink = sink;
  }

  async fire(alert: Alert, now: number = Date.now()): Promise<boolean> {
    const dedupeKey = `${alert.key}:${alert.companyId ?? ''}`;
    const last = this.lastSent.get(dedupeKey);
    const interval = repeatIntervalMs(alert.severity) ?? DEDUPE_WINDOW_MS;
    if (last !== undefined && now - last < interval) return false;

    this.lastSent.set(dedupeKey, now);
    this.firing.add(dedupeKey);
    for (const channel of channelsFor(alert.severity)) {
      await this.sink?.send(channel, alert).catch((e: unknown) => {
        this.log.error(`alert send failed on ${channel}: ${String(e)}`);
      });
    }
    return true;
  }

  /** Sends a recovery notice only if the condition was actually firing. */
  async resolve(key: string, companyId?: string, now: number = Date.now()): Promise<boolean> {
    const dedupeKey = `${key}:${companyId ?? ''}`;
    if (!this.firing.has(dedupeKey)) return false;
    this.firing.delete(dedupeKey);
    this.lastSent.delete(dedupeKey);
    const alert: Alert = {
      severity: 'P3',
      key: `${key}.resolved`,
      title: `RESOLVED: ${key}`,
      detail: 'The condition has cleared.',
      runbook: '#',
      ...(companyId !== undefined ? { companyId } : {}),
    };
    await this.sink?.send('telegram', alert).catch(() => undefined);
    void now;
    return true;
  }

  /** Groups many same-key alerts into one message (10 offline devices → 1 alert). */
  group(alerts: Alert[]): Alert[] {
    const byKey = new Map<string, Alert[]>();
    for (const a of alerts) {
      const list = byKey.get(a.key) ?? [];
      list.push(a);
      byKey.set(a.key, list);
    }
    const out: Alert[] = [];
    for (const [key, list] of byKey) {
      const [first] = list;
      if (first === undefined) continue;
      if (list.length === 1) {
        out.push(first);
        continue;
      }
      out.push({
        ...first,
        key,
        title: `${first.title} (${String(list.length)} affected)`,
        detail: list.map((a) => a.detail).join('\n'),
      });
    }
    return out;
  }
}

/**
 * Device-offline alerting is business-hours-aware (architecture §15.3) — without
 * this you get paged every night when the shops close, and then you stop reading
 * the alerts entirely.
 */
export function isDhakaBusinessHours(at: Date): boolean {
  const dhakaHour = new Date(at.getTime() + 6 * 60 * 60 * 1000).getUTCHours();
  return dhakaHour >= 9 && dhakaHour < 23;
}
