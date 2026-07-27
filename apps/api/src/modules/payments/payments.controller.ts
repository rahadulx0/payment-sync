import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@paysync/shared';
import type { Response } from 'express';

import type { CompanyContext } from '../../common/auth/contexts.js';
import { CurrentCompany, ServerAuth } from '../../common/auth/decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.decorator.js';
import { RateLimit } from '../../common/ratelimit/rate-limit.decorator.js';

import { CorrectTrxidDto, RegisterPaymentDto } from './dto.js';
import { PaymentsService } from './payments.service.js';

function company(ctx: CompanyContext | undefined): string {
  if (ctx === undefined) throw new AppError('UNAUTHENTICATED', 'No company context.');
  return ctx.companyId;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ServerAuth('payments:write')
  @RateLimit({ points: 120, windowSec: 60, by: 'company' })
  @Idempotent({ endpoint: 'payments.register' })
  @Post('register')
  async register(
    @Body() dto: RegisterPaymentDto,
    @CurrentCompany() ctx: CompanyContext | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, httpStatus } = await this.payments.register(company(ctx), dto);
    res.status(httpStatus);
    return body;
  }

  @ServerAuth('payments:read')
  @RateLimit({ points: 600, windowSec: 60, by: 'company' })
  @Get(':orderId')
  get(@Param('orderId') orderId: string, @CurrentCompany() ctx: CompanyContext | undefined) {
    return this.payments.get(company(ctx), orderId);
  }

  @ServerAuth('payments:read')
  @Get()
  list(
    @CurrentCompany() ctx: CompanyContext | undefined,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payments.list(company(ctx), {
      status,
      provider,
      cursor,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @ServerAuth('payments:write')
  @Post(':orderId/cancel')
  cancel(@Param('orderId') orderId: string, @CurrentCompany() ctx: CompanyContext | undefined) {
    return this.payments.cancel(company(ctx), orderId);
  }

  @ServerAuth('payments:write')
  @Patch(':orderId/transaction-id')
  correct(
    @Param('orderId') orderId: string,
    @Body() dto: CorrectTrxidDto,
    @CurrentCompany() ctx: CompanyContext | undefined,
  ) {
    return this.payments.correctTransactionId(company(ctx), orderId, dto);
  }
}
