import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '@paysync/shared';

import { AuthAttemptService } from '../../../common/auth/auth-attempt.service.js';
import { CredentialService } from '../../../common/auth/credential.service.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { RedisService } from '../../../common/redis/redis.service.js';
import { ConfigService } from '../../../config/config.service.js';

import { RecoveryCodeService } from './recovery-code.service.js';
import { SessionService, type SessionTokens } from './session.service.js';
import { TotpService } from './totp.service.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

interface MfaTokenPayload {
  sub: string;
  purpose: 'mfa' | 'enroll';
}

export interface LoginResult {
  mfa_required?: boolean;
  enrolment_required?: boolean;
  mfa_token: string;
}

export interface EnrolResult {
  secret: string;
  otpauth_uri: string;
  qr_data_url: string;
  recovery_codes: string[];
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly totp: TotpService,
    private readonly recovery: RecoveryCodeService,
    private readonly sessions: SessionService,
    private readonly authAttempts: AuthAttemptService,
  ) {}

  async login(email: string, password: string, ip?: string, ua?: string): Promise<LoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (admin === null) {
      await this.credentials.verify(
        password,
        '$argon2id$v=19$m=19456,t=2,p=1$YWJjYWJjYWJjYWJj$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
      await this.authAttempts.record({
        kind: 'ADMIN_LOGIN',
        subject: email,
        outcome: 'FAILURE',
        reason: 'unknown',
        ip,
      });
      throw new AppError('UNAUTHENTICATED', 'Invalid email or password.');
    }
    if (admin.locked_until !== null && admin.locked_until.getTime() > Date.now()) {
      await this.authAttempts.record({
        kind: 'ADMIN_LOGIN',
        subject: email,
        outcome: 'FAILURE',
        reason: 'locked',
        ip,
      });
      throw new AppError('UNAUTHENTICATED', 'Account temporarily locked. Try again later.');
    }
    const ok = await this.credentials.verify(password, admin.password_hash);
    if (!ok) {
      const failed = admin.failed_login_count + 1;
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          failed_login_count: failed,
          locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS) : null,
        },
      });
      await this.authAttempts.record({
        kind: 'ADMIN_LOGIN',
        subject: email,
        outcome: 'FAILURE',
        reason: 'bad_password',
        ip,
      });
      throw new AppError('UNAUTHENTICATED', 'Invalid email or password.');
    }
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failed_login_count: 0,
        locked_until: null,
        last_login_at: new Date(),
        last_login_ip: ip ?? null,
      },
    });
    await this.authAttempts.record({
      kind: 'ADMIN_LOGIN',
      subject: email,
      outcome: 'SUCCESS',
      ip,
      userAgent: ua,
    });

    const enrolled = admin.totp_enrolled_at !== null;
    const purpose: MfaTokenPayload['purpose'] = enrolled ? 'mfa' : 'enroll';
    const mfa_token = await this.jwt.signAsync(
      { sub: admin.id, purpose },
      { secret: this.config.jwt.accessSecret, expiresIn: '5m' },
    );
    return enrolled ? { mfa_required: true, mfa_token } : { enrolment_required: true, mfa_token };
  }

  private async decodeMfaToken(
    token: string,
    expected: MfaTokenPayload['purpose'],
  ): Promise<string> {
    let payload: MfaTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<MfaTokenPayload>(token, {
        secret: this.config.jwt.accessSecret,
      });
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired MFA token.');
    }
    if (payload.purpose !== expected)
      throw new AppError('UNAUTHENTICATED', 'Wrong MFA token stage.');
    return payload.sub;
  }

  async enrol(mfaToken: string): Promise<EnrolResult> {
    const adminId = await this.decodeMfaToken(mfaToken, 'enroll');
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const secret = this.totp.generateSecret();
    const codes = this.recovery.generate();
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: {
        totp_secret_enc: this.totp.encryptSecret(secret),
        recovery_codes_hash: await this.recovery.hashAll(codes),
      },
    });
    const otpauth = this.totp.otpauthUri(admin.email, secret);
    await this.prisma.auditLog.create({
      data: {
        actor_type: 'ADMIN',
        actor_id: adminId,
        action: 'admin.2fa_enroll',
        entity_type: 'admin_user',
        entity_id: adminId,
      },
    });
    return {
      secret,
      otpauth_uri: otpauth,
      qr_data_url: await this.totp.qrDataUrl(otpauth),
      recovery_codes: codes,
    };
  }

  async verify(mfaToken: string, code: string, ip?: string, ua?: string): Promise<SessionTokens> {
    // A verify token may be either stage (freshly enrolled users verify their first code too).
    let adminId: string;
    try {
      adminId = await this.decodeMfaToken(mfaToken, 'mfa');
    } catch {
      adminId = await this.decodeMfaToken(mfaToken, 'enroll');
    }
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.totp_secret_enc === null) throw new AppError('UNAUTHENTICATED', 'TOTP not set up.');

    // Replay guard: a given code can be used once per step.
    const replayKey = `totp:used:${adminId}:${code}`;
    if ((await this.redis.set(replayKey, '1', 'EX', 90, 'NX')) === null) {
      throw new AppError('UNAUTHENTICATED', 'This code was already used.');
    }

    const secret = this.totp.decryptSecret(admin.totp_secret_enc);
    let ok = this.totp.verify(code, secret);
    if (!ok) {
      const consumed = await this.recovery.consume(code, admin.recovery_codes_hash);
      if (consumed.ok) {
        ok = true;
        await this.prisma.adminUser.update({
          where: { id: adminId },
          data: { recovery_codes_hash: consumed.remaining },
        });
      }
    }
    if (!ok) throw new AppError('UNAUTHENTICATED', 'Invalid code.');

    if (admin.totp_enrolled_at === null) {
      await this.prisma.adminUser.update({
        where: { id: adminId },
        data: { totp_enrolled_at: new Date() },
      });
    }
    return this.sessions.issue(adminId, ip, ua);
  }

  async changePassword(
    adminId: string,
    current: string,
    next: string,
    code: string,
  ): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!(await this.credentials.verify(current, admin.password_hash))) {
      throw new AppError('UNAUTHENTICATED', 'Current password is incorrect.');
    }
    if (
      admin.totp_secret_enc === null ||
      !this.totp.verify(code, this.totp.decryptSecret(admin.totp_secret_enc))
    ) {
      throw new AppError('UNAUTHENTICATED', 'A valid TOTP code is required.');
    }
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { password_hash: await this.credentials.hash(next) },
    });
    await this.sessions.revokeAll(adminId);
  }
}
