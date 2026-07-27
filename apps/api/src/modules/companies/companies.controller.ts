import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import type { AdminContext } from '../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../common/auth/decorators.js';

import { CompaniesService } from './companies.service.js';
import { CompanySettingsService } from './company-settings.service.js';
import { CompanyStatusDto, CreateCompanyDto, UpdateCompanyDto } from './dto.js';
import { OnboardingPacketService } from './onboarding-packet.service.js';

@ApiTags('admin-companies')
@AdminAuth()
@Controller('admin/companies')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly settings: CompanySettingsService,
    private readonly packet: OnboardingPacketService,
  ) {}

  private ctx(admin: AdminContext | undefined, req: Request) {
    return { adminId: admin?.adminId, ip: req.ip };
  }

  @Post()
  async create(
    @Body() dto: CreateCompanyDto,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    const { company, reveal } = await this.companies.create(dto, this.ctx(admin, req));
    return {
      company: {
        id: company.id,
        company_code: company.company_code,
        name: company.name,
        status: company.status,
      },
      credentials: reveal,
    };
  }

  @Get()
  list(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.companies.list({
      status,
      q,
      cursor,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.companies.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.companies.update(id, dto, this.ctx(admin, req));
  }

  @Post(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() dto: CompanyStatusDto,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.companies.setStatus(id, dto.status, dto.reason, this.ctx(admin, req));
  }

  @Get(':id/settings')
  getSettings(@Param('id') id: string) {
    return this.settings.get(id);
  }

  @Put(':id/settings')
  updateSettings(@Param('id') id: string, @Body() body: unknown) {
    return this.settings.update(id, body);
  }

  @Post(':id/onboarding-packet')
  onboardingPacket(@Param('id') id: string) {
    return this.packet.build(id);
  }
}
