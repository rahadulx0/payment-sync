import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@paysync/shared';
import { IsOptional, IsString } from 'class-validator';

import type { CompanyContext } from '../../common/auth/contexts.js';
import { CurrentCompany, ServerAuth } from '../../common/auth/decorators.js';
import { SafeUrlService } from '../../common/http/safe-url.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

class WebhookTestDto {
  @IsOptional()
  @IsString()
  callback_url?: string;
}

// Shell for Task 07 — validates the callback and returns not_implemented.
// Task 09 replaces the body with a real signed test.ping delivery.
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookTestController {
  constructor(
    private readonly safeUrl: SafeUrlService,
    private readonly prisma: PrismaService,
  ) {}

  @ServerAuth('payments:write')
  @Post('test')
  async test(@Body() dto: WebhookTestDto, @CurrentCompany() ctx: CompanyContext | undefined) {
    if (ctx === undefined) throw new AppError('UNAUTHENTICATED', 'No company context.');
    const companyRow = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
    });
    const url = dto.callback_url ?? companyRow.default_callback_url;
    if (url === null || url.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No callback_url provided or configured.');
    }
    await this.safeUrl.validate(url);
    return { delivered: false, reason: 'not_implemented', validated_url: url };
  }
}
