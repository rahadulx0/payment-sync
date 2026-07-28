import { exactPass } from './exact-pass.js';
import { runGuards } from './guards.js';
import { type HeuristicPass, NoopHeuristic } from './heuristic-port.js';
import type { MatchDecision, MatchInput } from './types.js';

const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * The pure decision core (architecture §9.2). No I/O, no clock (`now` is an
 * input), no Prisma — inputs in, a fully-explained decision out. This is the
 * only place matching logic lives, and the exhaustive/property tests point here.
 *
 * Order: hard guards → future-timestamp review → exact pass → heuristic port.
 */
export function decide(
  input: MatchInput,
  heuristic: HeuristicPass = new NoopHeuristic(),
): MatchDecision {
  const guard = runGuards(input);
  if (guard !== null) return { result: 'GUARD_REJECTED', guard };

  // A credit dated meaningfully in the future is suspicious, not droppable.
  if (
    input.sms.smsAt !== null &&
    input.sms.smsAt.getTime() > input.now.getTime() + FUTURE_SKEW_MS
  ) {
    return { result: 'REVIEW', reason: 'SUSPICIOUS_SMS', candidates: [] };
  }

  const exact = exactPass(input);
  if (exact !== null) return exact;

  return heuristic.run(input);
}
