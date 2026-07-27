import { Injectable } from '@nestjs/common';
import { AppError } from '@paysync/shared';
import { type CompanySettings, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service.js';

import { settingsUpdateSchema, stripUndefined } from './settings.schema.js';

@Injectable()
export class CompanySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId: string): Promise<CompanySettings> {
    const s = await this.prisma.companySettings.findUnique({ where: { company_id: companyId } });
    if (s === null) throw new AppError('ORDER_NOT_FOUND', 'Company settings not found.');
    return s;
  }

  /** Validate against documented bounds and persist. Never touches existing orders. */
  async update(companyId: string, patch: unknown): Promise<CompanySettings> {
    const parsed = settingsUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid settings.', {
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return this.prisma.companySettings.update({
      where: { company_id: companyId },
      data: stripUndefined(parsed.data) as Prisma.CompanySettingsUpdateInput,
    });
  }
}
