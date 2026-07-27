import { Injectable } from '@nestjs/common';
import { AppError, type KeyType } from '@paysync/shared';
import type { ApiKey } from '@prisma/client';

import { CredentialService } from '../../common/auth/credential.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService } from '../admin/audit/audit.service.js';

const DEFAULT_SCOPES: Record<KeyType, string[]> = {
  SERVER: ['payments:write', 'payments:read'],
  DEVICE_ENROLL: ['device:enroll'],
};

export interface IssueKeyInput {
  keyType: KeyType;
  label: string;
  scopes?: string[] | undefined;
  expiresAt?: string | undefined;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    private readonly audit: AuditService,
  ) {}

  async issue(
    companyId: string,
    input: IssueKeyInput,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ) {
    const kind = input.keyType;
    const issued = this.credentials.issue(kind);
    const scopes = input.scopes ?? DEFAULT_SCOPES[kind];
    const key = await this.prisma.apiKey.create({
      data: {
        company_id: companyId,
        key_type: kind,
        prefix: issued.prefix,
        key_hash: await this.credentials.hash(issued.plaintext),
        label: input.label,
        scopes,
        expires_at: input.expiresAt !== undefined ? new Date(input.expiresAt) : null,
      },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'apikey.issue',
      entityType: 'api_key',
      entityId: key.id,
      after: { key_type: kind, prefix: issued.prefix, scopes },
      companyId,
      ip: ctx.ip,
    });
    return {
      id: key.id,
      key_type: kind,
      prefix: issued.prefix,
      scopes,
      plaintext: issued.plaintext,
      warning: 'Shown once.',
    };
  }

  async list(companyId: string): Promise<Omit<ApiKey, 'key_hash'>[]> {
    return this.prisma.apiKey.findMany({
      where: { company_id: companyId },
      omit: { key_hash: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async revoke(
    companyId: string,
    keyId: string,
    force: boolean,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, company_id: companyId } });
    if (key === null) throw new AppError('ORDER_NOT_FOUND', 'Key not found.');
    if (key.key_type === 'SERVER' && key.revoked_at === null && !force) {
      const activeServer = await this.prisma.apiKey.count({
        where: { company_id: companyId, key_type: 'SERVER', revoked_at: null },
      });
      if (activeServer <= 1) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Refusing to revoke the last active server key without force=true.',
        );
      }
    }
    await this.prisma.apiKey.update({ where: { id: keyId }, data: { revoked_at: new Date() } });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'apikey.revoke',
      entityType: 'api_key',
      entityId: keyId,
      companyId,
      ip: ctx.ip,
    });
    return { id: keyId, revoked: true };
  }

  async rotate(
    companyId: string,
    keyId: string,
    graceHours: number,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, company_id: companyId } });
    if (key === null) throw new AppError('ORDER_NOT_FOUND', 'Key not found.');
    const replacement = await this.issue(
      companyId,
      { keyType: key.key_type, label: `${key.label} (rotated)`, scopes: key.scopes },
      ctx,
    );
    const revokeAt = graceHours <= 0 ? new Date() : new Date(Date.now() + graceHours * 3_600_000);
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: graceHours <= 0 ? { revoked_at: new Date() } : { revoke_at: revokeAt },
    });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'apikey.rotate',
      entityType: 'api_key',
      entityId: keyId,
      after: { replaced_by: replacement.id, grace_hours: graceHours },
      companyId,
      ip: ctx.ip,
    });
    return { rotated_from: keyId, new_key: replacement };
  }
}
