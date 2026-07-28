import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';

import { ExpiryService } from './expiry.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

// PAYMENT_MATCHING_HOOK is provided by MatchingModule (Task 08); the Task-07
// no-op remains in matching.hook.ts only for that task's unit expectations.
@Module({
  imports: [MatchingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, ExpiryService],
  exports: [ExpiryService, PaymentsService],
})
export class PaymentsModule {}
