import { SetMetadata } from '@nestjs/common';

export interface RateLimitOptions {
  points: number;
  windowSec: number;
  by: 'company' | 'device' | 'ip' | 'company+route';
  /** Fail closed (reject) if Redis is unavailable. Default false (fail open for reads). */
  failClosed?: boolean;
}

export const RATE_LIMIT_KEY = 'paysync:ratelimit';

export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
