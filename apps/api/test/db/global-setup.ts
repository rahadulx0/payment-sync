// Vitest global setup: boot ONE real embedded PostgreSQL 16 for the whole test
// run, apply the migrations to a template database, and ensure a real Redis is
// reachable. Connection details reach the workers via `provide`. Each DB-backed
// spec clones the template into its own isolated database (see harness.ts).
// No Docker required: Postgres is embedded; Redis is native (WSL locally, a
// service on CI via REDIS_TEST_URL).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import EmbeddedPostgres from 'embedded-postgres';
import { Redis } from 'ioredis';
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
    redisUrl: string;
  }
}

let instance: EmbeddedPostgres | undefined;

function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'migrations');
}

function ensureRedis(): string {
  const fromEnv = process.env['REDIS_TEST_URL'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  if (process.platform === 'win32') {
    try {
      execFileSync(
        'wsl.exe',
        [
          '-d',
          'Ubuntu',
          '-e',
          'bash',
          '-lc',
          'redis-server --daemonize yes --port 6399 --save "" --appendonly no',
        ],
        { stdio: 'ignore' },
      );
    } catch {
      // best effort; a reachable Redis at 6399 may already exist
    }
    return 'redis://localhost:6399';
  }
  return 'redis://localhost:6379';
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
    await client.query(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
  }
  await client.end();

  const redisUrl = ensureRedis();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushall();
  } finally {
    redis.disconnect();
  }

  provide('pg', {
    host: 'localhost',
    port: PORT,
    user: 'postgres',
    password: 'postgres',
    template: TEMPLATE_DB,
  });
  provide('redisUrl', redisUrl);
}

export async function teardown(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = undefined;
  }
}
