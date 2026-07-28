-- Correctness invariants (architecture.md §14). The DB constraints make most of
-- these unreachable; this is the periodic tripwire that proves it. The canonical
-- runner is modules/matching/invariants.service.ts (kept in sync with this file);
-- these queries are here for manual inspection and for the runbook.
-- Each block returns the offending row ids for one named check.

-- verified_order_without_verification
SELECT id FROM payment_requests
 WHERE status = 'VERIFIED'
   AND id NOT IN (SELECT payment_request_id FROM verified_transactions);

-- verification_on_unverified_order
SELECT vt.id FROM verified_transactions vt
  JOIN payment_requests pr ON pr.id = vt.payment_request_id
 WHERE pr.status <> 'VERIFIED';

-- matched_sms_without_verification
SELECT id FROM sms_logs
 WHERE match_status = 'MATCHED'
   AND id NOT IN (SELECT sms_log_id FROM verified_transactions);

-- duplicate_live_trxid  (the partial unique index should make this impossible)
SELECT (array_agg(id))[1] FROM payment_requests
 WHERE transaction_id IS NOT NULL AND status IN ('PENDING', 'VERIFIED')
 GROUP BY company_id, transaction_id
HAVING count(*) > 1;

-- verification_amount_delta_null
SELECT id FROM verified_transactions WHERE amount_delta IS NULL;
