import { Module } from '@nestjs/common';

import { IngestionService } from './ingestion.service.js';
import { MATCHING_HOOK, NoopMatchingHook } from './matching.hook.js';
import { SmsController } from './sms.controller.js';

@Module({
  controllers: [SmsController],
  providers: [
    IngestionService,
    NoopMatchingHook,
    { provide: MATCHING_HOOK, useClass: NoopMatchingHook },
  ],
})
export class SmsModule {}
