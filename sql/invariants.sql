-- Correctness invariants (architecture.md §9.4). Each query returns the
-- offending rows; an empty result means healthy. Run every 15 min by the
-- worker (Task 08/16) and surfaced on the dashboard (Task 12). A non-empty
-- result from any of these is a P1 incident.

-- 1. Every VERIFIED order has exactly one verified_transactions row.
SELECT pr.id AS payment_request_id
FROM payment_requests pr
LEFT JOIN verified_transactions vt ON vt.payment_request_id = pr.id
WHERE pr.status = 'VERIFIED'
GROUP BY pr.id
HAVING count(vt.id) <> 1;

-- 2. No SMS appears in more than one verification (defensive; the UNIQUE prevents it).
SELECT sms_log_id, count(*) AS n
FROM verified_transactions
GROUP BY sms_log_id
HAVING count(*) > 1;

-- 3. No MATCHED sms_log lacks a verification row.
SELECT s.id AS sms_log_id
FROM sms_logs s
LEFT JOIN verified_transactions vt ON vt.sms_log_id = s.id
WHERE s.match_status = 'MATCHED' AND vt.id IS NULL;

-- 4. No PENDING order is past expires_at + late_match_grace_hours.
SELECT pr.id AS payment_request_id
FROM payment_requests pr
JOIN company_settings cs ON cs.company_id = pr.company_id
WHERE pr.status = 'PENDING'
  AND pr.expires_at + make_interval(hours => cs.late_match_grace_hours) < now();

-- 5. No verification's amount_delta exceeds the order's tolerance.
SELECT vt.id AS verified_transaction_id
FROM verified_transactions vt
JOIN payment_requests pr ON pr.id = vt.payment_request_id
WHERE abs(vt.amount_delta) > pr.amount_tolerance;
