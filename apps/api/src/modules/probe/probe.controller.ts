import { Body, Controller, Get, Post } from '@nestjs/common';

import type { AdminContext, CompanyContext, DeviceContext } from '../../common/auth/contexts.js';
import {
  AdminAuth,
  CurrentAdmin,
  CurrentCompany,
  CurrentDevice,
  DeviceAuth,
  ServerAuth,
} from '../../common/auth/decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.decorator.js';
import { RateLimit } from '../../common/ratelimit/rate-limit.decorator.js';

/**
 * Test surface for the auth matrix, default-deny, rate limiting and idempotency.
 * /whoami is genuinely useful for client support (leaks only the caller's own identity).
 */
@Controller('probe')
export class ProbeController {
  @DeviceAuth()
  @Get('device')
  whoamiDevice(
    @CurrentDevice() device: DeviceContext | undefined,
    @CurrentCompany() company: CompanyContext | undefined,
  ): { audience: string; device: DeviceContext | undefined; company: CompanyContext | undefined } {
    return { audience: 'device', device, company };
  }

  @ServerAuth('payments:read')
  @Get('server')
  whoamiServer(@CurrentCompany() company: CompanyContext | undefined): {
    audience: string;
    company: CompanyContext | undefined;
  } {
    return { audience: 'server', company };
  }

  @AdminAuth()
  @Get('admin')
  whoamiAdmin(@CurrentAdmin() admin: AdminContext | undefined): {
    audience: string;
    admin: AdminContext | undefined;
  } {
    return { audience: 'admin', admin };
  }

  /** Intentionally has NO audience decorator — must be denied by default-deny. */
  @Get('undecorated')
  undecorated(): { ok: boolean } {
    return { ok: true };
  }

  @ServerAuth('payments:read')
  @RateLimit({ points: 3, windowSec: 60, by: 'company' })
  @Get('rate-limited')
  rateLimited(): { ok: boolean } {
    return { ok: true };
  }

  @ServerAuth('payments:write')
  @Idempotent({ endpoint: 'probe.idempotent' })
  @Post('idempotent')
  idempotent(@Body() body: unknown): { received: unknown } {
    return { received: body };
  }
}
