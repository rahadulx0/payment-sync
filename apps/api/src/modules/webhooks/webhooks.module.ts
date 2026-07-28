import { Module } from '@nestjs/common';

import { WebhookSweeperProcessor } from '../../workers/webhook-sweeper.processor.js';

import { WebhooksAdminController } from './admin/webhooks-admin.controller.js';
import { DeliveryService } from './delivery/delivery.service.js';
import { WebhookEventService } from './event.service.js';
import { SignerService } from './signing/signer.service.js';
import { WebhookTestController } from './webhook-test.controller.js';

/**
 * Webhook subsystem (Task 09): signing, event creation (frozen payload_raw),
 * delivery with retry/breaker, the orphan sweeper, the synchronous test.ping,
 * and admin retry/replay/health. `WebhookEventService` is exported so the
 * payments (expiry) and Task-10 review paths can create events in their own tx.
 */
@Module({
  controllers: [WebhookTestController, WebhooksAdminController],
  providers: [SignerService, WebhookEventService, DeliveryService, WebhookSweeperProcessor],
  exports: [WebhookEventService, DeliveryService, SignerService, WebhookSweeperProcessor],
})
export class WebhooksModule {}
