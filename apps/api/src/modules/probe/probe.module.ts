import { Module } from '@nestjs/common';

import { ProbeController } from './probe.controller.js';

@Module({
  controllers: [ProbeController],
})
export class ProbeModule {}
