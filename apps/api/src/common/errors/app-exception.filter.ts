import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { AppError, type ErrorCode } from '@paysync/shared';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

import { RequestContext } from '../context/request-context.js';

interface Mapped {
  code: ErrorCode;
  status: number;
  message: string;
  details?: Record<string, unknown> | undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContext.requestId();
    const mapped = this.map(exception);

    if (mapped.status >= 500) {
      this.logger.error({ err: exception, requestId }, mapped.message);
    }

    res.setHeader('X-Request-Id', requestId);
    res.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
        request_id: requestId,
      },
    });
  }

  private map(e: unknown): Mapped {
    if (e instanceof AppError) {
      return { code: e.code, status: e.httpStatus, message: e.message, details: e.details };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return { code: 'VALIDATION_ERROR', status: 409, message: 'Unique constraint violation' };
      }
      return { code: 'VALIDATION_ERROR', status: 400, message: 'Database constraint violation' };
    }
    if (e instanceof HttpException) {
      return this.mapHttp(e);
    }
    return { code: 'INTERNAL_ERROR', status: 500, message: 'Internal server error' };
  }

  private mapHttp(e: HttpException): Mapped {
    const status = e.getStatus();
    const resp = e.getResponse();
    const message =
      typeof resp === 'string'
        ? resp
        : (this.messageFrom((resp as { message?: unknown }).message) ?? e.message);
    const byStatus: Record<number, ErrorCode> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN_SCOPE',
      413: 'PAYLOAD_TOO_LARGE',
      429: 'RATE_LIMITED',
    };
    const code: ErrorCode =
      byStatus[status] ?? (status < 500 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
    return { code, status, message };
  }

  private messageFrom(m: unknown): string | undefined {
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.map((x) => String(x)).join('; ');
    return undefined;
  }
}
