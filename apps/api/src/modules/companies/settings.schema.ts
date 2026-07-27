import { z } from 'zod';

/** Per-tenant policy bounds (architecture §6.9 / workplan/04 §4.3). */
export const settingsUpdateSchema = z
  .object({
    order_ttl_minutes: z.number().int().min(5).max(1440),
    late_match_grace_hours: z.number().int().min(0).max(168),
    heuristic_window_minutes: z.number().int().min(1).max(360),
    heuristic_enabled: z.boolean(),
    amount_tolerance: z.number().min(0).max(1000),
    require_sender_match: z.boolean(),
    auto_verify_min_confidence: z.number().min(0.5).max(1),
    webhook_timeout_ms: z.number().int().min(1000).max(30000),
    webhook_max_attempts: z.number().int().min(1).max(12),
    sms_retention_days: z.number().int().min(30).max(730),
    rate_limit_register_rpm: z.number().int().min(10).max(6000),
    notify_on_expiry: z.boolean(),
    notify_on_review: z.boolean(),
    review_sla_minutes: z.number().int().min(1).max(1440),
    max_devices: z.number().int().min(1).max(50),
    max_sms_per_day: z.number().int().min(1).max(100_000),
    allowed_providers: z.array(z.enum(['BKASH', 'NAGAD', 'UPAY'])).min(1),
  })
  .partial()
  .strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** Drop keys whose value is undefined (so the object matches Prisma's exact-optional inputs). */
export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
