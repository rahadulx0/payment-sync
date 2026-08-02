import { describe, expect, it } from 'vitest';

import {
  decryptWith,
  encryptWith,
  reencrypt,
  ROTATION_PLAN,
} from '../../../src/config/crypto-rotation.js';
import {
  AlertService,
  channelsFor,
  isDhakaBusinessHours,
  repeatIntervalMs,
  type Alert,
  type AlertSink,
  type Channel,
} from '../../../src/modules/notifications/alert.service.js';

function alert(over: Partial<Alert> = {}): Alert {
  return {
    severity: 'P2',
    key: 'device.offline',
    title: 'Device offline',
    detail: 'shop-phone last seen 40 min ago',
    runbook: 'docs/device-offline-playbook.md',
    ...over,
  };
}

class RecordingSink implements AlertSink {
  readonly sent: { channel: Channel; alert: Alert }[] = [];
  send(channel: Channel, a: Alert): Promise<void> {
    this.sent.push({ channel, alert: a });
    return Promise.resolve();
  }
}

describe('alert routing', () => {
  it('routes P1/P2 to both channels and P3 to email digest only', () => {
    expect(channelsFor('P1')).toEqual(['telegram', 'email']);
    expect(channelsFor('P2')).toEqual(['telegram', 'email']);
    expect(channelsFor('P3')).toEqual(['email']);
  });

  it('only P1 repeats until acknowledged', () => {
    expect(repeatIntervalMs('P1')).toBe(15 * 60 * 1000);
    expect(repeatIntervalMs('P2')).toBeNull();
    expect(repeatIntervalMs('P3')).toBeNull();
  });

  it('deduplicates within the window so one condition is not spammed', async () => {
    const service = new AlertService();
    const sink = new RecordingSink();
    service.setSink(sink);
    const t0 = 1_800_000_000_000;

    expect(await service.fire(alert(), t0)).toBe(true);
    expect(await service.fire(alert(), t0 + 60_000)).toBe(false); // suppressed
    expect(sink.sent.filter((s) => s.channel === 'telegram')).toHaveLength(1);
  });

  it('P1 re-fires after its repeat interval', async () => {
    const service = new AlertService();
    service.setSink(new RecordingSink());
    const t0 = 1_800_000_000_000;
    expect(await service.fire(alert({ severity: 'P1', key: 'db.down' }), t0)).toBe(true);
    expect(await service.fire(alert({ severity: 'P1', key: 'db.down' }), t0 + 60_000)).toBe(false);
    expect(await service.fire(alert({ severity: 'P1', key: 'db.down' }), t0 + 16 * 60_000)).toBe(
      true,
    );
  });

  it('groups many same-key alerts into one message', () => {
    const service = new AlertService();
    const grouped = service.group([
      alert({ detail: 'phone A' }),
      alert({ detail: 'phone B' }),
      alert({ detail: 'phone C' }),
    ]);
    expect(grouped).toHaveLength(1); // 3 offline devices → 1 alert, not 3
    expect(grouped[0]?.title).toContain('3 affected');
    expect(grouped[0]?.detail).toContain('phone C');
  });

  it('sends a recovery notice only for a condition that was firing', async () => {
    const service = new AlertService();
    service.setSink(new RecordingSink());
    const t0 = 1_800_000_000_000;
    expect(await service.resolve('device.offline', undefined, t0)).toBe(false); // never fired
    await service.fire(alert(), t0);
    expect(await service.resolve('device.offline', undefined, t0)).toBe(true);
  });

  it('per-company alerts dedupe independently', async () => {
    const service = new AlertService();
    service.setSink(new RecordingSink());
    const t0 = 1_800_000_000_000;
    expect(await service.fire(alert({ companyId: 'c1' }), t0)).toBe(true);
    expect(await service.fire(alert({ companyId: 'c2' }), t0)).toBe(true);
    expect(await service.fire(alert({ companyId: 'c1' }), t0 + 1000)).toBe(false);
  });
});

describe('Dhaka business hours (device-offline windowing)', () => {
  it('is quiet overnight so the operator is not paged when shops are closed', () => {
    // 04:00 UTC = 10:00 Dhaka → business hours.
    expect(isDhakaBusinessHours(new Date('2026-07-28T04:00:00Z'))).toBe(true);
    // 18:00 UTC = 00:00 Dhaka → closed.
    expect(isDhakaBusinessHours(new Date('2026-07-28T18:00:00Z'))).toBe(false);
    // 20:00 UTC = 02:00 Dhaka → closed.
    expect(isDhakaBusinessHours(new Date('2026-07-28T20:00:00Z'))).toBe(false);
    // 16:30 UTC = 22:30 Dhaka → still open.
    expect(isDhakaBusinessHours(new Date('2026-07-28T16:30:00Z'))).toBe(true);
  });
});

describe('KEY_ENCRYPTION_KEY rotation', () => {
  const oldKey = Buffer.alloc(32, 1);
  const newKey = Buffer.alloc(32, 2);

  it('re-encrypts a secret so it still decrypts with the new key', () => {
    const blob = encryptWith('whsec_super_secret', oldKey);
    const rotated = reencrypt(blob, oldKey, newKey);
    expect(decryptWith(rotated, newKey)).toBe('whsec_super_secret');
  });

  it('fails loudly on a wrong old key rather than corrupting data', () => {
    const blob = encryptWith('whsec_super_secret', oldKey);
    const wrongKey = Buffer.alloc(32, 9);
    // GCM authentication makes this throw — it can never write back garbage.
    expect(() => reencrypt(blob, wrongKey, newKey)).toThrow();
  });

  it('the rotation plan covers every encrypted-at-rest column', () => {
    // Missing one here would silently destroy those secrets on rotation.
    expect(ROTATION_PLAN).toEqual(
      expect.arrayContaining([
        { table: 'companies', column: 'webhook_secret_enc' },
        { table: 'companies', column: 'webhook_secret_prev_enc' },
        { table: 'admin_users', column: 'totp_secret_enc' },
      ]),
    );
  });
});
