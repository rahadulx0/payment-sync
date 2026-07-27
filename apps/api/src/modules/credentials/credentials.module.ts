import { Module } from '@nestjs/common';

import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import { WebhookSecretService } from './webhook-secret.service.js';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, WebhookSecretService],
  exports: [CredentialsService, WebhookSecretService],
})
export class CredentialsModule {}
