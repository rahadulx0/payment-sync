import { enumValues, PRISMA_MIRRORED_ENUMS } from '@paysync/shared';
import * as PrismaPkg from '@prisma/client';
import { describe, expect, it } from 'vitest';

const prismaRuntime = PrismaPkg as unknown as Record<string, Record<string, string>>;
const shared = PRISMA_MIRRORED_ENUMS as unknown as Record<string, Record<string, string>>;

describe('enum parity (shared ↔ Prisma)', () => {
  it.each(Object.keys(PRISMA_MIRRORED_ENUMS))('%s has identical values on both sides', (name) => {
    const prismaEnum = prismaRuntime[name];
    expect(prismaEnum, `Prisma client is missing enum ${name}`).toBeDefined();
    expect(enumValues(prismaEnum ?? {})).toEqual(enumValues(shared[name] ?? {}));
  });
});
