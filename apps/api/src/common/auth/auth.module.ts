import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { ConfigService } from '../../config/config.service.js';

import { AudienceGuard } from './audience.guard.js';
import { AuthAttemptService } from './auth-attempt.service.js';
import { CredentialService } from './credential.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.jwt.accessSecret }),
    }),
  ],
  providers: [
    CredentialService,
    AuthAttemptService,
    AudienceGuard,
    { provide: APP_GUARD, useClass: AudienceGuard },
  ],
  exports: [CredentialService, AuthAttemptService, JwtModule],
})
export class AuthModule {}
