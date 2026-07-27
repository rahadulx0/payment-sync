import { Injectable } from '@nestjs/common';
import type { ActorType } from '@paysync/shared';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service.js';

import { redact } from './redact.js';

export interface AuditInput {
  actorType: ActorType;
  actorId?: string | undefined;
  action: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  before?: unknown;
  after?: unknown;
  companyId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actor_type: input.actorType,
        actor_id: input.actorId ?? null,
        action: input.action,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        company_id: input.companyId ?? null,
        ip: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        ...(input.before !== undefined
          ? { before: redact(input.before) as Prisma.InputJsonValue }
          : {}),
        ...(input.after !== undefined
          ? { after: redact(input.after) as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
}
