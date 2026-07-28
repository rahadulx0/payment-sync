-- Task 09: freeze the signed body per event, carry the resolved callback URL and
-- a cancellation reason on the event, and hold the per-company circuit-breaker
-- state on the company row (architecture.md §10).

ALTER TABLE "webhook_events" ADD COLUMN "payload_raw" text;
ALTER TABLE "webhook_events" ADD COLUMN "callback_url" text;
ALTER TABLE "webhook_events" ADD COLUMN "reason" varchar(40);

ALTER TABLE "companies" ADD COLUMN "webhook_breaker_state" varchar(10) NOT NULL DEFAULT 'CLOSED';
ALTER TABLE "companies" ADD COLUMN "webhook_consecutive_failures" integer NOT NULL DEFAULT 0;
ALTER TABLE "companies" ADD COLUMN "webhook_last_success_at" timestamptz(3);
ALTER TABLE "companies" ADD COLUMN "webhook_breaker_opened_at" timestamptz(3);
