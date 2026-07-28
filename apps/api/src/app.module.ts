import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { AuthModule } from './common/auth/auth.module.js';
import { requestContextMiddleware } from './common/context/request-context.middleware.js';
import { HttpModule } from './common/http/http.module.js';
import { IdempotencyModule } from './common/idempotency/idempotency.module.js';
import { LoggerModule } from './common/logging/logger.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { RateLimitModule } from './common/ratelimit/rate-limit.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { ConfigModule } from './config/config.module.js';
import { AuditModule } from './modules/admin/audit/audit.module.js';
import { AdminAuthModule } from './modules/admin/auth/admin-auth.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { CompaniesModule } from './modules/companies/companies.module.js';
import { CredentialsModule } from './modules/credentials/credentials.module.js';
import { DevicesAdminModule } from './modules/devices/admin/devices-admin.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { MatchingModule } from './modules/matching/matching.module.js';
import { OpsModule } from './modules/ops/ops.module.js';
import { ParsingModule } from './modules/parsing/parsing.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ProbeModule } from './modules/probe/probe.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { SmsModule } from './modules/sms/sms.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';

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
    HttpModule,
    AuditModule,
    AdminAuthModule,
    CompaniesModule,
    CredentialsModule,
    DevicesAdminModule,
    ParsingModule,
    MatchingModule,
    DevicesModule,
    SmsModule,
    PaymentsModule,
    WebhooksModule,
    ReviewsModule,
    AnalyticsModule,
    OpsModule,
    HealthModule,
    ProbeModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestContextMiddleware).forRoutes('*');
  }
}
