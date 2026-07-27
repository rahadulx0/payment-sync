import { Module } from '@nestjs/common';

import { DevicesAdminController } from './devices-admin.controller.js';
import { DevicesAdminService } from './devices-admin.service.js';

@Module({
  controllers: [DevicesAdminController],
  providers: [DevicesAdminService],
  exports: [DevicesAdminService],
})
export class DevicesAdminModule {}
