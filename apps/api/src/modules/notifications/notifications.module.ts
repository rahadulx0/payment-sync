import { Global, Module } from '@nestjs/common';

import { AlertService } from './alert.service.js';

/**
 * Alerting is global: any subsystem that detects a P1/P2/P3 condition can raise
 * one without importing an ops module (architecture §15.3). The transport
 * (Telegram/email) is bound by `setSink` at boot in Task 16's deployment wiring.
 */
@Global()
@Module({
  providers: [AlertService],
  exports: [AlertService],
})
export class NotificationsModule {}
