import path from 'node:path';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Money must never be parsed with float math (CLAUDE.md rule 1).
const amountBans = [
  {
    selector: "CallExpression[callee.name='parseFloat'] Identifier[name=/[Aa]mount/]",
    message: 'Do not parseFloat() an amount. Route money through packages/shared Money.',
  },
  {
    selector: "CallExpression[callee.name='Number'] Identifier[name=/[Aa]mount/]",
    message: 'Do not Number() an amount. Route money through packages/shared Money.',
  },
];

// Parsers must be pure functions of their inputs (CLAUDE.md rule 10, ADR-5).
const parserPurityBans = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: 'packages/parsers must be pure: no Date.now() (inject `now`).',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: 'packages/parsers must be pure: no new Date() (inject `now`).',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'packages/parsers must be pure: no Math.random().',
  },
];

/** Shared flat ESLint config for the whole workspace. */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.generated.ts',
      '**/.next/**',
      'apps/android/**',
      // The admin app has its own Next/React toolchain and is typechecked via its
      // own tsconfig (pnpm --filter @paysync/admin typecheck); the backend-tuned
      // flat config here is not the right linter for it.
      'apps/admin/**',
      // k6 load scripts run in the k6 runtime (its own globals), not Node.
      'test/load/**',
      // Hand-declared types for a docs reference snippet; not part of any tsconfig project.
      'docs/webhook-verification/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repoRoot,
      },
      globals: { ...globals.node },
    },
    plugins: { 'import-x': importX },
    rules: {
      'import-x/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        },
      ],
      'no-restricted-syntax': ['error', ...amountBans],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Read config via the validated config module, not process.env (apps/*/src/config only).',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Parser SOURCE gets the amount bans plus purity bans (tests may inject `now` via new Date).
    files: ['packages/parsers/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...amountBans, ...parserPurityBans],
    },
  },
  {
    // process.env is legitimate inside config modules and tooling.
    files: [
      'apps/*/src/config/**/*.ts',
      'apps/*/src/openapi.ts',
      'apps/*/prisma/**/*.ts',
      '**/scripts/**',
      '**/test/**',
      'packages/config/**',
      '**/*.config.{js,ts,mjs,cjs}',
      '**/vitest.*.ts',
    ],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  {
    // NestJS modules are intentionally empty decorated classes.
    files: ['apps/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    // Tests exercise HTTP responses (supertest bodies are `any`) — the unsafe-any
    // rules are impractical here and add no safety to assertions.
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Plain JS tooling files: no type-aware linting.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
