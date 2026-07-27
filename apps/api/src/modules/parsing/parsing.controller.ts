import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError, nowUtc } from '@paysync/shared';
import type { Request } from 'express';

import type { AdminContext } from '../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../common/auth/decorators.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService } from '../admin/audit/audit.service.js';

import { ParserService } from './parser.service.js';
import { RuleRepository } from './rule.repository.js';

@ApiTags('admin-parsing')
@AdminAuth()
@Controller('admin')
export class ParsingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ParserService,
    private readonly rules: RuleRepository,
    private readonly audit: AuditService,
  ) {}

  @Get('parser-rules')
  listRules() {
    return this.prisma.parserRule.findMany({ orderBy: [{ provider: 'asc' }, { version: 'desc' }] });
  }

  @Post('parser-rules/:id/activate')
  async activate(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    const rule = await this.prisma.parserRule.findUnique({ where: { id } });
    if (rule === null) throw new AppError('ORDER_NOT_FOUND', 'Rule not found.');
    await this.prisma.$transaction([
      this.prisma.parserRule.updateMany({
        where: { provider: rule.provider, is_active: true },
        data: { is_active: false },
      }),
      this.prisma.parserRule.update({ where: { id }, data: { is_active: true } }),
    ]);
    await this.rules.invalidate();
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin?.adminId,
      action: 'parser_rule.activate',
      entityType: 'parser_rule',
      entityId: id,
      ip: req.ip,
    });
    return { activated: id, provider: rule.provider, version: rule.version };
  }

  @Get('parser-health')
  async health() {
    const grouped = await this.prisma.smsLog.groupBy({
      by: ['provider', 'parse_status'],
      _count: { _all: true },
    });
    const active = await this.prisma.parserRule.findMany({ where: { is_active: true } });
    const byProvider: Record<string, Record<string, number>> = {};
    for (const g of grouped) {
      const bucket = (byProvider[g.provider] ??= {});
      bucket[g.parse_status] = g._count._all;
    }
    return {
      config_version: this.rules.getConfigVersion(),
      providers: active.map((r) => ({
        provider: r.provider,
        active_version: r.version,
        counts: byProvider[r.provider] ?? {},
      })),
    };
  }

  @Get('sms-logs/unparsed')
  unparsed(@Query('provider') provider?: string) {
    return this.prisma.smsLog.findMany({
      where: {
        parse_status: { in: ['UNPARSED', 'PARTIAL'] },
        ...(provider !== undefined ? { provider: provider as never } : {}),
      },
      orderBy: { uploaded_at: 'desc' },
      take: 100,
    });
  }

  @Post('sms-logs/:id/reparse')
  async reparse(
    @Param('id') id: string,
    @Query('force') force: string | undefined,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    const sms = await this.prisma.smsLog.findUnique({
      where: { id },
      include: { verifiedTransaction: true },
    });
    if (sms === null) throw new AppError('ORDER_NOT_FOUND', 'SMS log not found.');
    if (sms.verifiedTransaction !== null && force !== 'true') {
      throw new AppError(
        'VALIDATION_ERROR',
        'This message is linked to a verification; re-parse requires force=true.',
      );
    }
    const before = {
      provider: sms.provider,
      transaction_id: sms.transaction_id,
      amount: sms.amount?.toString() ?? null,
      parse_status: sms.parse_status,
    };
    const { update } = this.parser.extract(sms.sms_address, sms.raw_message, nowUtc());
    const updated = await this.prisma.smsLog.update({ where: { id }, data: update });
    const after = {
      provider: updated.provider,
      transaction_id: updated.transaction_id,
      amount: updated.amount?.toString() ?? null,
      parse_status: updated.parse_status,
    };
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: admin?.adminId,
      action: 'sms.reparse',
      entityType: 'sms_log',
      entityId: id,
      before,
      after,
      companyId: sms.company_id,
      ip: req.ip,
    });
    return { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
  }
}
