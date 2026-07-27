import { uuidv7 } from '@paysync/shared';
import type { NextFunction, Request, Response } from 'express';

import { RequestContext } from './request-context.js';

/** Seeds the per-request context (request id) and echoes X-Request-Id on the response. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header('x-request-id') ?? uuidv7();
  res.setHeader('X-Request-Id', requestId);
  RequestContext.run({ requestId, route: req.originalUrl }, () => {
    next();
  });
}
