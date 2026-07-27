import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { AuthModule } from './common/auth/auth.module.js';
import { requestContextMiddleware } from './common/context/request-context.middleware.js';
import { IdempotencyModule } from './common/idempotency/idempotency.module.js';
import { LoggerModule } from './common/logging/logger.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { RateLimitModule } from './common/ratelimit/rate-limit.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ProbeModule } from './modules/probe/probe.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    MetricsModule,
    AuthModule,
    RateLimitModule,
    IdempotencyModule,
    HealthModule,
    ProbeModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
