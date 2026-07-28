import { Injectable } from '@nestjs/common';

import type { PaymentMatchingHook, RegisterOutcome } from '../payments/matching.hook.js';
import type { MatchOutcome, MatchingHook } from '../sms/matching.hook.js';

import { MatchingService } from './matching.service.js';

/** Real ingest-time matching (replaces Task 06's NoopMatchingHook). */
@Injectable()
export class RealMatchingHook implements MatchingHook {
  constructor(private readonly matching: MatchingService) {}

  async onSmsIngested(smsLogId: string): Promise<MatchOutcome> {
    const res = await this.matching.matchBySms(smsLogId, 'SMS_UPLOAD');
    return { match_status: res.matchStatus };
  }
}

/** Real register/correction reverse matching (replaces Task 07's Noop). */
@Injectable()
export class RealPaymentMatchingHook implements PaymentMatchingHook {
  constructor(private readonly matching: MatchingService) {}

  onOrderRegistered(paymentRequestId: string): Promise<RegisterOutcome> {
    return this.reverse(paymentRequestId, 'ORDER_REGISTER');
  }

  onTrxIdCorrected(paymentRequestId: string): Promise<RegisterOutcome> {
    return this.reverse(paymentRequestId, 'ADMIN');
  }

  private async reverse(
    paymentRequestId: string,
    trigger: 'ORDER_REGISTER' | 'ADMIN',
  ): Promise<RegisterOutcome> {
    const res = await this.matching.reverseMatchOrder(paymentRequestId, trigger);
    if (!res?.verified) return { status: 'PENDING' };
    return { status: 'VERIFIED' };
  }
}
