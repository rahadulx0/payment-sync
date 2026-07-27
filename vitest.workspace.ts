import { defineWorkspace } from 'vitest/config';

// Two projects with different resolution roots:
//  - unit: fast, pure package tests (no datastores).
//  - db:   integration tests rooted at apps/api so embedded-postgres / pg / the
//          Prisma client resolve from apps/api/node_modules. One real embedded
//          PostgreSQL 16 boots once for the whole project (global-setup.ts).
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      root: '.',
      include: ['packages/**/test/**/*.spec.ts'],
    },
  },
  {
    test: {
      name: 'db',
      root: './apps/api',
      include: ['test/**/*.spec.ts'],
      globalSetup: ['./test/db/global-setup.ts'],
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
]);
