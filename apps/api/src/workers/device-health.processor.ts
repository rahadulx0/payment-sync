import { Injectable, Logger } from '@nestjs/common';
import { nowUtc } from '@paysync/shared';

import { MetricsService } from '../common/metrics/metrics.service.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import {
  AlertService,
  isDhakaBusinessHours,
  type Alert,
} from '../modules/notifications/alert.service.js';

const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000;

export interface DeviceHealthReport {
  checked: number;
  offline: number;
  alerted: number;
  suppressedOutsideBusinessHours: number;
}

/**
 * Device-offline detection (architecture §15.3). This is a **product feature**,
 * not just ops: a merchant whose phone is offline is silently missing payments,
 * and they should hear about it before their customer complains — so the alert
 * is also routed to the company contact.
 *
 * Business-hours windowing is mandatory. Without it you are paged every night
 * when the shops close, and within two weeks you stop reading the alerts.
 */
@Injectable()
export class DeviceHealthProcessor {
  private readonly log = new Logger(DeviceHealthProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertService,
    private readonly metrics: MetricsService,
  ) {}

  async tick(now: Date = nowUtc()): Promise<DeviceHealthReport> {
    const devices = await this.prisma.device.findMany({
      where: { status: 'ACTIVE' },
      include: { company: { select: { id: true, company_code: true, status: true } } },
    });

    const cutoff = new Date(now.getTime() - OFFLINE_THRESHOLD_MS);
    const offline = devices.filter(
      (d) =>
        d.company.status === 'ACTIVE' &&
        (d.last_heartbeat_at === null || d.last_heartbeat_at < cutoff),
    );
    this.metrics.devicesOnline.set(devices.length - offline.length);

    if (!isDhakaBusinessHours(now)) {
      return {
        checked: devices.length,
        offline: offline.length,
        alerted: 0,
        suppressedOutsideBusinessHours: offline.length,
      };
    }

    // Grouped: ten offline devices are one message, not ten.
    const pending: Alert[] = offline.map((d) => ({
      severity: 'P2' as const,
      key: 'device.offline',
      title: 'Device offline >30 min during business hours',
      detail: `${d.device_name} (${d.company.company_code}) last seen ${d.last_heartbeat_at?.toISOString() ?? 'never'}`,
      runbook: 'docs/device-offline-playbook.md',
      companyId: d.company.id,
    }));

    let alerted = 0;
    for (const alert of this.alerts.group(pending)) {
      if (await this.alerts.fire(alert, now.getTime())) alerted++;
    }
    if (offline.length === 0) await this.alerts.resolve('device.offline', undefined, now.getTime());

    this.log.log(`device health: ${String(offline.length)}/${String(devices.length)} offline`);
    return {
      checked: devices.length,
      offline: offline.length,
      alerted,
      suppressedOutsideBusinessHours: 0,
    };
  }
}
