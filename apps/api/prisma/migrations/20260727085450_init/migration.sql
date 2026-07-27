-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('BKASH', 'NAGAD', 'UPAY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'RETIRED');

-- CreateEnum
CREATE TYPE "KeyType" AS ENUM ('SERVER', 'DEVICE_ENROLL');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PARSED', 'PARTIAL', 'UNPARSED', 'IGNORED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IN_REVIEW', 'IGNORED', 'DUPLICATE_TXN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'VERIFIED', 'MANUAL_REVIEW', 'EXPIRED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchMode" AS ENUM ('EXACT', 'HEURISTIC');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('EXACT_TXN_ID', 'HEURISTIC_AMOUNT_WINDOW', 'MANUAL_ADMIN');

-- CreateEnum
CREATE TYPE "UploadSource" AS ENUM ('REALTIME', 'MANUAL_SYNC', 'RECONCILE');

-- CreateEnum
CREATE TYPE "ReviewReason" AS ENUM ('AMBIGUOUS_CANDIDATES', 'AMOUNT_MISMATCH', 'DUPLICATE_TXN_ID', 'SUSPICIOUS_SMS', 'UNPARSED_MESSAGE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MatchTrigger" AS ENUM ('SMS_UPLOAD', 'ORDER_REGISTER', 'RESCAN', 'REPARSE', 'ADMIN');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('VERIFIED', 'UNMATCHED', 'REVIEW', 'IGNORED', 'DUPLICATE', 'GUARD_REJECTED');

-- CreateEnum
CREATE TYPE "MatchPass" AS ENUM ('EXACT', 'HEURISTIC', 'NONE');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'SYSTEM', 'CLIENT', 'DEVICE');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "contact_email" VARCHAR(160),
    "contact_phone" VARCHAR(32),
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "webhook_secret_enc" BYTEA,
    "webhook_secret_prev_enc" BYTEA,
    "webhook_secret_rotated_at" TIMESTAMPTZ(3),
    "default_callback_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "company_id" UUID NOT NULL,
    "order_ttl_minutes" INTEGER NOT NULL DEFAULT 60,
    "late_match_grace_hours" INTEGER NOT NULL DEFAULT 24,
    "heuristic_window_minutes" INTEGER NOT NULL DEFAULT 30,
    "heuristic_enabled" BOOLEAN NOT NULL DEFAULT true,
    "amount_tolerance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "require_sender_match" BOOLEAN NOT NULL DEFAULT false,
    "auto_verify_min_confidence" DECIMAL(3,2) NOT NULL DEFAULT 0.90,
    "allowed_providers" "Provider"[] DEFAULT ARRAY['BKASH', 'NAGAD', 'UPAY']::"Provider"[],
    "webhook_timeout_ms" INTEGER NOT NULL DEFAULT 8000,
    "webhook_max_attempts" INTEGER NOT NULL DEFAULT 8,
    "rate_limit_register_rpm" INTEGER NOT NULL DEFAULT 120,
    "sms_retention_days" INTEGER NOT NULL DEFAULT 180,
    "notify_on_expiry" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_review" BOOLEAN NOT NULL DEFAULT true,
    "review_sla_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_devices" INTEGER NOT NULL DEFAULT 1,
    "max_sms_per_day" INTEGER NOT NULL DEFAULT 2000,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "key_type" "KeyType" NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "key_hash" VARCHAR(97) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMPTZ(3),
    "last_used_ip" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "device_name" VARCHAR(80) NOT NULL,
    "install_id" UUID NOT NULL,
    "model" VARCHAR(80),
    "manufacturer" VARCHAR(80),
    "android_version" VARCHAR(40),
    "app_version" VARCHAR(40),
    "wallet_msisdn" VARCHAR(20),
    "token_hash" VARCHAR(97) NOT NULL,
    "token_issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token_rotated_at" TIMESTAMPTZ(3),
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "last_sms_at" TIMESTAMPTZ(3),
    "battery_pct" INTEGER,
    "is_ignoring_battery_opt" BOOLEAN,
    "has_sms_permission" BOOLEAN,
    "network_type" VARCHAR(20),
    "clock_skew_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profiles" (
    "provider" "Provider" NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "sender_addresses" TEXT[],
    "msisdn_prefixes" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "parser_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "Provider" NOT NULL,
    "version" INTEGER NOT NULL,
    "rule" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(80),
    "fixture_pass_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parser_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "device_id" UUID,
    "client_msg_hash" CHAR(64) NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "sms_address" VARCHAR(32) NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'UNKNOWN',
    "raw_message" TEXT NOT NULL,
    "transaction_id" VARCHAR(64),
    "amount" DECIMAL(14,2),
    "sender_msisdn" VARCHAR(20),
    "balance_after" DECIMAL(14,2),
    "fee" DECIMAL(14,2),
    "sms_timestamp" TIMESTAMPTZ(3),
    "device_received_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parse_status" "ParseStatus" NOT NULL DEFAULT 'UNPARSED',
    "parser_rule_version" INTEGER,
    "parse_confidence" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "match_status" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "upload_source" "UploadSource" NOT NULL DEFAULT 'REALTIME',
    "flags" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "order_id" VARCHAR(80) NOT NULL,
    "transaction_id" VARCHAR(64),
    "expected_amount" DECIMAL(14,2) NOT NULL,
    "expected_provider" "Provider",
    "expected_sender_msisdn" VARCHAR(20),
    "callback_url" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "match_mode" "MatchMode" NOT NULL,
    "amount_tolerance" DECIMAL(14,2) NOT NULL,
    "metadata" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "sms_log_id" UUID NOT NULL,
    "verification_method" "VerificationMethod" NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "amount_delta" DECIMAL(14,2) NOT NULL,
    "matched_by_admin_id" UUID,
    "was_late" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "payment_request_id" UUID,
    "event_type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "request_url" TEXT NOT NULL,
    "request_headers" JSONB NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "error_class" VARCHAR(20),
    "duration_ms" INTEGER,
    "attempted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sms_log_id" UUID,
    "payment_request_id" UUID,
    "reason" "ReviewReason" NOT NULL,
    "candidates" JSONB NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "match_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "trigger" "MatchTrigger" NOT NULL,
    "sms_log_id" UUID,
    "payment_request_id" UUID,
    "result" "MatchResult" NOT NULL,
    "pass" "MatchPass" NOT NULL DEFAULT 'NONE',
    "guard_failed" VARCHAR(64),
    "candidates" JSONB,
    "chosen_score" DECIMAL(3,2),
    "runner_up_score" DECIMAL(3,2),
    "parser_rule_version" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(97) NOT NULL,
    "totp_secret_enc" BYTEA,
    "totp_enrolled_at" TIMESTAMPTZ(3),
    "recovery_codes_hash" TEXT[],
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "last_login_ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "session_family" UUID NOT NULL,
    "token_hash" VARCHAR(97) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_type" "ActorType" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60),
    "entity_id" VARCHAR(80),
    "before" JSONB,
    "after" JSONB,
    "company_id" UUID,
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(160),
    "outcome" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(80),
    "company_id" UUID,
    "ip" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "endpoint" VARCHAR(80) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "state" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_company_code_key" ON "companies"("company_code");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_company_id_key_type_idx" ON "api_keys"("company_id", "key_type");

-- CreateIndex
CREATE UNIQUE INDEX "devices_install_id_key" ON "devices"("install_id");

-- CreateIndex
CREATE INDEX "devices_company_id_status_idx" ON "devices"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parser_rules_provider_version_key" ON "parser_rules"("provider", "version");

-- CreateIndex
CREATE INDEX "sms_logs_company_id_transaction_id_idx" ON "sms_logs"("company_id", "transaction_id");

-- CreateIndex
CREATE INDEX "sms_logs_company_id_match_status_sms_timestamp_idx" ON "sms_logs"("company_id", "match_status", "sms_timestamp" DESC);

-- CreateIndex
CREATE INDEX "sms_logs_company_id_amount_sms_timestamp_idx" ON "sms_logs"("company_id", "amount", "sms_timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "sms_logs_company_id_client_msg_hash_key" ON "sms_logs"("company_id", "client_msg_hash");

-- CreateIndex
CREATE INDEX "payment_requests_company_id_status_expires_at_idx" ON "payment_requests"("company_id", "status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_company_id_order_id_key" ON "payment_requests"("company_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "verified_transactions_payment_request_id_key" ON "verified_transactions"("payment_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "verified_transactions_sms_log_id_key" ON "verified_transactions"("sms_log_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_next_attempt_at_idx" ON "webhook_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_events_company_id_created_at_idx" ON "webhook_events"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_event_id_attempt_no_idx" ON "webhook_deliveries"("event_id", "attempt_no");

-- CreateIndex
CREATE INDEX "match_reviews_company_id_status_created_at_idx" ON "match_reviews"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "match_attempts_sms_log_id_created_at_idx" ON "match_attempts"("sms_log_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "match_attempts_payment_request_id_created_at_idx" ON "match_attempts"("payment_request_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "match_attempts_company_id_result_created_at_idx" ON "match_attempts"("company_id", "result", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_session_family_idx" ON "admin_sessions"("session_family");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_created_at_idx" ON "audit_logs"("actor_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_company_id_created_at_idx" ON "audit_logs"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "auth_attempts_kind_created_at_idx" ON "auth_attempts"("kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "auth_attempts_subject_created_at_idx" ON "auth_attempts"("subject", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_company_id_endpoint_key_key" ON "idempotency_keys"("company_id", "endpoint", "key");

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parser_rules" ADD CONSTRAINT "parser_rules_provider_fkey" FOREIGN KEY ("provider") REFERENCES "provider_profiles"("provider") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_transactions" ADD CONSTRAINT "verified_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_transactions" ADD CONSTRAINT "verified_transactions_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_transactions" ADD CONSTRAINT "verified_transactions_sms_log_id_fkey" FOREIGN KEY ("sms_log_id") REFERENCES "sms_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
