import { SetMetadata } from '@nestjs/common';

export interface IdempotencyOptions {
  endpoint: string;
  ttlHours?: number;
}

export const IDEMPOTENCY_KEY = 'paysync:idempotency';

export const Idempotent = (options: IdempotencyOptions): MethodDecorator =>
  SetMetadata(IDEMPOTENCY_KEY, options);
