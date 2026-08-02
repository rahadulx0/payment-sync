import { Module } from '@nestjs/common';

import { CleanupCredentialsProcessor } from './cleanup-credentials.processor.js';
import { DeviceHealthProcessor } from './device-health.processor.js';
import { RetentionPurgeProcessor } from './retention-purge.processor.js';

/**
 * Scheduled maintenance jobs (Task 16 §4.5). They are plain injectable services
 * with a `tick()` so they can be unit/integration tested directly; the BullMQ
 * repeatable schedule that drives them lives in the worker process.
 *
 * Every job is idempotent — running one twice must be harmless, because a
 * retry, a redeploy, or two worker replicas will make that happen.
 */
@Module({
  providers: [RetentionPurgeProcessor, DeviceHealthProcessor, CleanupCredentialsProcessor],
  exports: [RetentionPurgeProcessor, DeviceHealthProcessor, CleanupCredentialsProcessor],
})
export class MaintenanceModule {}
