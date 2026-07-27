import { describe, expect, it } from 'vitest';

import { enumValues, PRISMA_MIRRORED_ENUMS } from '../src/index.js';

// The full shared-vs-Prisma parity assertion runs in @paysync/api (where the
// generated Prisma client is available): apps/api/test/schema/enum-parity.spec.ts.
// Here we assert the shared side is well-formed and free of DB-illegal values.
describe('shared enums', () => {
  it('every Prisma-mirrored enum has values and none contain a dot', () => {
    for (const [name, e] of Object.entries(PRISMA_MIRRORED_ENUMS)) {
      const values = enumValues(e);
      expect(values.length, name).toBeGreaterThan(0);
      for (const v of values) expect(v, `${name}.${v}`).not.toContain('.');
    }
  });
});
