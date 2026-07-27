// Dev-only helper: boot a throwaway real PostgreSQL 16 (embedded-postgres),
// point DATABASE_URL at it, run the given command (e.g. a Prisma CLI call),
// then stop and clean up. Lets us generate/apply migrations without Docker.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const PORT = Number(process.env.PG_DEV_PORT ?? 55433);
const DB = 'paysync';
const dataDir = mkdtempSync(join(tmpdir(), 'paysync-pg-'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
});

const url = `postgresql://postgres:postgres@localhost:${PORT}/${DB}`;

async function run() {
  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(DB);
  } catch {
    // already exists
  }
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) throw new Error('usage: node scripts/with-pg.mjs <command...>');
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, DATABASE_URL: url },
    });
    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

let exitCode = 1;
try {
  exitCode = await run();
} catch (err) {
  console.error(err);
} finally {
  try {
    await pg.stop();
  } catch {
    // best effort
  }
}
process.exit(exitCode);
