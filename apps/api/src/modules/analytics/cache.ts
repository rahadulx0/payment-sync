import { Injectable } from '@nestjs/common';

import { RedisService } from '../../common/redis/redis.service.js';

const TTL_SEC = 60;

/**
 * A 60-second read-through cache for analytics responses (Task 10 §4.6). Every
 * cached value already carries its own `as_of`, so a stale-within-TTL read is
 * self-describing.
 */
@Injectable()
export class AnalyticsCache {
  constructor(private readonly redis: RedisService) {}

  async wrap<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(`analytics:${key}`).catch(() => null);
    if (cached !== null) return JSON.parse(cached) as T;
    const value = await produce();
    await this.redis
      .set(`analytics:${key}`, JSON.stringify(value), 'EX', TTL_SEC)
      .catch(() => undefined);
    return value;
  }
}
