# Task 05 — SMS Parsing Subsystem

| | |
|---|---|
| **Track** | Core |
| **Depends on** | 03 (can start in parallel with 04) |
| **Unblocks** | 06, 08, 13 |
| **Est. effort** | 4–5 days |
| **Risk** | **High** — parser accuracy *is* the product, and the real SMS corpus is the project's biggest unknown (`architecture.md §20.2`) |

---

## 1. Objective

Implement the versioned, data-driven SMS parsing subsystem from `architecture.md §8`: a shared rule
format, a fixture-gated reference implementation, the server-authoritative parser service, and the
re-parse tooling that turns a parser gap into a delayed verification rather than a lost one.

Critically: **debit messages (Cash Out / Send Money sent) must never be treated as incoming payments.**

---

## 2. Scope of work

### In scope
- `packages/parsers`: rule schema, rules for bKash / Nagad / Upay, normalizers, reference parser,
  fixture corpus + runner, exported artifacts for Android.
- `apps/api` `ParserService`: loads active rules from `parser_rules`, resolves provider from
  `sms_address`, parses, sets `parse_status`/`confidence`/`parser_rule_version`, records flags.
- Debit/direction detection and `IGNORED` classification.
- Hint-comparison metric (device parse vs server parse).
- Admin endpoints: single re-parse with diff, bulk re-parse job, unparsed queue query, rule
  management (list versions, activate, dry-run against fixtures + historical messages).
- Rule versioning discipline: append-only, history never mutated.

### Out of scope
- Kotlin parser implementation → Task 13 (this task produces the shared rules + fixtures it must match).
- Matching → Task 08. Device upload endpoint → Task 06.
- OCR / notification-listener capture → post-v1.

---

## 3. Prerequisites

- Task 03: config, Prisma, metrics registry, admin guard.
- Task 02: `provider_profiles`, `parser_rules` tables + placeholder rows.
- Task 01: `Money`, `parseProviderTimestamp`.
- **Input needed:** as many genuine SMS bodies as obtainable (see §8). Provisional rules are built
  from `plan.md §3` samples plus documented variants; the corpus is expanded during pilot (Task 17).

---

## 4. Implementation steps

### 4.1 Rule schema (`packages/parsers/src/types.ts` + `rule.schema.ts`)
Zod schema for exactly the format in `architecture.md §8.2`, with these semantics nailed down:
- `message_types[]` evaluated **in order**; first match wins; each has
  `type`, `direction: CREDIT|DEBIT|INFO`, `must_contain[]`, `must_not_contain[]`,
  `patterns{}`, `timestamp_formats[]`, `required[]`.
- Named capture group or group 1 per pattern; all regexes compiled with `u` and **without** `g`
  (stateful regex reuse is a classic bug source), and validated at load time.
- **ReDoS guard:** rule loading rejects patterns with nested unbounded quantifiers via a
  `safe-regex`-style check plus a compile-time timing probe (each pattern must complete under 5 ms on
  a 1 KB adversarial input). A rule that fails validation cannot be activated.
- `version` monotonic per provider; `is_active` at most one per provider (enforced by a partial
  unique index — add in this task's migration).

### 4.2 Normalizers (`packages/parsers/src/normalize.ts`)
Pure, individually tested:
- `normalizeAmount` → `Money` (delegates to Task 01; handles `Tk`/`BDT`/`৳`, commas, spaces,
  Bengali digits, 1–2 decimals, and rejects anything ambiguous).
- `normalizeMsisdn` → `+8801XXXXXXXXX` from `01XXXXXXXXX`, `8801…`, `+8801…`, `০১…`; rejects
  invalid operator prefixes (`01[3-9]`).
- `normalizeTrxId` → uppercase, strip surrounding punctuation, validate `[A-Z0-9]{6,20}`;
  reject values that are obviously not TrxIDs (all digits and length ≤5, or equal to the amount).
- `normalizeTimestamp` → UTC via `Asia/Dhaka`, multi-format, 2-digit-year pivot, rejects >24 h in
  the future.
- `normalizeBody` → the canonical form used for `content_hash`: trim, collapse internal whitespace,
  NFKC. **Must not** lowercase (case carries signal, e.g. `TrxID`).

### 4.3 Reference parser (`packages/parsers/src/parse.ts`)
```ts
parse({ rules, smsAddress, body, now }): ParseResult
// ParseResult =
//  { status: 'PARSED'|'PARTIAL'|'UNPARSED'|'IGNORED',
//    provider, messageType, direction,
//    fields: { amount?, transactionId?, senderMsisdn?, balanceAfter?, fee?, timestamp? },
//    confidence: 0..1, ruleVersion, ignoredReason?, unmatchedPatterns: string[] }
```
- Pure: no clock, no I/O, no globals (`now` is injected — enforced by the Task 01 ESLint rule).
- Provider resolution: `sms_address` against `provider_profiles.sender_addresses`
  (case-insensitive exact, then documented normalisation for numeric shortcodes) → `UNKNOWN` if none.
- `direction != CREDIT` → `IGNORED` with `ignoredReason: 'DEBIT_MESSAGE' | 'INFO_MESSAGE'`.
  **This check happens before field extraction** so a Cash Out SMS can never produce a matchable record.
- Confidence: 1.0 when all `required` fields plus `timestamp` extracted and the message type matched
  on a `must_contain` anchor; −0.15 per missing optional field; `PARTIAL` when a `required` field is
  missing (still stored, still surfaced in the unparsed queue).
- Returns `unmatchedPatterns` so the admin UI can show exactly which regex failed.

### 4.4 Fixture corpus (`packages/parsers/fixtures/`)
One JSON file per provider, each entry `{id, address, body, now, expected}`. Required coverage per
provider — this list is the acceptance gate:

| Category | Why it must be there |
|---|---|
| Cash In / Payment received / Money received (all wordings) | the core positive cases |
| Amount formats: `1,250.00`, `1250`, `1250.5`, `Tk 1,250.00`, `BDT 300.00` | real variance |
| Bengali digits / Bengali body variant | real messages appear localised |
| **Cash Out sent, Send Money sent, Payment made** | must be `IGNORED` — false-positive source #1 |
| Balance/statement/promotional/OTP messages | must be `IGNORED`/`UNPARSED`, never matched |
| Missing TrxID, missing amount | must be `PARTIAL`, not silently zero |
| Truncated / concatenated multi-part SMS | must not produce a wrong amount |
| Timestamp `dd/MM/yyyy HH:mm` and `dd/MM/yy HH:mm`, and absent | format tolerance |
| Same TrxID with different casing/spacing | normalisation |
| Agent-account vs personal-account wording (`architecture.md §20.3`) | both are in scope for v1 |
| Adversarial: a personal SMS *quoting* a payment message | address allowlist + anchors must reject |

Runner: `fixtures.spec.ts` iterates every entry and asserts the **whole** `ParseResult`, not just
one field. A fixture without an `expected` block fails the suite (no silent placeholders).

### 4.5 Android export
- `pnpm --filter parsers export:android` writes:
  - `apps/android/app/src/main/assets/parser-rules-bundled.json` (the fallback bundle shipped in the
    APK; devices fetch fresher rules via `/device/config`),
  - `apps/android/app/src/androidTest/assets/parser-fixtures.json`.
- CI runs this and fails if the committed artifacts differ from the generated ones — that is the
  mechanism keeping Kotlin and TypeScript parsers in lockstep (Task 13 asserts parity against them).

### 4.6 Server `ParserService` (`apps/api/src/modules/parsing/`)
1. `RuleRepository` — loads active rules + provider profiles, caches in memory keyed by
   `config_version` (a monotonically increasing value bumped on any rule/profile change and exposed
   via `/device/config`); Redis pub/sub invalidation so both API and worker processes refresh.
2. `ParserService.parseAndPersist(smsLog)`:
   - resolve provider → parse → write `provider`, `transaction_id`, `amount`, `sender_msisdn`,
     `balance_after`, `fee`, `sms_timestamp`, `parse_status`, `parse_confidence`,
     `parser_rule_version`;
   - flags: `SUSPICIOUS_ADDRESS` (address not in any profile), `FUTURE_TIMESTAMP`,
     `DEBIT_MESSAGE`, `UNKNOWN_PROVIDER`, `TRUNCATED_MESSAGE`;
   - compares `parsed_hint` (device) vs server result → increments
     `parser_hint_mismatch_total{provider,field}` and stores a boolean `hint_mismatch` for
     dashboard surfacing. **The hint never influences the outcome** (`architecture.md ADR-5`).
3. Metrics: `sms_parse_failures_total{provider}`, `sms_parse_ignored_total{reason}`,
   `parse_duration_seconds`, `parser_hint_mismatch_total{provider,field}`.
4. Per-message parse budget (10 ms soft, logged if exceeded) so a pathological rule can't stall ingestion.

### 4.7 Re-parse & rule administration
- `POST /admin/sms-logs/:id/reparse` → runs the current active rules, returns a **diff**
  (`before` vs `after` extraction) and applies it; writes an audit row; if the result changes
  `transaction_id`/`amount` and the message is `UNMATCHED`, enqueue a rescan (hook consumed by Task 08).
  Refuses to re-parse a message already linked to a `verified_transactions` row unless
  `?force=true` **and** the verification is voided explicitly (audited) — re-parsing verified money
  silently would be a correctness hole.
- `POST /admin/companies/:id/reparse` (or global with a date range) → enqueues `reparse` batch jobs
  (chunked, rate-limited, progress reported).
- `GET /admin/sms-logs/unparsed?provider=&since=` → the parser-improvement queue, grouped by
  near-duplicate body shape (normalised skeleton with digits masked) so 200 identical failures show
  as one row with a count. This is what makes parser iteration fast.
- `GET /admin/parser-rules` / `POST /admin/parser-rules` (create next version, inactive) /
  `POST /admin/parser-rules/:id/activate` (validates against the full fixture corpus **and** a
  dry-run sample of the last 500 real messages for that provider; refuses activation on any
  regression) / `POST /admin/parser-rules/:id/dry-run`.
- `GET /admin/parser-health` → per provider: parse success rate, ignored rate, hint-mismatch rate,
  active version, fixture pass count, last activation.

---

## 5. Files created / modified

```
packages/parsers/src/{types.ts,rule.schema.ts,normalize.ts,parse.ts,provider-resolve.ts,
                      confidence.ts,export-android.ts,index.ts}
packages/parsers/rules/{bkash.json,nagad.json,upay.json}
packages/parsers/fixtures/{bkash.json,nagad.json,upay.json,adversarial.json}
packages/parsers/test/{fixtures.spec.ts,normalize.spec.ts,rule-schema.spec.ts,redos.spec.ts,
                       direction.spec.ts}
apps/api/src/modules/parsing/{parsing.module.ts,parser.service.ts,rule.repository.ts,
                              reparse.controller.ts,reparse.service.ts,rules.controller.ts,
                              parser-health.service.ts,flags.ts}
apps/api/src/workers/reparse.processor.ts
apps/api/prisma/migrations/000X_active_rule_unique/migration.sql
apps/api/prisma/seed.ts                      # activate v1 rules from packages/parsers
apps/api/test/{parsing.spec.ts,reparse.e2e-spec.ts,rules-admin.e2e-spec.ts}
apps/android/app/src/main/assets/parser-rules-bundled.json      # generated
apps/android/app/src/androidTest/assets/parser-fixtures.json    # generated
docs/parsers.md          # rule format, how to add a provider, how to fix a regex safely
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **Fixture corpus** | 100% pass, whole-`ParseResult` assertions. CI-gating. Every category in §4.4 present per provider (a meta-test asserts category coverage by tag, so the corpus can't silently lose a category). |
| **Debit safety** (highest value) | Every debit/outgoing fixture returns `IGNORED` with the right reason, and `fields` empty of `transaction_id`/`amount` — proving such a message cannot reach the matcher even if a later bug ignores `status`. |
| Normalizers | Property tests: MSISDN round-trip, amount round-trip, TrxID idempotence (`normalize(normalize(x)) === normalize(x)`), timestamp within Dhaka offset. |
| Purity | Same inputs → identical output across 1000 runs; parse called with a frozen `now`; no `Date`/`Math.random` reachable (lint + runtime spy). |
| ReDoS | Adversarial 10 KB inputs against every pattern complete under 50 ms total; a deliberately catastrophic pattern is rejected at rule-load. |
| Rule versioning | Activating v2 leaves existing `sms_logs.parser_rule_version = 1` untouched; two active rules per provider impossible (DB constraint). |
| Re-parse | Fixes a `PARTIAL` row to `PARSED` and returns a correct diff; blocked on verified messages; audited; enqueues a rescan for unmatched rows. |
| Bulk re-parse | 10k rows chunked, progress reported, resumable, does not starve ingestion (concurrency capped). |
| Rule activation gate | An intentionally regressive rule (breaks one fixture) is refused activation, with the failing fixture named. |
| Unparsed grouping | 200 messages differing only in digits group into one row with `count: 200`. |
| Hint comparison | A deliberately wrong device hint is recorded as a mismatch and does **not** change the stored extraction. |
| Android artifact parity | `export:android` output is byte-identical to the committed files (CI gate). |
| Performance | 10k messages parsed in-process under 2 s (≈0.2 ms each); per-message budget logging verified. |

**Smoke demo:** paste the three `plan.md` samples plus one Cash Out message through a small CLI
(`pnpm --filter parsers parse -- --address bKash --body "…"`) showing correct extraction for the
three and `IGNORED/DEBIT_MESSAGE` for the fourth; then re-parse a seeded `PARTIAL` row in the API and
show the diff.

---

## 7. Acceptance criteria

- [ ] Rule format implemented, schema-validated, ReDoS-checked, and documented in `docs/parsers.md`.
- [ ] Rules for bKash, Nagad, Upay covering credit **and** debit/info message types.
- [ ] Fixture corpus covers every category in §4.4 for all three providers; 100% pass; CI-gating; category-coverage meta-test passes.
- [ ] No debit/outgoing/promotional message can produce a matchable extraction — asserted per fixture.
- [ ] Reference parser is pure and deterministic; normalizers property-tested.
- [ ] `ParserService` persists extraction + status + confidence + rule version + flags; provider resolved from `sms_address`.
- [ ] Device `parsed_hint` is recorded and compared but provably cannot influence the stored result.
- [ ] Re-parse (single + bulk) works, is audited, refuses verified messages without explicit force, and enqueues rescans.
- [ ] Rule activation is blocked by any fixture regression or historical-sample regression.
- [ ] Unparsed queue groups near-duplicates with counts; `parser-health` returns per-provider rates.
- [ ] Android artifacts generated and CI-verified as in sync.
- [ ] Parser metrics registered with the exact names from `architecture.md §15.2`.

---

## 8. Risks & notes

- **The corpus is the risk, not the code.** With only the three samples in `plan.md`, v1 rules are
  provisional. Mitigations already built in: rules are data, versioned, hot-swappable via config
  push, and every unparsed message is stored and re-parsable. Plan for at least one rule version bump
  per provider during the Task 17 pilot, and treat `parser-health` as a daily-watch metric.
- **Ask the pilot merchant for a 30-day SMS export** from the wallet number (they can forward or
  screenshot; anonymise the counterpart numbers before committing to fixtures). One real export is
  worth more than a week of guessing at regexes.
- Providers change wording without notice. The P3 alert in Task 16 ("parse failure rate >5% over 6 h")
  is the detection mechanism; `docs/runbook.md` gets the "provider changed their SMS format"
  procedure: capture samples → add fixtures → new rule version → dry-run → activate → bulk re-parse.
- Keep `raw_message` verbatim forever (within retention). Every parser improvement depends on being
  able to re-run rules over history; a normalised-only store would make that impossible.
