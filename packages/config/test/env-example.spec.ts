import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Mirrors workplan/README.md §7. Keeps infra/.env.example honest as config grows.
const REQUIRED_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'KEY_ENCRYPTION_KEY',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ADMIN_ORIGIN',
  'ADMIN_IP_ALLOWLIST',
  'PUBLIC_API_URL',
  'WEBHOOK_USER_AGENT',
  'SENTRY_DSN',
  'ALERT_EMAIL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_KEY',
  'BACKUP_S3_SECRET',
  'BACKUP_ENCRYPTION_KEY',
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
  'LOG_LEVEL',
  'TZ',
];

describe('infra/.env.example', () => {
  const content = readFileSync(new URL('../../../infra/.env.example', import.meta.url), 'utf8');
  const declared = new Set(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.slice(0, line.indexOf('='))),
  );

  it.each(REQUIRED_KEYS)('documents %s', (key) => {
    expect(declared.has(key)).toBe(true);
  });
});
