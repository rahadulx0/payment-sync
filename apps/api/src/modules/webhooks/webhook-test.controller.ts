import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError, type WebhookTestResponse } from '@paysync/shared';
import { IsOptional, IsString } from 'class-validator';

import type { CompanyContext } from '../../common/auth/contexts.js';
import { CurrentCompany, ServerAuth } from '../../common/auth/decorators.js';
import { SafeUrlService } from '../../common/http/safe-url.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ConfigService } from '../../config/config.service.js';

import { DeliveryService } from './delivery/delivery.service.js';

class WebhookTestDto {
  @IsOptional()
  @IsString()
  callback_url?: string;
}

/**
 * Synchronous single-attempt test delivery (Task 09 §4.6). Returns the status,
 * latency, response excerpt, the exact signature header sent, and the expected
 * `v1` — so a client can diff their own computation and self-diagnose a
 * signature mismatch without a support ticket.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookTestController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly safeUrl: SafeUrlService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @ServerAuth('payments:write')
  @Post('test')
  async test(
    @Body() dto: WebhookTestDto,
    @CurrentCompany() ctx: CompanyContext | undefined,
  ): Promise<WebhookTestResponse> {
    if (ctx === undefined) throw new AppError('UNAUTHENTICATED', 'No company context.');
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
    const url = dto.callback_url ?? company.default_callback_url;
    if (url === null || url.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'No callback_url provided or configured.');
    }
    if (company.webhook_secret_enc === null) {
      throw new AppError('VALIDATION_ERROR', 'No webhook secret set; rotate one first.');
    }
    if (!this.config.webhookInsecureAllowed) await this.safeUrl.validate(url);
    return this.delivery.sendTestPing(company, url);
  }
}
