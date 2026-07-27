/**
 * Server-authoritative reference SMS parser (architecture §8). Pure: no clock,
 * no I/O, no globals — `now` is injected. The Kotlin engine mirrors this exactly
 * and is asserted against the same fixtures (Task 13).
 */
import {
  normalizeAmount,
  normalizeBody,
  normalizeMsisdn,
  normalizeTimestamp,
  normalizeTrxId,
} from './normalize.js';
import { resolveProvider } from './provider-resolve.js';
import type { Direction, MessageTypeRule, ParseResult, ProviderRule } from './types.js';

export interface ParseInput {
  rules: readonly ProviderRule[];
  smsAddress: string;
  body: string;
  now: Date;
}

const FIELD_BY_PATTERN: Record<string, keyof ParseResult['fields']> = {
  amount: 'amount',
  transaction_id: 'transactionId',
  sender_msisdn: 'senderMsisdn',
  balance_after: 'balanceAfter',
  fee: 'fee',
  timestamp: 'timestamp',
};

function includesAll(body: string, needles: readonly string[]): boolean {
  return needles.every((n) => body.includes(n));
}
function includesAny(body: string, needles: readonly string[]): boolean {
  return needles.some((n) => body.includes(n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function extractValue(body: string, pattern: string, key: string): string | undefined {
  const re = new RegExp(pattern);
  const m = re.exec(body);
  if (m === null) return undefined;
  return m.groups?.[key] ?? m[1];
}

function normalizeField(
  key: string,
  raw: string,
  formats: readonly string[],
  now: Date,
): string | undefined {
  switch (key) {
    case 'amount':
    case 'balance_after':
    case 'fee':
      return normalizeAmount(raw) ?? undefined;
    case 'sender_msisdn':
      return normalizeMsisdn(raw) ?? undefined;
    case 'transaction_id':
      return normalizeTrxId(raw) ?? undefined;
    case 'timestamp': {
      const d = normalizeTimestamp(raw, formats, now);
      return d === null ? undefined : d.toISOString();
    }
    default:
      return undefined;
  }
}

function result(
  partial: Partial<ParseResult> & Pick<ParseResult, 'status' | 'provider'>,
): ParseResult {
  return {
    messageType: null,
    direction: null,
    fields: {},
    confidence: 0,
    ruleVersion: null,
    unmatchedPatterns: [],
    ...partial,
  };
}

function extract(
  rule: ProviderRule,
  mt: MessageTypeRule,
  provider: string,
  body: string,
  now: Date,
): ParseResult {
  const fields: ParseResult['fields'] = {};
  const unmatched: string[] = [];

  for (const [key, pattern] of Object.entries(mt.patterns)) {
    const raw = extractValue(body, pattern, key);
    if (raw === undefined) {
      unmatched.push(key);
      continue;
    }
    const value = normalizeField(key, raw, mt.timestamp_formats, now);
    const fieldName = FIELD_BY_PATTERN[key];
    if (value === undefined || fieldName === undefined) {
      unmatched.push(key);
      continue;
    }
    fields[fieldName] = value;
  }

  const missingRequired = mt.required.filter((k) => {
    const fieldName = FIELD_BY_PATTERN[k];
    return fieldName === undefined || fields[fieldName] === undefined;
  });

  const status: ParseResult['status'] = missingRequired.length > 0 ? 'PARTIAL' : 'PARSED';
  const optionalPatternCount = Object.keys(mt.patterns).length - mt.required.length;
  const unmatchedOptional = unmatched.filter((k) => !mt.required.includes(k)).length;
  const confidence =
    status === 'PARTIAL'
      ? 0.4
      : round2(Math.max(0.5, 1 - 0.15 * Math.min(unmatchedOptional, optionalPatternCount)));

  return result({
    status,
    provider,
    messageType: mt.type,
    direction: 'CREDIT',
    fields,
    confidence,
    ruleVersion: rule.version,
    unmatchedPatterns: unmatched,
  });
}

export function parse(input: ParseInput): ParseResult {
  const provider = resolveProvider(input.rules, input.smsAddress);
  const rule = input.rules.find((r) => r.provider === provider);
  if (rule === undefined) {
    return result({ status: 'UNPARSED', provider });
  }

  const body = normalizeBody(input.body);

  for (const mt of rule.message_types) {
    if (!includesAll(body, mt.must_contain)) continue;
    if (includesAny(body, mt.must_not_contain)) continue;

    const direction: Direction = mt.direction;
    if (direction !== 'CREDIT') {
      return result({
        status: 'IGNORED',
        provider,
        messageType: mt.type,
        direction,
        ruleVersion: rule.version,
        ignoredReason: direction === 'DEBIT' ? 'DEBIT_MESSAGE' : 'INFO_MESSAGE',
      });
    }
    return extract(rule, mt, provider, body, input.now);
  }

  return result({ status: 'UNPARSED', provider, ruleVersion: rule.version });
}
