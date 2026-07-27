import type { ViteUserConfig } from 'vitest/config';

type TestConfig = NonNullable<ViteUserConfig['test']>;

/**
 * Shared coverage policy (workplan/01 §4.2.3): global floor at 70%, with a
 * hard 95% gate on the money-critical modules. Consumed by the root vitest
 * config so every package is measured under the same policy.
 */
export const coverageConfig: NonNullable<TestConfig['coverage']> = {
  provider: 'v8',
  include: ['packages/*/src/**/*.ts'],
  exclude: ['**/index.ts', '**/dto/**', '**/*.d.ts', '**/types.ts'],
  reporter: ['text', 'html'],
  thresholds: {
    lines: 70,
    functions: 70,
    branches: 70,
    statements: 70,
    'packages/shared/src/money.ts': {
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95,
    },
    'packages/shared/src/hmac.ts': {
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95,
    },
  },
};
