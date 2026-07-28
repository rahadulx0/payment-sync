import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { nowUtc } from '@paysync/shared';

import type { AdminContext } from '../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../common/auth/decorators.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

import { ResolveReviewDto } from './dto.js';
import { ResolveService } from './resolve.service.js';

@ApiTags('admin-reviews')
@AdminAuth()
@Controller('admin/reviews')
export class ReviewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ResolveService,
  ) {}

  @Get()
  async list(
    @Query('status') status = 'OPEN',
    @Query('company_id') companyId?: string,
    @Query('reason') reason?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Number(limit ?? '50') || 50, 100);
    const rows = await this.prisma.matchReview.findMany({
      where: {
        status: status as never,
        ...(companyId !== undefined ? { company_id: companyId } : {}),
        ...(reason !== undefined ? { reason: reason as never } : {}),
      },
      orderBy: { created_at: 'asc' }, // oldest first — work the queue FIFO
      take: take + 1,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take).map((r) => ({
      ...r,
      age_minutes: Math.floor((nowUtc().getTime() - r.created_at.getTime()) / 60000),
    }));
    return { items, next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
  }

  @Get('stats')
  async stats() {
    const byReason = await this.prisma.matchReview.groupBy({
      by: ['reason'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    });
    const open = await this.prisma.matchReview.findMany({
      where: { status: 'OPEN' },
      select: { created_at: true },
      orderBy: { created_at: 'asc' },
    });
    const ages = open
      .map((r) => (nowUtc().getTime() - r.created_at.getTime()) / 60000)
      .sort((a, b) => a - b);
    const median = ages.length > 0 ? (ages[Math.floor(ages.length / 2)] ?? 0) : 0;
    return {
      open_total: open.length,
      median_age_minutes: Math.round(median),
      by_reason: Object.fromEntries(byReason.map((r) => [r.reason, r._count._all])),
      as_of: nowUtc().toISOString(),
    };
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReviewDto,
    @CurrentAdmin() admin: AdminContext | undefined,
  ) {
    return this.resolver.resolve(id, dto, admin?.adminId);
  }
}
