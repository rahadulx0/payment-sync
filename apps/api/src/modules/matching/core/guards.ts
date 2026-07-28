import type { GuardName, MatchInput } from './types.js';

/**
 * The hard guards, in order (architecture §9.2 step 0). Each returns a named
 * rejection so the decision trace explains itself. A `null` return means the
 * SMS is eligible to enter the matching passes.
 *
 * Note on company status: only DISABLED blocks matching — a SUSPENDED company
 * still matches (its API is frozen, but money that already arrived must still
 * be attributed). The future-timestamp check is NOT here: it produces a REVIEW,
 * not a silent rejection, so it lives in `decide`.
 */
export function runGuards(input: MatchInput): GuardName | null {
  const { sms, settings } = input;

  if (sms.companyStatus === 'DISABLED') return 'COMPANY_NOT_ACTIVE';
  if (sms.deviceStatus !== null && sms.deviceStatus !== 'ACTIVE') return 'DEVICE_NOT_ACTIVE';
  if (sms.direction !== 'CREDIT') return 'DIRECTION_NOT_CREDIT';
  if (!settings.allowedProviders.includes(sms.provider)) return 'PROVIDER_NOT_ALLOWED';
  if (sms.parseStatus === 'UNPARSED' || sms.parseStatus === 'IGNORED') {
    return 'PARSE_STATUS_UNUSABLE';
  }
  if (!sms.amount?.isPositive()) return 'AMOUNT_MISSING_OR_ZERO';

  return null;
}
