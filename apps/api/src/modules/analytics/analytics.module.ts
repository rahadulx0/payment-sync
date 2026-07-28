import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsCache } from './cache.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCache],
})
export class AnalyticsModule {}
