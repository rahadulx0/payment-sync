import type { ProviderRule } from './types.js';

/** Resolve a provider from the SMS originating address against each rule's allowlist. */
export function resolveProvider(rules: readonly ProviderRule[], smsAddress: string): string {
  const addr = smsAddress.trim().toLowerCase();
  for (const rule of rules) {
    if (rule.sender_addresses.some((a) => a.toLowerCase() === addr)) {
      return rule.provider;
    }
  }
  return 'UNKNOWN';
}
