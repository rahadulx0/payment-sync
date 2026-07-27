-- Task 06: device token rotation overlap + device diagnostics events.
ALTER TABLE "devices" ADD COLUMN "prev_token_hash" VARCHAR(97);

CREATE TABLE "device_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "device_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "at" TIMESTAMPTZ(3) NOT NULL,
  "detail" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "device_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_events_device_id_created_at_idx" ON "device_events" ("device_id", "created_at" DESC);

ALTER TABLE "device_events"
  ADD CONSTRAINT "device_events_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
