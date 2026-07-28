import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError, nowUtc } from '@paysync/shared';
import { IsOptional, IsString } from 'class-validator';

import type { AdminContext } from '../../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { AuditService } from '../../admin/audit/audit.service.js';

class ReplayDeadDto {
  @IsString()
  company_id!: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  dry_run?: boolean;
}

@ApiTags('admin-webhooks')
@AdminAuth()
@Controller('admin/webhooks')
export class WebhooksAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('events')
  async listEvents(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Number(limit ?? '50') || 50, 100);
    const rows = await this.prisma.webhookEvent.findMany({
      where: {
        ...(companyId !== undefined ? { company_id: companyId } : {}),
        ...(status !== undefined ? { status: status as never } : {}),
        ...(type !== undefined ? { event_type: type } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: take + 1,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        company_id: true,
        event_type: true,
        status: true,
        attempt_count: true,
        next_attempt_at: true,
        delivered_at: true,
        reason: true,
        created_at: true,
      },
    });
    const items = rows.slice(0, take);
    return { items, next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
  }

  @Get('events/:id/deliveries')
  deliveries(@Param('id') id: string) {
    return this.prisma.webhookDelivery.findMany({
      where: { event_id: id },
      orderBy: { attempt_no: 'asc' },
    });
  }

  /** Manual retry: append a fresh attempt, PRESERVING attempt_count history. */
  @Post('events/:id/retry')
  async retry(@Param('id') id: string, @CurrentAdmin() admin: AdminContext | undefined) {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id } });
    if (event === null) throw new AppError('ORDER_NOT_FOUND', 'Event not found.');
    await this.prisma.webhookEvent.update({
      where: { id },
      data: { status: 'PENDING', next_attempt_at: nowUtc(), paused: false },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin?.adminId,
      action: 'webhook.retry',
      entityType: 'webhook_event',
      entityId: id,
      companyId: event.company_id,
    });
    return { id, status: 'PENDING', manual: true };
  }

  /** Bulk requeue of DEAD events. Dry-run by default: returns the count only. */
  @Post('replay-dead')
  async replayDead(@Body() dto: ReplayDeadDto, @CurrentAdmin() admin: AdminContext | undefined) {
    const where = {
      company_id: dto.company_id,
      status: 'DEAD' as const,
      ...(dto.from !== undefined || dto.to !== undefined
        ? {
            created_at: {
              ...(dto.from !== undefined ? { gte: new Date(dto.from) } : {}),
              ...(dto.to !== undefined ? { lte: new Date(dto.to) } : {}),
            },
          }
        : {}),
    };
    const count = await this.prisma.webhookEvent.count({ where });
    if (dto.dry_run !== false) return { dry_run: true, would_replay: count };

    await this.prisma.webhookEvent.updateMany({
      where,
      data: { status: 'PENDING', next_attempt_at: nowUtc() },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin?.adminId,
      action: 'webhook.replay_dead',
      entityType: 'company',
      entityId: dto.company_id,
      companyId: dto.company_id,
      after: { replayed: count },
    });
    return { dry_run: false, replayed: count };
  }

  @Get('endpoint-health')
  async endpointHealth(@Query('company_id') companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { event: { company_id: companyId } },
      orderBy: { attempted_at: 'desc' },
      take: 200,
      select: { response_status: true, duration_ms: true },
    });
    const durations = deliveries
      .map((d) => d.duration_ms ?? 0)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    const ok = deliveries.filter(
      (d) => d.response_status !== null && d.response_status >= 200 && d.response_status < 300,
    ).length;
    const p95 =
      durations.length > 0 ? (durations[Math.floor(durations.length * 0.95)] ?? null) : null;
    return {
      company_id: companyId,
      breaker_state: company.webhook_breaker_state,
      consecutive_failures: company.webhook_consecutive_failures,
      last_success_at: company.webhook_last_success_at,
      success_rate: deliveries.length > 0 ? ok / deliveries.length : null,
      p95_latency_ms: p95,
      sample_size: deliveries.length,
    };
  }
}
