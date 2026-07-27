import { Global, Module } from '@nestjs/common';

import { SafeUrlService } from './safe-url.service.js';

@Global()
@Module({
  providers: [SafeUrlService],
  exports: [SafeUrlService],
})
export class HttpModule {}
