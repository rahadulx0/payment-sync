import { Module } from '@nestjs/common';

import { WebhookTestController } from './webhook-test.controller.js';

@Module({
  controllers: [WebhookTestController],
})
export class WebhooksModule {}
