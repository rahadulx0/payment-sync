import { Controller, ForbiddenException, Get, Header, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { ConfigService } from '../../config/config.service.js';
import { Public } from '../auth/decorators.js';

import { MetricsService } from './metrics.service.js';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  async scrape(@Req() req: Request): Promise<string> {
    const token = this.config.metricsToken;
    if (token.length > 0) {
      const header = req.header('authorization');
      if (header !== `Bearer ${token}`) {
        throw new ForbiddenException('metrics token required');
      }
    }
    return this.metrics.render();
  }
}
