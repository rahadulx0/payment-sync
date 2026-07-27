import { Module } from '@nestjs/common';

import { DeviceConfigService } from './device-config.service.js';
import { DeviceService } from './device.service.js';
import { DevicesController } from './devices.controller.js';

@Module({
  controllers: [DevicesController],
  providers: [DeviceService, DeviceConfigService],
  exports: [DeviceConfigService],
})
export class DevicesModule {}
