import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parse } from '../src/parse.js';
import { ProviderRule } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(here, '..', 'rules');
const fixturesDir = join(here, '..', 'fixtures');

const rules = readdirSync(rulesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ProviderRule.parse(JSON.parse(readFileSync(join(rulesDir, f), 'utf8'))));

interface Fixture {
  id: string;
  address: string;
  body: string;
  now: string;
  expected: unknown;
}

for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))) {
  const entries = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture[];
  describe(`fixtures: ${file}`, () => {
    for (const fx of entries) {
      it(fx.id, () => {
        const res = parse({ rules, smsAddress: fx.address, body: fx.body, now: new Date(fx.now) });
        expect(res).toEqual(fx.expected);
      });
    }
  });
}

describe('debit safety (highest value)', () => {
  it('no DEBIT/IGNORED fixture ever exposes an amount or transaction id', () => {
    for (const file of readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))) {
      const entries = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture[];
      for (const fx of entries) {
        const res = parse({ rules, smsAddress: fx.address, body: fx.body, now: new Date(fx.now) });
        if (res.status === 'IGNORED' || res.direction === 'DEBIT') {
          expect(res.fields.amount).toBeUndefined();
          expect(res.fields.transactionId).toBeUndefined();
        }
      }
    }
  });
});
