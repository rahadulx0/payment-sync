import { coverageConfig } from '@paysync/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.spec.ts'],
    coverage: coverageConfig,
  },
});
