import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '@paysync/shared';
import type { Request } from 'express';

import { ConfigService } from '../../config/config.service.js';
import { RequestContext } from '../context/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { AuthAttemptService } from './auth-attempt.service.js';
import { CredentialService } from './credential.service.js';
import { AUDIENCE_KEY, type Audience, SCOPES_KEY } from './decorators.js';

const DEVICE_SCOPES = ['sms:upload', 'device:heartbeat', 'config:read'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AdminJwtPayload {
  sub: string;
  totp_verified?: boolean;
  family?: string;
}

/**
 * Single global guard implementing the three-audience model (ADR-4) with
 * default-deny: a route without an explicit audience decorator fails closed.
 */
@Injectable()
export class AudienceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly credentials: CredentialService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authAttempts: AuthAttemptService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const audience = this.reflector.getAllAndOverride<Audience | undefined>(AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();

    if (audience === undefined) {
      throw new AppError('UNAUTHENTICATED', 'Route has no audience decorator (default-deny).');
    }
    if (audience === 'public') return true;

    if (audience === 'device') await this.authDevice(req);
    else if (audience === 'server') await this.authServer(req);
    else await this.authAdmin(req);

    const requiredScopes =
      this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (requiredScopes.length > 0) {
      const have = new Set(req.authCompany?.scopes ?? []);
      if (!requiredScopes.every((s) => have.has(s))) {
        throw new AppError('FORBIDDEN_SCOPE', 'Missing a required scope for this route.');
      }
    }
    return true;
  }

  private bearer(req: Request): string | undefined {
    const header = req.header('authorization');
    if (header?.startsWith('Bearer ') === true) return header.slice('Bearer '.length).trim();
    return undefined;
  }

  private async authDevice(req: Request): Promise<void> {
    const token = this.bearer(req);
    const installId = req.header('x-install-id');
    if (token === undefined || installId === undefined || !UUID_RE.test(installId)) {
      throw new AppError('UNAUTHENTICATED', 'Missing device token or install id.');
    }
    const device = await this.prisma.device.findUnique({
      where: { install_id: installId },
      include: { company: true },
    });
    const ok = device !== null && (await this.credentials.verify(token, device.token_hash));
    if (device === null || !ok) {
      await this.authAttempts.record({
        kind: 'DEVICE_TOKEN',
        subject: installId,
        outcome: 'FAILURE',
        reason: 'invalid_token',
        ip: req.ip,
      });
      throw new AppError('UNAUTHENTICATED', 'Invalid device credentials.');
    }
    if (device.status === 'BLOCKED')
      throw new AppError('DEVICE_BLOCKED', 'This device is blocked.');
    if (device.status === 'RETIRED')
      throw new AppError('DEVICE_RETIRED', 'This device is retired.');
    if (device.company.status === 'DISABLED')
      throw new AppError('COMPANY_SUSPENDED', 'Company disabled.');

    req.authDevice = { deviceId: device.id, installId };
    req.authCompany = {
      companyId: device.company_id,
      companyCode: device.company.company_code,
      scopes: DEVICE_SCOPES,
    };
    RequestContext.set({ companyId: device.company_id, deviceId: device.id });
    await this.authAttempts.record({
      kind: 'DEVICE_TOKEN',
      subject: installId,
      outcome: 'SUCCESS',
      companyId: device.company_id,
      ip: req.ip,
    });
  }

  private async authServer(req: Request): Promise<void> {
    const token = this.bearer(req);
    const companyCode = req.header('x-company-id');
    if (token === undefined || companyCode === undefined) {
      throw new AppError('UNAUTHENTICATED', 'Missing server key or company id.');
    }
    const key = await this.credentials.findByPlaintext(token);
    const expired = key?.expires_at != null && key.expires_at.getTime() < Date.now();
    if (key === null || key.key_type !== 'SERVER' || expired) {
      await this.authAttempts.record({
        kind: 'SERVER_KEY',
        subject: companyCode,
        outcome: 'FAILURE',
        reason: 'invalid_key',
        ip: req.ip,
      });
      throw new AppError('UNAUTHENTICATED', 'Invalid server credentials.');
    }
    const company = await this.prisma.company.findUnique({ where: { id: key.company_id } });
    if (company === null || company.company_code !== companyCode) {
      // Never leak whether the key or the header was wrong.
      throw new AppError('UNAUTHENTICATED', 'Invalid server credentials.');
    }
    if (company.status !== 'ACTIVE') {
      throw new AppError('COMPANY_SUSPENDED', 'This company is not active.');
    }
    req.authCompany = {
      companyId: company.id,
      companyCode: company.company_code,
      scopes: key.scopes,
      keyType: 'SERVER',
    };
    RequestContext.set({ companyId: company.id });
    void this.prisma.apiKey
      .update({
        where: { id: key.id },
        data: { last_used_at: new Date(), last_used_ip: req.ip ?? null },
      })
      .catch(() => undefined);
    await this.authAttempts.record({
      kind: 'SERVER_KEY',
      subject: companyCode,
      outcome: 'SUCCESS',
      companyId: company.id,
      ip: req.ip,
    });
  }

  private async authAdmin(req: Request): Promise<void> {
    const token = this.bearer(req);
    if (token === undefined) throw new AppError('UNAUTHENTICATED', 'Missing admin token.');
    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret: this.config.jwt.accessSecret,
      });
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired admin token.');
    }
    if (payload.totp_verified !== true) {
      throw new AppError('UNAUTHENTICATED', 'TOTP verification required.');
    }
    const allowlist = this.config.admin.ipAllowlist;
    if (allowlist.length > 0 && (req.ip === undefined || !allowlist.includes(req.ip))) {
      throw new AppError('FORBIDDEN_SCOPE', 'Admin access is not allowed from this IP.');
    }
    req.authAdmin = { adminId: payload.sub, family: payload.family };
    RequestContext.set({ adminId: payload.sub });
  }
}
