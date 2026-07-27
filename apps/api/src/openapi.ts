import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { stringify } from 'yaml';

import { AppModule } from './app.module.js';

// Generation-only env so ConfigService validates; no external connections are
// made (preview mode does not run lifecycle hooks, Redis is lazyConnect).
function ensureEnv(): void {
  const defaults: Record<string, string> = {
    DATABASE_URL: 'postgresql://localhost:5432/paysync',
    REDIS_URL: 'redis://localhost:6379',
    KEY_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    JWT_ACCESS_SECRET: 'openapi-generation-access-secret',
    JWT_REFRESH_SECRET: 'openapi-generation-refresh-secret',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export async function generateOpenApi(): Promise<string> {
  ensureEnv();
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('payment-sync API')
      .setDescription('Device, client and admin API for the payment-verification platform.')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  await app.close();
  return stringify(document);
}

async function main(): Promise<void> {
  const yaml = await generateOpenApi();
  // Run from apps/api (pnpm --filter): repo docs is two levels up.
  const out = join(process.cwd(), '..', '..', 'docs', 'openapi.yaml');
  writeFileSync(out, yaml, 'utf8');
  process.stdout.write(`wrote ${out}\n`);
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === entry) {
  void main();
}
