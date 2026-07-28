import { Module } from '@nestjs/common';

import { OpsController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

@Module({
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
