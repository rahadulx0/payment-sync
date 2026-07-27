import { coverageConfig } from '@paysync/config/vitest';
import { defineConfig } from 'vitest/config';

// Root-level options (coverage) that apply across the workspace projects
// defined in vitest.workspace.ts.
export default defineConfig({
  test: {
    coverage: coverageConfig,
  },
});
