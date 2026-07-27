/**
 * SMS parser rule format (architecture §8.2) as a Zod schema. Rules are DATA,
 * served to devices via /device/config and used by the server's authoritative
 * parser. The full reference parser, normalizers, and fixtures land in Task 05;
 * this file establishes the shared shape and types the rest of the code targets.
 */

import { z } from 'zod';

export const Direction = z.enum(['CREDIT', 'DEBIT', 'INFO']);
export type Direction = z.infer<typeof Direction>;

export const MessageTypeRule = z.object({
  type: z.string().min(1),
  direction: Direction,
  must_contain: z.array(z.string()).default([]),
  must_not_contain: z.array(z.string()).default([]),
  patterns: z.record(z.string(), z.string()),
  timestamp_formats: z.array(z.string()).default([]),
  required: z.array(z.string()).default([]),
});
export type MessageTypeRule = z.infer<typeof MessageTypeRule>;

export const ProviderRule = z.object({
  provider: z.string().min(1),
  version: z.number().int().nonnegative(),
  sender_addresses: z.array(z.string().min(1)).min(1),
  message_types: z.array(MessageTypeRule).min(1),
});
export type ProviderRule = z.infer<typeof ProviderRule>;

export type ParseResultStatus = 'PARSED' | 'PARTIAL' | 'UNPARSED' | 'IGNORED';

export interface ParseResult {
  status: ParseResultStatus;
  provider: string;
  messageType: string | null;
  direction: Direction | null;
  fields: {
    amount?: string;
    transactionId?: string;
    senderMsisdn?: string;
    balanceAfter?: string;
    fee?: string;
    timestamp?: string;
  };
  confidence: number;
  ruleVersion: number | null;
  ignoredReason?: string;
  unmatchedPatterns: string[];
}
