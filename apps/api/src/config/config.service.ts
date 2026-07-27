import { Injectable } from '@nestjs/common';

import { parseConfig, type RawConfig } from './config.schema.js';

/** Typed, namespaced access to validated configuration. The ONLY place that reads process.env. */
@Injectable()
export class ConfigService {
  private readonly raw: RawConfig;

  constructor() {
    this.raw = parseConfig(process.env);
  }

  get env(): RawConfig['NODE_ENV'] {
    return this.raw.NODE_ENV;
  }
  get isProduction(): boolean {
    return this.raw.NODE_ENV === 'production';
  }
  get port(): number {
    return this.raw.PORT;
  }
  get logLevel(): string {
    return this.raw.LOG_LEVEL;
  }

  get db(): { url: string } {
    return { url: this.raw.DATABASE_URL };
  }
  get redis(): { url: string } {
    return { url: this.raw.REDIS_URL };
  }
  get crypto(): { keyEncryptionKey: Buffer } {
    return { keyEncryptionKey: Buffer.from(this.raw.KEY_ENCRYPTION_KEY, 'base64') };
  }
  get jwt(): { accessSecret: string; refreshSecret: string } {
    return { accessSecret: this.raw.JWT_ACCESS_SECRET, refreshSecret: this.raw.JWT_REFRESH_SECRET };
  }
  get admin(): { origin: string; ipAllowlist: string[] } {
    return {
      origin: this.raw.ADMIN_ORIGIN,
      ipAllowlist: this.raw.ADMIN_IP_ALLOWLIST.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
  }
  get publicApiUrl(): string {
    return this.raw.PUBLIC_API_URL;
  }
  get webhookUserAgent(): string {
    return this.raw.WEBHOOK_USER_AGENT;
  }
  get metricsToken(): string {
    return this.raw.METRICS_TOKEN;
  }
  get rateLimit(): { registerRpm: number } {
    return { registerRpm: this.raw.RATE_LIMIT_REGISTER_RPM };
  }
}
