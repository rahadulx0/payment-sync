import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@paysync/shared';

import type { CompanyContext, DeviceContext } from '../../common/auth/contexts.js';
import { CurrentCompany, CurrentDevice, DeviceAuth } from '../../common/auth/decorators.js';
import { RateLimit } from '../../common/ratelimit/rate-limit.decorator.js';
import { SmsUploadDto } from '../devices/dto.js';

import { IngestionService } from './ingestion.service.js';

@ApiTags('device-sms')
@Controller('sms')
export class SmsController {
  constructor(private readonly ingestion: IngestionService) {}

  @DeviceAuth()
  @RateLimit({ points: 120, windowSec: 60, by: 'device' })
  @HttpCode(202)
  @Post('upload')
  upload(
    @Body() dto: SmsUploadDto,
    @CurrentCompany() company: CompanyContext | undefined,
    @CurrentDevice() device: DeviceContext | undefined,
  ) {
    if (company === undefined || device === undefined) {
      throw new AppError('UNAUTHENTICATED', 'No device context.');
    }
    return this.ingestion.ingest(company.companyId, device.deviceId, dto);
  }
}
