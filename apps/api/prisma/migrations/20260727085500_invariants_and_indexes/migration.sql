-- Correctness invariants that Prisma cannot express in the datamodel
-- (architecture.md §6, §9.4, §14). Reviewed as SQL, not just a schema diff.
-- The single-column UNIQUEs on verified_transactions (one order once, one SMS
-- once) are already emitted by the init migration from the Prisma @unique
-- attributes; this migration adds the partial indexes, CHECKs, trigram search
-- indexes, and the updated_at trigger.

-- Two LIVE orders can never claim the same TrxID (architecture §6.5).
CREATE UNIQUE INDEX "payment_requests_company_txn_live_uq"
  ON "payment_requests" ("company_id", "transaction_id")
  WHERE "transaction_id" IS NOT NULL AND "status" IN ('PENDING', 'VERIFIED');

-- Heuristic candidate scan touches only PENDING rows (architecture §6.5).
CREATE INDEX "payment_requests_company_amount_pending_idx"
  ON "payment_requests" ("company_id", "expected_amount", "created_at")
  WHERE "status" = 'PENDING';

-- Parser-improvement queue (architecture §6.4).
CREATE INDEX "sms_logs_parse_status_idx"
  ON "sms_logs" ("parse_status")
  WHERE "parse_status" IN ('UNPARSED', 'PARTIAL');

-- Money & callback sanity (architecture §6.5/§6.6).
ALTER TABLE "payment_requests"
  ADD CONSTRAINT "pr_amount_positive" CHECK ("expected_amount" > 0);
ALTER TABLE "payment_requests"
  ADD CONSTRAINT "pr_tolerance_nonneg" CHECK ("amount_tolerance" >= 0);
ALTER TABLE "sms_logs"
  ADD CONSTRAINT "sms_amount_nonneg" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "verified_transactions"
  ADD CONSTRAINT "vt_confidence_range" CHECK ("confidence" > 0 AND "confidence" <= 1);
ALTER TABLE "payment_requests"
  ADD CONSTRAINT "pr_callback_https" CHECK ("callback_url" LIKE 'https://%');

-- A review row must name at least one subject (architecture §6.8).
ALTER TABLE "match_reviews"
  ADD CONSTRAINT "mr_subject_present"
  CHECK ("sms_log_id" IS NOT NULL OR "payment_request_id" IS NOT NULL);

-- At most one OPEN review per (sms, order) pair — stops rescans spamming the queue.
CREATE UNIQUE INDEX "match_reviews_open_uq"
  ON "match_reviews" (
    COALESCE("sms_log_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("payment_request_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "status" = 'OPEN';

-- Admin free-text search over TrxID / raw body (architecture §6.4).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "sms_logs_raw_trgm" ON "sms_logs" USING gin ("raw_message" gin_trgm_ops);
CREATE INDEX "sms_logs_txn_trgm" ON "sms_logs" USING gin ("transaction_id" gin_trgm_ops);

-- updated_at maintained at the DB level too, so raw-SQL updates stay correct.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "companies"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "company_settings"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "api_keys"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "devices"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "provider_profiles"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "sms_logs"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "payment_requests"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "webhook_events"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "match_reviews"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE INSERT OR UPDATE ON "admin_users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
