import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import { AppError, uuidv7 } from '@paysync/shared';

import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { ConfigService } from '../../../config/config.service.js';

const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  family: string;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger('SessionService');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issue(
    adminId: string,
    ip: string | undefined,
    ua: string | undefined,
  ): Promise<SessionTokens> {
    return this.create(adminId, uuidv7(), ip, ua);
  }

  private async create(
    adminId: string,
    family: string,
    ip: string | undefined,
    ua: string | undefined,
  ): Promise<SessionTokens> {
    const sid = uuidv7();
    const refreshToken = await this.jwt.signAsync(
      { sub: adminId, sid, family },
      { secret: this.config.jwt.refreshSecret, expiresIn: '30d' },
    );
    await this.prisma.adminSession.create({
      data: {
        id: sid,
        admin_id: adminId,
        session_family: family,
        token_hash: await hash(refreshToken, ARGON),
        ip: ip ?? null,
        user_agent: ua ?? null,
        expires_at: new Date(Date.now() + REFRESH_TTL_MS),
        last_used_at: new Date(),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: adminId, totp_verified: true, family },
      { secret: this.config.jwt.accessSecret, expiresIn: '15m' },
    );
    return { accessToken, refreshToken };
  }

  /** Rotate a refresh token. Reusing an already-rotated token kills the whole family. */
  async rotate(
    refreshToken: string,
    ip: string | undefined,
    ua: string | undefined,
  ): Promise<SessionTokens> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Invalid refresh token.');
    }
    const session = await this.prisma.adminSession.findUnique({ where: { id: payload.sid } });
    if (session === null) throw new AppError('UNAUTHENTICATED', 'Unknown session.');
    if (session.revoked_at !== null) {
      // Reuse of a rotated token → compromise. Kill the family and audit (P2, Task 16 alert).
      await this.prisma.adminSession.updateMany({
        where: { session_family: session.session_family, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await this.prisma.auditLog.create({
        data: {
          actor_type: 'SYSTEM',
          action: 'admin.session_reuse_detected',
          entity_type: 'admin_session',
          entity_id: session.id,
        },
      });
      this.logger.warn(`refresh-token reuse detected for family ${session.session_family}`);
      throw new AppError('UNAUTHENTICATED', 'Refresh token reuse detected; session revoked.');
    }
    const next = await this.create(session.admin_id, session.session_family, ip, ua);
    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: { revoked_at: new Date() },
    });
    return next;
  }

  async revokeCurrent(family: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { session_family: family, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async revokeAll(adminId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { admin_id: adminId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async list(adminId: string): Promise<
    {
      id: string;
      ip: string | null;
      user_agent: string | null;
      created_at: Date;
      last_used_at: Date | null;
    }[]
  > {
    return this.prisma.adminSession.findMany({
      where: { admin_id: adminId, revoked_at: null },
      select: { id: true, ip: true, user_agent: true, created_at: true, last_used_at: true },
      orderBy: { created_at: 'desc' },
    });
  }
}
