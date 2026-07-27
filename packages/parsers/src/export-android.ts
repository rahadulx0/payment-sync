/**
 * Builds the rule + fixture artifacts the Android app ships and tests against.
 * Task 13 wires these to the actual `apps/android` asset paths and asserts the
 * committed files are byte-identical to this output (parser parity in lockstep).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown);
}

export function buildRulesBundle(): unknown[] {
  return loadJsonDir(join(packageRoot, 'rules'));
}

export function buildFixturesBundle(): unknown[] {
  return loadJsonDir(join(packageRoot, 'fixtures')).flat();
}

function main(): void {
  const outDir = join(packageRoot, 'generated');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'parser-rules-bundled.json'),
    `${JSON.stringify(buildRulesBundle(), null, 2)}\n`,
  );
  writeFileSync(
    join(outDir, 'parser-fixtures.json'),
    `${JSON.stringify(buildFixturesBundle(), null, 2)}\n`,
  );
  process.stdout.write('exported android parser artifacts to packages/parsers/generated\n');
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  main();
}
