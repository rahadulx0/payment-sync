import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ConfigService } from '../../config/config.service.js';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService) {
    // maxRetriesPerRequest: null keeps this connection reusable by BullMQ;
    // lazyConnect defers the socket until the first command (also lets tools
    // that only inspect the DI graph, e.g. OpenAPI generation, avoid connecting).
    super(config.redis.url, { maxRetriesPerRequest: null, lazyConnect: true });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
