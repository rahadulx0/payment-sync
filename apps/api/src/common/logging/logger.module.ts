import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { ConfigModule } from '../../config/config.module.js';
import { ConfigService } from '../../config/config.service.js';
import { RequestContext } from '../context/request-context.js';

// Structured JSON logging with a request id on every line and a fail-closed
// redaction list so secrets never reach the logs (architecture §13.3, §15.1).
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: () => RequestContext.requestId(),
          autoLogging: true,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-install-id"]',
              '*.api_key',
              '*.device_token',
              '*.password',
              '*.totp',
              '*.totp_secret',
              '*.webhook_secret',
              '*.raw_message',
              '*.signature',
            ],
            censor: '[redacted]',
          },
          customProps: () => {
            const ctx = RequestContext.get();
            return {
              company_id: ctx?.companyId,
              device_id: ctx?.deviceId,
              admin_id: ctx?.adminId,
            };
          },
        },
      }),
    }),
  ],
})
export class LoggerModule {}
