// Vitest global setup: boot ONE real embedded PostgreSQL 16 for the whole test
// run, apply the migrations to a template database, and hand the connection
// details to the workers via `provide`. Each DB-backed spec then clones the
// template into its own isolated database (see harness.ts). No Docker required.
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import type { GlobalSetupContext } from 'vitest/node';

const PORT = 55_440;
const TEMPLATE_DB = 'paysync_template';

export interface PgConnInfo {
  host: string;
  port: number;
  user: string;
  password: string;
  template: string;
}

declare module 'vitest' {
  interface ProvidedContext {
    pg: PgConnInfo;
  }
}

let instance: EmbeddedPostgres | undefined;

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'prisma', 'migrations');
}

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'paysync-test-pg-'));
  instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });
  await instance.initialise();
  await instance.start();
  await instance.createDatabase(TEMPLATE_DB);

  const client = new pg.Client({
    host: 'localhost',
    port: PORT,
    user: 'postgres',
    password: 'postgres',
    database: TEMPLATE_DB,
  });
  await client.connect();
  const dir = migrationsDir();
  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of migrations) {
    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
    await client.query(sql);
  }
  await client.end();

  provide('pg', {
    host: 'localhost',
    port: PORT,
    user: 'postgres',
    password: 'postgres',
    template: TEMPLATE_DB,
  });
}

export async function teardown(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = undefined;
  }
}
