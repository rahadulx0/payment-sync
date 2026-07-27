import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { ConfigService } from '../../config/config.service.js';

import { tenantScopedClient, type TenantScopedClient } from './tenant-scope.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ datasourceUrl: config.db.url });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** A tenant-isolated client. Use this everywhere a request has a company context. */
  forCompany(companyId: string): TenantScopedClient {
    return tenantScopedClient(this, companyId);
  }

  /** Unscoped client. Restricted by lint to modules/admin/** (architecture §13.1 T5). */
  unsafeGlobal(): PrismaClient {
    return this;
  }
}
