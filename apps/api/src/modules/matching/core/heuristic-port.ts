import type { MatchDecision, MatchInput } from './types.js';

/**
 * The second-pass extension point. Task 10 injects a real amount+window+sender
 * strategy here; this task ships `NoopHeuristic`, which never matches. The
 * pure-core tests must pass with both implementations, so the exact path is
 * provably correct on its own (architecture §9, Task 08 risk note).
 */
export interface HeuristicPass {
  run(input: MatchInput): MatchDecision;
}

export class NoopHeuristic implements HeuristicPass {
  run(): MatchDecision {
    return { result: 'UNMATCHED' };
  }
}
