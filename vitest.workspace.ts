import swc from 'unplugin-swc';
import { defineWorkspace } from 'vitest/config';

// Two projects with different resolution roots:
//  - unit: fast, pure package tests (no datastores, esbuild transform).
//  - db:   integration/e2e tests rooted at apps/api so embedded-postgres / pg /
//          ioredis / the Prisma client resolve there. Uses SWC so NestJS
//          decorator metadata (emitDecoratorMetadata) is emitted. One real
//          embedded PostgreSQL 16 boots once for the project (global-setup.ts).
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      root: '.',
      include: ['packages/**/test/**/*.spec.ts'],
    },
  },
  {
    plugins: [
      swc.vite({
        jsc: {
          target: 'es2022',
          transform: { legacyDecorator: true, decoratorMetadata: true },
          keepClassNames: true,
        },
      }),
    ],
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
