import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AdminAuth } from '../../../common/auth/decorators.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';

@ApiTags('admin-audit')
@AdminAuth()
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('actor_type') actorType?: string,
    @Query('action') action?: string,
    @Query('company_id') companyId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Number(limit ?? '50') || 50, 100);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(actorType !== undefined ? { actor_type: actorType as never } : {}),
        ...(action !== undefined ? { action } : {}),
        ...(companyId !== undefined ? { company_id: companyId } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: take + 1,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take);
    return { items, next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
  }
}
