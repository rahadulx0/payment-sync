import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AdminAuth } from '../../common/auth/decorators.js';

import { OpsService } from './ops.service.js';

/** Read-only operations views for the Task 12 dashboard (admin-only). */
@ApiTags('admin-ops')
@AdminAuth()
@Controller('admin/ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('sms-logs')
  listSms(
    @Query('company_id') companyId?: string,
    @Query('provider') provider?: string,
    @Query('parse_status') parseStatus?: string,
    @Query('match_status') matchStatus?: string,
    @Query('q') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listSmsLogs({
      companyId,
      provider,
      parseStatus,
      matchStatus,
      search,
      cursor,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('sms-logs/:id')
  smsDetail(@Param('id') id: string) {
    return this.ops.smsDetail(id);
  }

  @Get('orders')
  listOrders(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('q') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ops.listOrders({
      companyId,
      status,
      search,
      cursor,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('orders/:id')
  orderDetail(@Param('id') id: string) {
    return this.ops.orderDetail(id);
  }
}
