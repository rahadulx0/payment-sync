import { Module } from '@nestjs/common';

import { InvariantsProcessor } from '../../workers/invariants.processor.js';
import { RescanUnmatchedProcessor } from '../../workers/rescan-unmatched.processor.js';
import { PAYMENT_MATCHING_HOOK } from '../payments/matching.hook.js';
import { MATCHING_HOOK } from '../sms/matching.hook.js';

import { InvariantsController } from './admin/invariants.controller.js';
import { VoidVerificationController } from './admin/void-verification.controller.js';
import { CandidateRepository } from './candidate.repository.js';
import { HeuristicStrategy } from './heuristic/heuristic.strategy.js';
import { HEURISTIC_PASS } from './heuristic.token.js';
import { InvariantsService } from './invariants.service.js';
import { RealMatchingHook, RealPaymentMatchingHook } from './matching.hooks.js';
import { MatchingService } from './matching.service.js';
import { RescanService } from './rescan.service.js';
import { TraceService } from './trace.service.js';

/**
 * The matching engine (Task 08). Owns the real MATCHING_HOOK and
 * PAYMENT_MATCHING_HOOK bindings; SmsModule and PaymentsModule import this
 * module to pick them up in place of their Task-06/07 no-ops. The heuristic
 * second pass is bound to NoopHeuristic here and replaced in Task 10.
 */
@Module({
  controllers: [VoidVerificationController, InvariantsController],
  providers: [
    MatchingService,
    CandidateRepository,
    TraceService,
    RescanService,
    InvariantsService,
    InvariantsProcessor,
    RescanUnmatchedProcessor,
    RealMatchingHook,
    RealPaymentMatchingHook,
    { provide: HEURISTIC_PASS, useClass: HeuristicStrategy },
    { provide: MATCHING_HOOK, useExisting: RealMatchingHook },
    { provide: PAYMENT_MATCHING_HOOK, useExisting: RealPaymentMatchingHook },
  ],
  exports: [
    MATCHING_HOOK,
    PAYMENT_MATCHING_HOOK,
    MatchingService,
    RescanService,
    InvariantsService,
    InvariantsProcessor,
    RescanUnmatchedProcessor,
  ],
})
export class MatchingModule {}
