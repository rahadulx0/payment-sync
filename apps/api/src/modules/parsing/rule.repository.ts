import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ProviderRule } from '@paysync/parsers';
import type { Redis } from 'ioredis';

import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RedisService } from '../../common/redis/redis.service.js';

const CHANNEL = 'paysync:parser-config';

/**
 * In-memory cache of the active parser rules, refreshed on change and kept in
 * sync across processes (API + worker) via Redis pub/sub (architecture §8.1).
 */
@Injectable()
export class RuleRepository implements OnModuleInit, OnModuleDestroy {
  private rules: ProviderRule[] = [];
  private configVersion = 0;
  private subscriber: Redis | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', () => {
      void this.refresh();
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) await this.subscriber.quit();
  }

  async refresh(): Promise<void> {
    const rows = await this.prisma.parserRule.findMany({ where: { is_active: true } });
    this.rules = rows.map((r) => ProviderRule.parse(r.rule));
    this.configVersion = rows.reduce((sum, r) => sum + r.version, 0);
  }

  getRules(): ProviderRule[] {
    return this.rules;
  }

  getConfigVersion(): number {
    return this.configVersion;
  }

  /** Refresh locally and tell the other processes to refresh too. */
  async invalidate(): Promise<void> {
    await this.refresh();
    await this.redis.publish(CHANNEL, 'bump');
  }
}
