import { Injectable } from '@nestjs/common';
import { AppError, type CompanyStatus, randomToken } from '@paysync/shared';
import type { Company, Prisma } from '@prisma/client';

import { CredentialService } from '../../common/auth/credential.service.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CryptoService } from '../../config/crypto.service.js';
import { AuditService } from '../admin/audit/audit.service.js';

import { settingsUpdateSchema, stripUndefined } from './settings.schema.js';

export interface CredentialReveal {
  company_code: string;
  server_key: string;
  device_enroll_key: string;
  webhook_secret: string;
  warning: string;
}

export interface CreateCompanyInput {
  name: string;
  company_code?: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
  default_callback_url?: string;
  settings?: unknown;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: CreateCompanyInput,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ): Promise<{ company: Company; reveal: CredentialReveal }> {
    const code = input.company_code ?? `COMP${randomToken(8).toUpperCase().slice(0, 8)}`;
    const serverKey = this.credentials.issue('SERVER');
    const enrollKey = this.credentials.issue('DEVICE_ENROLL');
    const webhookSecret = `whsec_${randomToken(24)}`;

    const settings = this.parseSettings(input.settings);
    const [serverHash, enrollHash] = await Promise.all([
      this.credentials.hash(serverKey.plaintext),
      this.credentials.hash(enrollKey.plaintext),
    ]);

    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          company_code: code,
          name: input.name,
          contact_email: input.contact_email ?? null,
          contact_phone: input.contact_phone ?? null,
          notes: input.notes ?? null,
          default_callback_url: input.default_callback_url ?? null,
          webhook_secret_enc: this.crypto.encrypt(webhookSecret),
          settings: { create: settings },
        },
      });
      await tx.apiKey.create({
        data: {
          company_id: c.id,
          key_type: 'SERVER',
          prefix: serverKey.prefix,
          key_hash: serverHash,
          label: 'main server key',
          scopes: ['payments:write', 'payments:read'],
        },
      });
      await tx.apiKey.create({
        data: {
          company_id: c.id,
          key_type: 'DEVICE_ENROLL',
          prefix: enrollKey.prefix,
          key_hash: enrollHash,
          label: 'device enrolment key',
          scopes: ['device:enroll'],
        },
      });
      return c;
    });

    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'company.create',
      entityType: 'company',
      entityId: company.id,
      after: company,
      companyId: company.id,
      ip: ctx.ip,
    });

    return {
      company,
      reveal: {
        company_code: code,
        server_key: serverKey.plaintext,
        device_enroll_key: enrollKey.plaintext,
        webhook_secret: webhookSecret,
        warning: 'Shown once. Store securely — these cannot be retrieved again.',
      },
    };
  }

  private parseSettings(raw: unknown): Prisma.CompanySettingsCreateWithoutCompanyInput {
    if (raw === undefined) return {};
    const parsed = settingsUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid settings.', {
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return stripUndefined(parsed.data) as Prisma.CompanySettingsCreateWithoutCompanyInput;
  }

  async list(params: {
    status?: string | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) {
    const take = Math.min(params.limit ?? 50, 100);
    const rows = await this.prisma.company.findMany({
      where: {
        ...(params.status !== undefined ? { status: params.status as CompanyStatus } : {}),
        ...(params.q !== undefined
          ? {
              OR: [
                { name: { contains: params.q, mode: 'insensitive' } },
                { company_code: { contains: params.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { created_at: 'desc' },
      take: take + 1,
      ...(params.cursor !== undefined ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, take);
    return { items, next_cursor: rows.length > take ? (items.at(-1)?.id ?? null) : null };
  }

  async get(id: string): Promise<Company & { settings: unknown }> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: { settings: true },
    });
    if (company === null) throw new AppError('ORDER_NOT_FOUND', 'Company not found.');
    return company;
  }

  async update(
    id: string,
    data: Prisma.CompanyUpdateInput,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ): Promise<Company> {
    const before = await this.get(id);
    const company = await this.prisma.company.update({ where: { id }, data });
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: 'company.update',
      entityType: 'company',
      entityId: id,
      before,
      after: company,
      companyId: id,
      ip: ctx.ip,
    });
    return company;
  }

  async setStatus(
    id: string,
    status: CompanyStatus,
    reason: string,
    ctx: { adminId?: string | undefined; ip?: string | undefined },
  ): Promise<Company> {
    const company = await this.prisma.company.update({
      where: { id },
      data: {
        status,
        ...(status === 'DISABLED' ? { disabled_at: new Date() } : {}),
      },
    });
    // DISABLED revokes device tokens so a decompiled app cannot keep uploading.
    if (status === 'DISABLED') {
      await this.prisma.device.updateMany({
        where: { company_id: id },
        data: { status: 'RETIRED' },
      });
    }
    await this.audit.record({
      actorType: 'ADMIN',
      actorId: ctx.adminId,
      action: `company.${status.toLowerCase()}`,
      entityType: 'company',
      entityId: id,
      after: { status, reason },
      companyId: id,
      ip: ctx.ip,
    });
    return company;
  }
}
