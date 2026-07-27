import { Module } from '@nestjs/common';

import { LoggerModule } from '../common/logging/logger.module.js';
import { PrismaModule } from '../common/prisma/prisma.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { ConfigModule } from '../config/config.module.js';

// The worker process shares config/logging/prisma/redis but registers no HTTP
// server. BullMQ processors (webhooks, rescans, expiry, invariants) land in
// later tasks; this proves the two-process model (architecture §16.1).
@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, RedisModule],
})
export class WorkerModule {}
