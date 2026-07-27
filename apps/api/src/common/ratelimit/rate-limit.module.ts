import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from './rate-limit.guard.js';

@Module({
  providers: [RateLimitGuard, { provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
