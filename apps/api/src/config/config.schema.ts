import { z } from 'zod';

const DEV_KEY_ENCRYPTION_KEY = 'ZGV2LWtleS1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLXh4eHg=';

const base64Key32 = z.string().refine(
  (v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  { message: 'must be 32 bytes encoded as base64' },
);

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    // Optional keyspace prefix. Prod leaves it empty; the test harness derives a
    // per-database prefix so parallel test processes sharing one Redis don't
    // collide on rate-limit / idempotency / lock keys.
    REDIS_KEY_PREFIX: z.string().default(''),

    KEY_ENCRYPTION_KEY: base64Key32,
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),

    ADMIN_ORIGIN: z.string().url().default('http://localhost:3001'),
    ADMIN_IP_ALLOWLIST: z.string().default(''),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    WEBHOOK_USER_AGENT: z.string().default('payment-sync-webhook/1.0'),
    // Test-only escape hatch: permit http/loopback callbacks so integration
    // tests can point at a local receiver. Never enable in production.
    WEBHOOK_INSECURE_ALLOWED: z.string().default('false'),
    METRICS_TOKEN: z.string().default(''),
    RATE_LIMIT_REGISTER_RPM: z.coerce.number().int().positive().default(120),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV === 'production') {
      if (cfg.KEY_ENCRYPTION_KEY === DEV_KEY_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['KEY_ENCRYPTION_KEY'],
          message: 'refusing to boot in production with the dev KEY_ENCRYPTION_KEY',
        });
      }
      for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
        if (cfg[key].includes('dev-') || cfg[key].includes('change-me')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `refusing to boot in production with a dev ${key}`,
          });
        }
      }
    }
  });

export type RawConfig = z.infer<typeof configSchema>;

/** Parse `env`, aggregating every failure into one readable error. */
export function parseConfig(env: NodeJS.ProcessEnv): RawConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
