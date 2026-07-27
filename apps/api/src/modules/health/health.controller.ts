import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../../common/auth/decorators.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { ConfigService } from '../../config/config.service.js';

@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('healthz')
  healthz(): { status: string } {
    return { status: 'ok' };
  }

  @Public()
  @Get('readyz')
  async readyz(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; checks: { db: boolean; redis: boolean } }> {
    const checks = { db: false, redis: false };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = true;
    } catch {
      checks.db = false;
    }
    try {
      await this.redis.ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
    }
    const ready = checks.db && checks.redis;
    res.status(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', checks };
  }

  @Public()
  @Get('version')
  version(): { name: string; env: string } {
    return { name: 'payment-sync', env: this.config.env };
  }
}
