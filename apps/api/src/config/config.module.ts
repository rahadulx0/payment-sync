import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service.js';
import { CryptoService } from './crypto.service.js';

@Global()
@Module({
  providers: [ConfigService, CryptoService],
  exports: [ConfigService, CryptoService],
})
export class ConfigModule {}
