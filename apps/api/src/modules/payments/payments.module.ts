import { Module } from '@nestjs/common';

import { ExpiryService } from './expiry.service.js';
import { PAYMENT_MATCHING_HOOK, NoopPaymentMatchingHook } from './matching.hook.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    ExpiryService,
    NoopPaymentMatchingHook,
    { provide: PAYMENT_MATCHING_HOOK, useClass: NoopPaymentMatchingHook },
  ],
  exports: [ExpiryService, PaymentsService],
})
export class PaymentsModule {}
