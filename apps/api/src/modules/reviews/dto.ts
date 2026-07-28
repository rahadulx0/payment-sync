import { IsOptional, IsString, Length } from 'class-validator';

export class ResolveReviewDto {
  /** Mandatory on every resolution — the audit trail's "why". */
  @IsString()
  @Length(3, 500)
  note!: string;

  // Link mode: verify the SMS against a specific order.
  @IsOptional()
  @IsString()
  link_sms_log_id?: string;

  @IsOptional()
  @IsString()
  link_payment_request_id?: string;

  // Dismiss mode: close the review without verifying.
  @IsOptional()
  @IsString()
  @Length(2, 80)
  dismiss_reason?: string;

  /** When dismissing: true if the SMS is not a payment at all (→ IGNORED, not re-matchable). */
  @IsOptional()
  not_a_payment?: boolean;
}
