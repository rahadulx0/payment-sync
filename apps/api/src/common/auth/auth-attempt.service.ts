import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

export interface AuthAttemptInput {
  kind: 'ADMIN_LOGIN' | 'SERVER_KEY' | 'DEVICE_TOKEN';
  subject?: string | undefined;
  outcome: 'SUCCESS' | 'FAILURE';
  reason?: string | undefined;
  companyId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuthAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Record every credential presentation (satisfies "log all authentication attempts"). */
  async record(input: AuthAttemptInput): Promise<void> {
    await this.prisma.authAttempt.create({
      data: {
        kind: input.kind,
        subject: input.subject ?? null,
        outcome: input.outcome,
        reason: input.reason ?? null,
        company_id: input.companyId ?? null,
        ip: input.ip ?? null,
        user_agent: input.userAgent ?? null,
      },
    });
    if (input.outcome === 'FAILURE' && input.subject !== undefined) {
      const key = `authfail:${input.kind}:${input.subject}`;
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.pexpire(key, 15 * 60 * 1000);
    }
  }

  async failureCount(kind: string, subject: string): Promise<number> {
    const v = await this.redis.get(`authfail:${kind}:${subject}`);
    return v === null ? 0 : Number(v);
  }
}
