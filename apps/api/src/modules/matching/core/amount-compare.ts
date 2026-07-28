import type { Money } from '@paysync/shared';

export type AmountRelation = 'WITHIN' | 'OVERPAID' | 'UNDERPAID';

export interface AmountComparison {
  relation: AmountRelation;
  /** received − expected, signed, in `Money` (paisa). */
  delta: Money;
}

/**
 * Compare a received amount against an expected amount, entirely in integer
 * paisa via `Money` (CLAUDE.md rule 1 — never float math on money). The
 * tolerance boundary is **inclusive**: `|received − expected| === tolerance`
 * is WITHIN, tested at §6.1.
 */
export function compareAmount(
  expected: Money,
  received: Money,
  tolerance: Money,
): AmountComparison {
  const delta = received.subtract(expected);
  if (received.isWithinTolerance(expected, tolerance)) {
    return { relation: 'WITHIN', delta };
  }
  return { relation: received.compare(expected) > 0 ? 'OVERPAID' : 'UNDERPAID', delta };
}
