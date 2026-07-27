import { Injectable } from '@nestjs/common';
import { AppError, type DeviceStatus } from '@paysync/shared';
import type { Device } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { AuditService } from '../../admin/audit/audit.service.js';

const ONLINE_WINDOW_MS = 2 * 15 * 60 * 1000; // 2 × heartbeat interval

@Injectable()
export class DevicesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private withOnline(d: Device) {
    const online =
      d.last_heartbeat_at !== null && d.last_heartbeat_at.getTime() > Date.now() - ONLINE_WINDOW_MS;
    return { ...d, online };
  }

  async list(params: {
    companyId?: string | undefined;
    status?: string | undefined;
    online?: string | undefined;
  }) {
    const rows = await this.prisma.device.findMany({
      where: {
        ...(params.companyId !== undefined ? { company_id: params.companyId } : {}),
        ...(params.status !== undefined ? { status: params.status as DeviceStatus } : {}),
      },
      orderBy: { last_heartbeat_at: 'desc' },
    });
    let items = rows.map((d) => this.withOnline(d));
    if (params.online === 'true') items = items.filter((d) => d.online);
    else if (params.online === 'false') items = items.filter((d) => !d.online);
    return { items };
  }

  async get(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (device === null) throw new AppError('ORDER_NOT_FOUND', 'Device not found.');
    return this.withOnline(device);
  }

  async patch(
    id: string,
    data: { device_name?: string; wallet_msisdn?: string },
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ) {
    const device = await this.prisma.device.update({ where: { id }, data });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'device.rename',
      entityType: 'device',
      entityId: id,
      companyId: device.company_id,
      ip: ctx.ip,
    });
    return this.withOnline(device);
  }

  async setStatus(
    id: string,
    status: DeviceStatus,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ) {
    const device = await this.prisma.device.update({ where: { id }, data: { status } });
    const action =
      status === 'BLOCKED'
        ? 'device.block'
        : status === 'RETIRED'
          ? 'device.retire'
          : 'device.unblock';
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action,
      entityType: 'device',
      entityId: id,
      companyId: device.company_id,
      ip: ctx.ip,
    });
    return this.withOnline(device);
  }

  async forceSync(id: string, ctx: { adminId?: string | undefined; ip?: string | undefined }) {
    const device = await this.prisma.device.update({
      where: { id },
      data: { force_sync_requested: true },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'device.force_sync',
      entityType: 'device',
      entityId: id,
      companyId: device.company_id,
      ip: ctx.ip,
    });
    return { id, queued: true, note: 'Applies at the next heartbeat (≤15 min).' };
  }

  async rotateToken(id: string, ctx: { adminId?: string | undefined; ip?: string | undefined }) {
    const device = await this.prisma.device.update({
      where: { id },
      data: { rotate_token_requested: true },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'device.rotate_token',
      entityType: 'device',
      entityId: id,
      companyId: device.company_id,
      ip: ctx.ip,
    });
    return { id, queued: true };
  }
}
