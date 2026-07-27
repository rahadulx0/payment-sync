-- Task 04: key rotation grace + device directives consumed at heartbeat.
ALTER TABLE "api_keys" ADD COLUMN "revoke_at" TIMESTAMPTZ(3);

ALTER TABLE "devices" ADD COLUMN "force_sync_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "devices" ADD COLUMN "rotate_token_requested" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "devices" ADD COLUMN "message_for_user" TEXT;
