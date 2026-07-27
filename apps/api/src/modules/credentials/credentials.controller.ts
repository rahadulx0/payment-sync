import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import type { AdminContext } from '../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin } from '../../common/auth/decorators.js';

import { CredentialsService } from './credentials.service.js';
import { IssueKeyDto } from './dto.js';
import { WebhookSecretService } from './webhook-secret.service.js';

@ApiTags('admin-credentials')
@AdminAuth()
@Controller('admin/companies/:id')
export class CredentialsController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly webhookSecret: WebhookSecretService,
  ) {}

  private ctx(admin: AdminContext | undefined, req: Request) {
    return { adminId: admin?.adminId, ip: req.ip };
  }

  @Post('keys')
  issue(
    @Param('id') id: string,
    @Body() dto: IssueKeyDto,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.credentials.issue(
      id,
      { keyType: dto.key_type, label: dto.label, scopes: dto.scopes, expiresAt: dto.expires_at },
      this.ctx(admin, req),
    );
  }

  @Get('keys')
  list(@Param('id') id: string) {
    return this.credentials.list(id);
  }

  @Delete('keys/:keyId')
  revoke(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Query('force') force: string | undefined,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.credentials.revoke(id, keyId, force === 'true', this.ctx(admin, req));
  }

  @Post('keys/:keyId/rotate')
  rotate(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body('grace_hours') graceHours: number | undefined,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.credentials.rotate(id, keyId, graceHours ?? 24, this.ctx(admin, req));
  }

  @Post('webhook-secret/rotate')
  rotateWebhookSecret(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminContext | undefined,
    @Req() req: Request,
  ) {
    return this.webhookSecret.rotate(id, this.ctx(admin, req));
  }
}
