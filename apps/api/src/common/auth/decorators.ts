import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';

import type { AdminContext, CompanyContext, DeviceContext } from './contexts.js';

export const AUDIENCE_KEY = 'paysync:audience';
export const SCOPES_KEY = 'paysync:scopes';

export type Audience = 'device' | 'server' | 'admin' | 'public';

/** Health/metrics only — reachable without a credential. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(AUDIENCE_KEY, 'public');

export const DeviceAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIENCE_KEY, 'device');

export const AdminAuth = (): MethodDecorator & ClassDecorator => SetMetadata(AUDIENCE_KEY, 'admin');

export function ServerAuth(...scopes: string[]): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(AUDIENCE_KEY, 'server'), SetMetadata(SCOPES_KEY, scopes));
}

export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CompanyContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().authCompany,
);

export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeviceContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().authDevice,
);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminContext | undefined =>
    ctx.switchToHttp().getRequest<Request>().authAdmin,
);
