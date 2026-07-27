import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';

import type { AdminContext } from '../../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../../common/auth/decorators.js';

import { DevicesAdminService } from './devices-admin.service.js';

class PatchDeviceDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  device_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  wallet_msisdn?: string;
}

@ApiTags('admin-devices')
@AdminAuth()
@Controller('admin/devices')
export class DevicesAdminController {
  constructor(private readonly devices: DevicesAdminService) {}

  private ctx(admin: AdminContext | undefined, req: Request) {
    return { adminId: admin?.adminId, ip: req.ip };
  }

  @Get()
  list(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('online') online?: string,
  ) {
    return this.devices.list({ companyId, status, online });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.devices.get(id);
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body() dto: PatchDeviceDto,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.devices.patch(id, dto, this.ctx(admin, req));
  }

  @Post(':id/block')
  block(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.devices.setStatus(id, 'BLOCKED', this.ctx(admin, req));
  }

  @Post(':id/unblock')
  unblock(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.devices.setStatus(id, 'ACTIVE', this.ctx(admin, req));
  }

  @Post(':id/retire')
  retire(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.devices.setStatus(id, 'RETIRED', this.ctx(admin, req));
  }

  @Post(':id/force-sync')
  forceSync(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.devices.forceSync(id, this.ctx(admin, req));
  }

  @Post(':id/rotate-token')
  rotateToken(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.devices.rotateToken(id, this.ctx(admin, req));
  }
}
