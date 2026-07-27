import { Injectable } from '@nestjs/common';

export interface RegisterOutcome {
  status: 'PENDING' | 'VERIFIED';
  verified_at?: string;
  transaction_id?: string;
}

/**
 * Reverse-match hooks (Task 08 wires these). Return a real value so Task 07
 * tests stay valid — register can already model a synchronous VERIFIED.
 */
export interface PaymentMatchingHook {
  onOrderRegistered(paymentRequestId: string): Promise<RegisterOutcome>;
  onTrxIdCorrected(paymentRequestId: string): Promise<RegisterOutcome>;
}

export const PAYMENT_MATCHING_HOOK = 'PAYMENT_MATCHING_HOOK';

@Injectable()
export class NoopPaymentMatchingHook implements PaymentMatchingHook {
  onOrderRegistered(): Promise<RegisterOutcome> {
    return Promise.resolve({ status: 'PENDING' });
  }
  onTrxIdCorrected(): Promise<RegisterOutcome> {
    return Promise.resolve({ status: 'PENDING' });
  }
}
