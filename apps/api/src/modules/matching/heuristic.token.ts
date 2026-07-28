import type { HeuristicPass } from './core/heuristic-port.js';

/** DI token for the injectable second-pass strategy (Noop here, real in Task 10). */
export const HEURISTIC_PASS = 'HEURISTIC_PASS';
export type HeuristicPassProvider = HeuristicPass;
