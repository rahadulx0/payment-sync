import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AdminAuth } from '../../common/auth/decorators.js';

import { AnalyticsService } from './analytics.service.js';

@ApiTags('admin-analytics')
@AdminAuth()
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Query('range') range?: string) {
    return this.analytics.overview(range);
  }

  @Get('providers')
  providers(@Query('range') range?: string) {
    return this.analytics.providers(range);
  }

  @Get('daily')
  daily(@Query('range') range?: string, @Query('company_id') companyId?: string) {
    return this.analytics.daily(range, companyId);
  }

  @Get('funnel')
  funnel(@Query('range') range?: string) {
    return this.analytics.funnel(range);
  }

  @Get('verification-methods')
  methods(@Query('range') range?: string) {
    return this.analytics.verificationMethods(range);
  }

  @Get('companies')
  companies(@Query('range') range?: string) {
    return this.analytics.companies(range);
  }

  @Get('parser-health')
  parserHealth() {
    return this.analytics.parserHealth();
  }
}
