import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '@paysync/shared';
import type { Request, Response } from 'express';

import type { AdminContext } from '../../../common/auth/contexts.js';
import { AdminAuth, CurrentAdmin, Public } from '../../../common/auth/decorators.js';
import { RateLimit } from '../../../common/ratelimit/rate-limit.decorator.js';
import { ConfigService } from '../../../config/config.service.js';

import { AdminAuthService } from './admin-auth.service.js';
import { ChangePasswordDto, LoginDto, MfaTokenDto, TotpVerifyDto } from './dto.js';
import { SessionService } from './session.service.js';

const REFRESH_COOKIE = 'paysync_refresh';
const REFRESH_PATH = '/api/v1/admin/auth';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict',
      path: REFRESH_PATH,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @RateLimit({ points: 10, windowSec: 3600, by: 'ip', failClosed: true })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, req.ip, req.header('user-agent'));
  }

  @Public()
  @Post('2fa/enroll')
  enrol(@Body() dto: MfaTokenDto) {
    return this.auth.enrol(dto.mfa_token);
  }

  @Public()
  @Post('2fa/verify')
  async verify(
    @Body() dto: TotpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.verify(
      dto.mfa_token,
      dto.code,
      req.ip,
      req.header('user-agent'),
    );
    this.setRefreshCookie(res, tokens.refreshToken);
    return { access_token: tokens.accessToken, expires_in: 900 };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token === undefined) throw new AppError('UNAUTHENTICATED', 'Missing refresh token.');
    const tokens = await this.sessions.rotate(token, req.ip, req.header('user-agent'));
    this.setRefreshCookie(res, tokens.refreshToken);
    return { access_token: tokens.accessToken, expires_in: 900 };
  }

  @AdminAuth()
  @Get('sessions')
  sessionsList(@CurrentAdmin() admin: AdminContext | undefined) {
    return this.sessions.list(admin?.adminId ?? '');
  }

  @AdminAuth()
  @Post('logout')
  async logout(
    @CurrentAdmin() admin: AdminContext | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (admin?.family !== undefined) await this.sessions.revokeCurrent(admin.family);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return { ok: true };
  }

  @AdminAuth()
  @Post('logout-all')
  async logoutAll(
    @CurrentAdmin() admin: AdminContext | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.revokeAll(admin?.adminId ?? '');
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return { ok: true };
  }

  @AdminAuth()
  @Post('password')
  async changePassword(
    @CurrentAdmin() admin: AdminContext | undefined,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(
      admin?.adminId ?? '',
      dto.current_password,
      dto.new_password,
      dto.code,
    );
    return { ok: true };
  }
}
