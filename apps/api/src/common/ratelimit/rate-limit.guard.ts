import { randomUUID } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@paysync/shared';
import type { Request, Response } from 'express';

import { RedisService } from '../redis/redis.service.js';

import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator.js';

/** Redis sliding-window rate limiter, applied to routes carrying @RateLimit. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (options === undefined) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = `rl:${options.by}:${this.subject(options.by, req)}`;
    const now = Date.now();
    const windowMs = options.windowSec * 1000;

    try {
      const results = await this.redis
        .multi()
        .zremrangebyscore(key, 0, now - windowMs)
        .zadd(key, now, `${now.toString()}-${randomUUID()}`)
        .zcard(key)
        .pexpire(key, windowMs)
        .exec();
      const count = Number(results?.[2]?.[1] ?? 0);
      res.setHeader('X-RateLimit-Limit', options.points);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, options.points - count));
      if (count > options.points) {
        res.setHeader('Retry-After', options.windowSec);
        throw new AppError('RATE_LIMITED', 'Rate limit exceeded.');
      }
      return true;
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (options.failClosed === true) {
        throw new AppError('RATE_LIMITED', 'Rate limiter unavailable.');
      }
      return true; // fail open for reads
    }
  }

  private subject(by: RateLimitOptions['by'], req: Request): string {
    switch (by) {
      case 'company':
        return req.authCompany?.companyId ?? 'anon';
      case 'device':
        return req.authDevice?.deviceId ?? 'anon';
      case 'ip':
        return req.ip ?? 'anon';
      case 'company+route':
        return `${req.authCompany?.companyId ?? 'anon'}:${req.path}`;
    }
  }
}
