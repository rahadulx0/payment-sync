# Capacity

Measured headroom for the single-VPS deployment (ADR-10). This file replaces the estimate in
`architecture.md §16.4` with evidence — **once the measurements are taken**.

## Scenarios (`test/load/`)

| Scenario         | Shape                                                                                   | Thresholds                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `steady.js`      | 3× expected peak, 30 min, mixed register + poll                                         | p95 register < 300 ms · p95 poll < 300 ms · zero 5xx                                           |
| `burst.js`       | 10 devices × 50-message batches inside one minute (phones reconnecting after an outage) | p95 upload < 800 ms · zero 5xx · **no duplicate verifications** · queue drains after the burst |
| `collision.js`   | 50 concurrent registers with colliding amounts (heuristic stress)                       | zero false verifications · reviews created instead of guesses                                  |
| `slow-client.js` | One tenant's webhook endpoint takes 8 s while others are served                         | other tenants' p95 time-to-delivery unaffected (per-company concurrency cap)                   |

Run against **staging**, never production:

```bash
k6 run -e BASE_URL=https://staging-api.example.com \
       -e SERVER_KEY=psk_live_... -e COMPANY_CODE=COMP-XXXX test/load/steady.js
```

## Results

**Not yet measured** — this requires the staging VPS from Task 16. Fill in:

| Metric                                     | Target   | Measured | Headroom |
| ------------------------------------------ | -------- | -------- | -------- |
| p95 register                               | < 300 ms |          |          |
| p95 upload (50-msg batch)                  | < 800 ms |          |          |
| p95 webhook time-to-delivery under load    | < 30 s   |          |          |
| Sustained registers/min at 70% CPU         | —        |          |          |
| Peak memory (api ×2 + worker + pg + redis) | < 6 GB   |          |          |
| Postgres size growth per 10k verifications | —        |          |          |

## Supported client count

State this **with the measured numbers**, not an estimate, once the runs are done. The limiting factor
is expected to be Postgres write throughput on the money path plus webhook delivery concurrency, not the
API tier — but that is a hypothesis until `steady.js` and `burst.js` have run.

## What the numbers must not hide

- **Zero invariant violations** during and after every run. A fast system that double-credits is worse
  than a slow one.
- **No duplicate verifications** in the burst scenario — that is the whole point of the double-UNIQUE
  constraints and the per-company advisory lock.
- **No queue growth at steady state.** A backlog that clears "eventually" is a merchant waiting.
