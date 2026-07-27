import { Injectable } from '@nestjs/common';
import {
  AppError,
  type DeviceRegisterResponse,
  type HeartbeatResponse,
  issueCredential,
  nowUtc,
} from '@paysync/shared';

import { AuthAttemptService } from '../../common/auth/auth-attempt.service.js';
import type { CompanyContext, DeviceContext } from '../../common/auth/contexts.js';
import { CredentialService } from '../../common/auth/credential.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

import { DeviceConfigService } from './device-config.service.js';
import type { DeviceEventsDto, DeviceRegisterDto, HeartbeatDto } from './dto.js';

const HEARTBEAT_INTERVAL_SEC = 900;
const CLOCK_SKEW_ALERT_SEC = 300;

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    private readonly config: DeviceConfigService,
    private readonly authAttempts: AuthAttemptService,
  ) {}

  async enroll(dto: DeviceRegisterDto, ip?: string): Promise<DeviceRegisterResponse> {
    const key = await this.credentials.findByPlaintext(dto.enroll_key);
    if (key === null || key.key_type !== 'DEVICE_ENROLL') {
      await this.authAttempts.record({
        kind: 'DEVICE_TOKEN',
        subject: dto.company_code,
        outcome: 'FAILURE',
        reason: 'bad_enroll_key',
        ip,
      });
      throw new AppError('UNAUTHENTICATED', 'Invalid enrolment key.');
    }
    const company = await this.prisma.company.findUnique({
      where: { id: key.company_id },
      include: { settings: true },
    });
    if (company === null || company.company_code !== dto.company_code) {
      throw new AppError('UNAUTHENTICATED', 'Invalid enrolment key or company.');
    }
    if (company.status !== 'ACTIVE') {
      throw new AppError('COMPANY_SUSPENDED', 'This company is not active.');
    }

    const issued = issueCredential('DEVICE_TOKEN');
    const tokenHash = await this.credentials.hash(issued.plaintext);
    const existing = await this.prisma.device.findUnique({ where: { install_id: dto.install_id } });

    let device;
    if (existing !== null) {
      if (existing.status === 'RETIRED')
        throw new AppError('DEVICE_RETIRED', 'Device retired; contact support.');
      if (existing.status === 'BLOCKED') throw new AppError('DEVICE_BLOCKED', 'Device is blocked.');
      device = await this.prisma.device.update({
        where: { id: existing.id },
        data: {
          token_hash: tokenHash,
          token_issued_at: new Date(),
          model: dto.model,
          manufacturer: dto.manufacturer,
          android_version: dto.android_version,
          app_version: dto.app_version,
          ...(dto.wallet_msisdn !== undefined ? { wallet_msisdn: dto.wallet_msisdn } : {}),
        },
      });
    } else {
      const maxDevices = company.settings?.max_devices ?? 1;
      const activeCount = await this.prisma.device.count({
        where: { company_id: company.id, status: { not: 'RETIRED' } },
      });
      if (activeCount >= maxDevices) {
        throw new AppError(
          'DEVICE_LIMIT_REACHED',
          'Device limit reached; retire an old device first.',
        );
      }
      device = await this.prisma.device.create({
        data: {
          company_id: company.id,
          device_name: dto.device_name ?? 'Merchant Phone',
          install_id: dto.install_id,
          model: dto.model,
          manufacturer: dto.manufacturer,
          android_version: dto.android_version,
          app_version: dto.app_version,
          wallet_msisdn: dto.wallet_msisdn ?? null,
          token_hash: tokenHash,
        },
      });
    }

    await this.authAttempts.record({
      kind: 'DEVICE_TOKEN',
      subject: dto.company_code,
      outcome: 'SUCCESS',
      companyId: company.id,
      ip,
    });

    return {
      device_id: device.id,
      device_token: issued.plaintext,
      device_name: device.device_name,
      config: await this.config.build(),
      server_time: nowUtc().toISOString(),
    };
  }

  async heartbeat(ctx: DeviceContext, dto: HeartbeatDto): Promise<HeartbeatResponse> {
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: ctx.deviceId } });
    const serverNow = nowUtc();
    const skew = Math.round((serverNow.getTime() - new Date(dto.device_now).getTime()) / 1000);

    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        app_version: dto.app_version,
        android_version: dto.android_version,
        battery_pct: Math.round(dto.battery_pct),
        is_ignoring_battery_opt: dto.is_ignoring_battery_opt,
        has_sms_permission: dto.has_sms_permission,
        network_type: dto.network_type,
        clock_skew_seconds: skew,
        last_heartbeat_at: serverNow,
        // Directives are consumed here.
        force_sync_requested: false,
        rotate_token_requested: false,
        message_for_user: null,
      },
    });

    return {
      server_time: serverNow.toISOString(),
      directives: {
        force_full_sync: device.force_sync_requested,
        rotate_token: device.rotate_token_requested,
        config_version: this.config.configVersion(),
        config_changed: dto.config_version !== this.config.configVersion(),
        message_for_user: device.message_for_user,
        requested_heartbeat_interval_sec: null,
        pause_uploads: false,
      },
      next_heartbeat_after_sec: HEARTBEAT_INTERVAL_SEC,
    };
  }

  clockSkewHigh(skew: number): boolean {
    return Math.abs(skew) > CLOCK_SKEW_ALERT_SEC;
  }

  async rotateToken(ctx: DeviceContext): Promise<{ device_token: string }> {
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id: ctx.deviceId } });
    const issued = issueCredential('DEVICE_TOKEN');
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        prev_token_hash: device.token_hash,
        token_hash: await this.credentials.hash(issued.plaintext),
        token_rotated_at: new Date(),
      },
    });
    return { device_token: issued.plaintext };
  }

  async recordEvents(
    company: CompanyContext,
    ctx: DeviceContext,
    dto: DeviceEventsDto,
  ): Promise<{ recorded: number }> {
    if (dto.events.length === 0) return { recorded: 0 };
    await this.prisma.deviceEvent.createMany({
      data: dto.events.map((e) => ({
        device_id: ctx.deviceId,
        company_id: company.companyId,
        type: e.type,
        at: new Date(e.at),
        detail: (e.detail ?? undefined) as never,
      })),
    });
    return { recorded: dto.events.length };
  }
}
