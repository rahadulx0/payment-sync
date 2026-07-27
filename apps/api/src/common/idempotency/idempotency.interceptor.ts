import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  type RawBodyRequest,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@paysync/shared';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { catchError, from, map, mergeMap, type Observable, of, throwError } from 'rxjs';

import { PrismaService } from '../prisma/prisma.service.js';

import { IDEMPOTENCY_KEY, type IdempotencyOptions } from './idempotency.decorator.js';

const ANON_COMPANY = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const options = this.reflector.getAllAndOverride<IdempotencyOptions | undefined>(
      IDEMPOTENCY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (options === undefined) return next.handle();

    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (key === undefined || key.length === 0) return next.handle();

    const companyId = req.authCompany?.companyId ?? ANON_COMPANY;
    const requestHash = createHash('sha256')
      .update(req.rawBody ?? Buffer.alloc(0))
      .digest('hex');
    const ttlHours = options.ttlHours ?? 24;
    const where = {
      company_id_endpoint_key: { company_id: companyId, endpoint: options.endpoint, key },
    };

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          company_id: companyId,
          endpoint: options.endpoint,
          key,
          request_hash: requestHash,
          state: 'IN_FLIGHT',
          expires_at: new Date(Date.now() + ttlHours * 3_600_000),
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      const existing = await this.prisma.idempotencyKey.findUnique({ where });
      if (existing === null) throw e;
      if (existing.state === 'COMPLETED') {
        if (existing.request_hash !== requestHash) {
          throw new AppError(
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency key reused with a different body.',
          );
        }
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(existing.response_status ?? 200);
        return of(existing.response_body);
      }
      throw new AppError(
        'REQUEST_IN_PROGRESS',
        'A request with this idempotency key is in progress.',
      );
    }

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.prisma.idempotencyKey.update({
            where,
            data: {
              state: 'COMPLETED',
              response_status: res.statusCode,
              response_body: (body ?? null) as Prisma.InputJsonValue,
            },
          }),
        ).pipe(map(() => body)),
      ),
      catchError((err: unknown) =>
        from(this.prisma.idempotencyKey.delete({ where }).catch(() => undefined)).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}
