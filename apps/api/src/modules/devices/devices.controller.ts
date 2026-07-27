import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@paysync/shared';
import type { Request, Response } from 'express';

import type { CompanyContext, DeviceContext } from '../../common/auth/contexts.js';
import { CurrentCompany, CurrentDevice, DeviceAuth, Public } from '../../common/auth/decorators.js';
import { RateLimit } from '../../common/ratelimit/rate-limit.decorator.js';

import { DeviceConfigService } from './device-config.service.js';
import { DeviceService } from './device.service.js';
import { DeviceEventsDto, DeviceRegisterDto, HeartbeatDto } from './dto.js';

function assertDevice(ctx: DeviceContext | undefined): DeviceContext {
  if (ctx === undefined) throw new AppError('UNAUTHENTICATED', 'No device context.');
  return ctx;
}
function assertCompany(ctx: CompanyContext | undefined): CompanyContext {
  if (ctx === undefined) throw new AppError('UNAUTHENTICATED', 'No company context.');
  return ctx;
}

@ApiTags('device')
@Controller('device')
export class DevicesController {
  constructor(
    private readonly device: DeviceService,
    private readonly config: DeviceConfigService,
  ) {}

  @Public()
  @RateLimit({ points: 5, windowSec: 3600, by: 'ip' })
  @Post('register')
  register(@Body() dto: DeviceRegisterDto, @Req() req: Request) {
    return this.device.enroll(dto, req.ip);
  }

  @DeviceAuth()
  @Post('heartbeat')
  heartbeat(@Body() dto: HeartbeatDto, @CurrentDevice() ctx: DeviceContext | undefined) {
    return this.device.heartbeat(assertDevice(ctx), dto);
  }

  @DeviceAuth()
  @Get('config')
  async getConfig(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const etag = `W/"${this.config.configVersion().toString()}"`;
    if (req.header('if-none-match') === etag) {
      res.status(304);
      return undefined;
    }
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return this.config.build();
  }

  @DeviceAuth()
  @Post('token/rotate')
  rotate(@CurrentDevice() ctx: DeviceContext | undefined) {
    return this.device.rotateToken(assertDevice(ctx));
  }

  @DeviceAuth()
  @Post('events')
  events(
    @Body() dto: DeviceEventsDto,
    @CurrentDevice() ctx: DeviceContext | undefined,
    @CurrentCompany() company: CompanyContext | undefined,
  ) {
    return this.device.recordEvents(assertCompany(company), assertDevice(ctx), dto);
  }
}
