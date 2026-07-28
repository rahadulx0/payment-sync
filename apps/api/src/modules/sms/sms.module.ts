import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';

import { IngestionService } from './ingestion.service.js';
import { SmsController } from './sms.controller.js';

// MATCHING_HOOK is provided by MatchingModule (Task 08); the Task-06 no-op is
// retained in matching.hook.ts only for the ingestion unit tests.
@Module({
  imports: [MatchingModule],
  controllers: [SmsController],
  providers: [IngestionService],
})
export class SmsModule {}
