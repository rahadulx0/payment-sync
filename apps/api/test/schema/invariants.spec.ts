import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDb,
  dropTestDb,
  makeCompany,
  makeSmsLog,
  truncateAll,
  type TestDb,
} from '../db/harness.js';

let db: TestDb;
let statements: string[];

beforeAll(async () => {
  db = await createTestDb();
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(here, '..', '..', '..', '..', 'sql', 'invariants.sql'), 'utf8');
  statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
});
afterAll(async () => {
  await dropTestDb(db);
});
beforeEach(async () => {
  await truncateAll(db.prisma);
});

async function runInvariant(index: number): Promise<unknown[]> {
  const stmt = statements[index];
  if (stmt === undefined) throw new Error(`no invariant query at index ${index.toString()}`);
  return db.prisma.$queryRawUnsafe<unknown[]>(stmt);
}

describe('sql/invariants.sql', () => {
  it('parses into five queries', () => {
    expect(statements).toHaveLength(5);
  });

  it('returns zero rows on a clean database', async () => {
    for (let i = 0; i < statements.length; i++) {
      expect(await runInvariant(i), `invariant ${(i + 1).toString()}`).toHaveLength(0);
    }
  });

  it('detects a MATCHED sms_log with no verification row (invariant 3)', async () => {
    const c = await makeCompany(db.prisma);
    await makeSmsLog(db.prisma, c.id, { match_status: 'MATCHED' });
    const offending = await runInvariant(2);
    expect(offending.length).toBeGreaterThan(0);
  });
});
