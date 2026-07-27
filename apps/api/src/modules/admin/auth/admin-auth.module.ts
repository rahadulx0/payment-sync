import { Module } from '@nestjs/common';

import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { RecoveryCodeService } from './recovery-code.service.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService, SessionService, TotpService, RecoveryCodeService],
  exports: [SessionService],
})
export class AdminAuthModule {}
