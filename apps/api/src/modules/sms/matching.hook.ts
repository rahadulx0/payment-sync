import { Injectable } from '@nestjs/common';
import type { MatchStatus } from '@paysync/shared';

export interface MatchOutcome {
  match_status: MatchStatus;
}

/**
 * Insertion point for the matching engine (Task 08). Returns a real value (not a
 * throw) so ingestion tests written now stay valid — Task 08 swaps the impl.
 */
export interface MatchingHook {
  onSmsIngested(smsLogId: string): Promise<MatchOutcome>;
}

export const MATCHING_HOOK = 'MATCHING_HOOK';

@Injectable()
export class NoopMatchingHook implements MatchingHook {
  onSmsIngested(): Promise<MatchOutcome> {
    return Promise.resolve({ match_status: 'UNMATCHED' });
  }
}
