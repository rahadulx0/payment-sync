# Task 12 — Admin Dashboard II: Operations Screens

| | |
|---|---|
| **Track** | Web |
| **Depends on** | 10, 11 |
| **Unblocks** | 17 |
| **Est. effort** | 5–6 days |
| **Risk** | Medium — these screens are how every support question gets answered; weak ones cost hours per incident forever |

---

## 1. Objective

Build the operational half of the dashboard from `architecture.md §12`: transaction monitoring with a
**decision trace** that answers "why wasn't this order verified?" in one screen, the review queue,
webhook monitoring with retry/replay, parser health, and the analytics overview.

The measure of success for this task is not screen count — it is that a merchant's question
("customer paid, order still pending") is answerable in under 60 seconds without touching the database.

---

## 2. Scope of work

### In scope
- Overview home: KPI tiles, alert strip, invariant status, quick links.
- Transactions: four tabs (SMS logs, Pending, Verified, Failed/Unmatched) with search and filters.
- Transaction drill-down: raw SMS beside server extraction beside decision trace, with actions
  (re-parse, manual verify, reject, void verification).
- Review queue with ranked candidates, score breakdowns, and link/dismiss resolution.
- Webhook monitoring: events, attempt history, retry, bulk replay, endpoint health, breaker state.
- Parser health: unparsed/partial queue grouped by shape, rule versions, dry-run + activate.
- Analytics: charts for daily volume, provider split, funnel, verification methods, latency; company
  league table.
- CSV export of the current filtered view (operational necessity for reconciliation questions).

### Out of scope
- Merchant-facing dashboards → post-v1.
- New backend endpoints — everything consumed here exists after Tasks 05/08/09/10. If a screen needs
  something that doesn't exist, add it to the owning backend task rather than querying around it.

---

## 3. Prerequisites

- Task 11: shell, auth, UI kit, generated client, Playwright harness.
- Task 10: analytics + reviews endpoints. Task 09: webhook admin endpoints.
  Task 08: `match_attempts` trace, invariants, void endpoint. Task 05: parser health, re-parse, rules.

---

## 4. Implementation steps

### 4.1 Overview home (`(dash)/page.tsx`)
- **Alert strip first** (above KPIs), showing only what needs action, each linking to the fix:
  invariant violations (P1, red), dead webhooks, devices offline in Dhaka business hours, open reviews
  breaching SLA, unparsed-message backlog, companies with a suspended/expiring credential.
  If nothing is wrong, a single quiet "all clear" line with the `as_of` time — the screen must not cry
  wolf, or the strip stops being read.
- KPI tiles from `/admin/analytics/overview`: verified today (count + amount), success rate,
  median verification latency, median SMS→webhook latency, pending orders, unmatched SMS,
  devices online/total, open reviews. Each tile links to the filtered list behind it.
- Today's timeline chart (hourly verified count) and the top-5 companies by volume.
- Auto-refresh 30 s with a visible `as_of` timestamp and a manual refresh; never silently stale.

### 4.2 Transactions (`(dash)/transactions/`)
Shared filter bar across tabs (company, provider, date range with Dhaka presets, amount range, free-text
`q`) persisted in the URL.

| Tab | Columns |
|---|---|
| **SMS logs** | received (device time / server time), company, device, provider, address, amount, TrxID, parse status + confidence, match status, flags, upload source |
| **Pending** | order id, company, amount, TrxID or "—", match mode, age, expires in, callback host, sender hint |
| **Verified** | order id, company, amount, delta, provider, method, confidence, verified at, latency (SMS→verified), webhook state, was-late badge |
| **Failed / Unmatched** | for SMS: unmatched/ignored/duplicate + reason; for orders: expired/cancelled/rejected + age. Sorted by "most likely to need action" (unmatched credit SMS with a plausible pending order first) |

Free-text search maps to the Task 05/10 endpoints across TrxID, MSISDN, order id, and raw body
(trigram-indexed in Task 02). Debounced, with a result count and a "searching raw message bodies"
indicator since that path is slower.

### 4.3 Transaction drill-down — the decision trace screen
The single most important screen in the dashboard. Three panels:

1. **Left — the message as received**: `sms_address`, raw body in a monospace block (verbatim, with a
   "copy" and a masked-digits toggle for screen-sharing), device + company, device/server timestamps
   with skew, upload source, `client_msg_hash`, flags.
2. **Middle — server extraction**: provider, TrxID, amount (via the `Money` component), sender,
   balance, fee, parsed timestamp, `parse_status`, confidence, `parser_rule_version`, and — when
   present — the **device hint vs server result diff** highlighted.
3. **Right — decision trace** from `match_attempts`, one card per attempt, newest first:
   trigger, pass (EXACT/HEURISTIC/NONE), result, guard that rejected (in plain language:
   "Ignored: this is an outgoing payment (Cash Out), not an incoming one"), the ranked candidate table
   with per-signal score breakdown and the `why` strings from Task 10, chosen vs runner-up scores, and
   duration. Below it: the linked verification (if any) and the webhook event with its delivery
   attempts.

Actions (each behind a confirm, each audited server-side):
- **Re-parse** → shows the before/after diff and whether it triggered a rescan.
- **Manually verify** → order picker restricted to that company's plausible orders (amount/date
  ranked), mandatory note, explicit warning that this asserts a real payment.
- **Reject / Ignore** → mark an SMS as not a payment.
- **Void verification** → the dangerous one: typed confirmation, mandatory reason, and inline text
  stating that the order returns to `PENDING` and the client may be notified.
- **Copy support bundle** → one button producing a redacted text block (ids, timestamps, statuses,
  trace summary, `request_id`s) to paste into a client conversation.

Mirror the same drill-down for an **order**: registration payload (metadata included), state history,
candidate SMS considered, verification, webhook attempts, and "why not verified" derived from the
latest `match_attempts` for its candidates.

### 4.4 Review queue (`(dash)/reviews/`)
- List: oldest first, with reason, company, age (red past SLA), amount, and candidate count.
- Detail: the SMS panel from §4.3 on the left; on the right, the ranked candidate orders as cards
  showing amount (and delta), created time (and Δ from the SMS), sender match, provider match, score
  with the signal breakdown bar, and the `why` lines. Each card has **Link this order**.
- Resolution: link (with mandatory note) or dismiss (reason + note). Optimistic-free: wait for the
  server, then show the resulting verification and webhook state inline.
- Keyboard workflow (`j`/`k` to move, `Enter` to open, `1`–`5` to select a candidate, `d` to dismiss)
  — the review queue is the one screen that gets used under time pressure.
- Conflict handling: if the order was verified/cancelled meanwhile, show the Task 10 conflict clearly
  and refresh, never a generic error toast.

### 4.5 Webhooks (`(dash)/webhooks/`)
- Events list: company, order, type, status (with attempt count), created, delivered, next attempt
  countdown, last error class. Filters incl. `DEAD` and `paused`.
- Event detail: the exact `payload_raw` sent, the headers (secret-redacted), and every attempt with
  status, error class, latency, and response excerpt. A "signature we sent / expected `v1`" block for
  debugging client verification.
- Actions: retry now (appends an attempt), cancel event, bulk **replay dead** with a dry-run count and
  typed confirmation.
- Endpoint health per company: success rate (24 h / 7 d), p95 latency, consecutive failures, breaker
  state with time-to-close, last success. A breaker-open row is visually loud.

### 4.6 Parser health (`(dash)/parsers/`)
- Per-provider cards: active rule version, parse success rate, ignored rate, hint-mismatch rate,
  fixture pass count, last activation.
- **Unparsed queue grouped by normalised shape** (Task 05) with counts — click to expand samples.
  This is the parser-improvement workflow: see the shape, copy a sample, add a fixture, ship a rule.
- Rule versions list with dry-run (against fixtures + last 500 real messages) and activate; activation
  refused on regression, with the failing fixture named. After activation, an inline
  "bulk re-parse affected messages" action with progress.

### 4.7 Analytics (`(dash)/analytics/`)
Charts (client-rendered, no external CDN — self-contained per the platform's CSP):
daily registered/verified/expired stacked bars with a success-rate line; provider split;
verification-method split; funnel (registered → SMS seen → matched → delivered) with drop-off reasons;
latency percentiles over time; company league table with sortable columns.
Every chart: Dhaka day boundaries, a visible date range, an `as_of` stamp, an accessible data-table
fallback, and a CSV export of the underlying rows.

### 4.8 Cross-cutting
- CSV export on every list view, exporting the **current filter** (server-side, streamed, capped at
  100k rows with a clear notice when truncated).
- Deep links everywhere: company → its transactions; device → its SMS; order → its webhook event;
  audit row → the entity it touched. Support work is navigation, so make navigation the feature.
- Invariant status tile (Task 08 `/admin/invariants`) with the offending rows and the runbook link.
- Empty states that teach ("No unmatched SMS — this is the healthy state").

---

## 5. Files created / modified

```
apps/admin/app/(dash)/page.tsx                                  # overview + alert strip
apps/admin/app/(dash)/transactions/{page.tsx,sms/[id]/page.tsx,orders/[id]/page.tsx}
apps/admin/app/(dash)/reviews/{page.tsx,[id]/page.tsx}
apps/admin/app/(dash)/webhooks/{page.tsx,[id]/page.tsx,health/page.tsx}
apps/admin/app/(dash)/parsers/{page.tsx,rules/[provider]/page.tsx}
apps/admin/app/(dash)/analytics/page.tsx
apps/admin/components/ops/{alert-strip.tsx,kpi-tile.tsx,decision-trace.tsx,candidate-card.tsx,
                           raw-sms-panel.tsx,extraction-panel.tsx,attempt-timeline.tsx,
                           support-bundle.tsx,csv-export.tsx,invariant-tile.tsx,
                           breaker-badge.tsx,unparsed-group.tsx}
apps/admin/components/charts/{daily-volume.tsx,provider-split.tsx,funnel.tsx,latency.tsx,
                              method-split.tsx,chart-primitives.tsx}
apps/admin/e2e/{overview.spec.ts,transactions.spec.ts,decision-trace.spec.ts,reviews.spec.ts,
                webhooks.spec.ts,parsers.spec.ts,analytics.spec.ts,a11y-ops.spec.ts}
apps/admin/test/fixtures/seed-ops-state.ts     # scripted DB state for deterministic screen tests
docs/admin-guide.md                            # support playbooks per screen
docs/runbook.md                                # link runbook procedures to the screens that perform them
```

---

## 6. Testing & validation

| What | How |
|---|---|
| **The 60-second test** (headline acceptance) | Seed six failure states: (a) unmatched credit SMS with no order, (b) order pending with no SMS, (c) debit SMS ignored, (d) amount-mismatch review, (e) ambiguous two-candidate review, (f) dead webhook. For each, a Playwright test navigates from the overview to a screen that states the cause in plain language, asserting the explanatory text is present. If a state can't be explained on screen, the task isn't done. |
| Decision trace | For each seeded state, the trace panel shows trigger, pass, result, guard/why, candidates with scores, and the linked webhook attempts; a guard rejection renders as human language, not an enum. |
| Actions | Re-parse shows a diff and triggers a rescan; manual verify requires a note and produces a verification + webhook; void requires typed confirmation and reverts state; reject marks the SMS ignored. Each asserted through the UI and verified in the DB. |
| Review workflow | Link the correct candidate → verification with `MANUAL_ADMIN` + webhook delivered; dismiss → SMS re-matchable; keyboard shortcuts work; a conflicting resolve (order cancelled in another tab) surfaces a clear conflict and refreshes. |
| Webhooks | Attempt history matches the DB; retry appends rather than resets; bulk replay dry-run count equals the actual replay count; breaker-open row is visually distinct (snapshot test). |
| Parser health | Unparsed grouping shows counts; dry-run of a regressive rule is refused with the failing fixture named; activation bumps the version and offers bulk re-parse with progress. |
| Analytics correctness | Every chart's underlying numbers equal the API response, and the API is already reconciled against SQL in Task 10; day-boundary case at 23:59/00:01 Dhaka renders in the correct bucket. |
| CSV export | Respects active filters; row count matches the list; truncation notice appears past the cap; opens cleanly in Excel (UTF-8 BOM, quoted fields, amounts as text to prevent spreadsheet rounding). |
| Search | TrxID, MSISDN, order id, and raw-body substring each return the expected row; debounce prevents request storms; a slow raw-body search shows its indicator. |
| Money rendering | A property-style test over odd amounts (`0.05`, `1250.00`, `99999999.99`) asserts exact string rendering — the UI must never introduce float artifacts. |
| Redaction | No screen renders a webhook secret, API key, or device token; masked-digits toggle works for screen sharing; support bundle is redacted. |
| a11y & performance | axe clean on every route; charts have table fallbacks; a 5000-row list stays interactive (virtualised or server-paged); slow-network run shows skeletons. |

**Smoke demo:** with the six seeded failure states, walk the screens narrating the diagnosis of each in
under a minute apiece; then resolve the ambiguous review and show the webhook arriving at the local
receiver.

---

## 7. Acceptance criteria

- [ ] Overview shows an actionable alert strip (quiet when healthy), KPI tiles matching the analytics API, invariant status, and `as_of` freshness.
- [ ] All four transaction tabs implemented with shared URL-persisted filters and working search across TrxID / MSISDN / order id / raw body.
- [ ] The drill-down shows raw SMS, server extraction, hint diff, and the full `match_attempts` trace with candidate scores and human-readable guard explanations.
- [ ] Every seeded failure state in the "60-second test" is explained on screen and the Playwright assertions for the explanatory text pass.
- [ ] Re-parse, manual verify, reject, and void all work from the UI with confirmations, notes, and server-side audit rows.
- [ ] Review queue supports ranked candidates with score breakdowns, link/dismiss with mandatory notes, keyboard workflow, and correct conflict handling.
- [ ] Webhook screens show payload, redacted headers, and full attempt history; retry appends; bulk replay has a dry run; breaker state is prominent.
- [ ] Parser health shows grouped unparsed messages with counts and supports dry-run → activate → bulk re-parse, with regressions refused.
- [ ] All analytics charts render correct, timezone-correct values with accessible table fallbacks and CSV export.
- [ ] CSV export respects filters, is Excel-safe, and states truncation.
- [ ] No secret material is rendered anywhere; masked-digits toggle and redacted support bundle work.
- [ ] axe clean on all routes; large lists remain responsive.
- [ ] `docs/admin-guide.md` contains a support playbook per screen, and `docs/runbook.md` links procedures to the screens that execute them.

---

## 8. Risks & notes

- **This task is where operational cost is decided.** Every gap here becomes a `psql` session at
  10pm. The "60-second test" is deliberately written as an acceptance gate rather than a nice-to-have.
- Do not add backend endpoints from the frontend task. If a screen needs data that doesn't exist,
  the honest move is a small addendum PR to the owning backend task (with its tests) — otherwise
  you get untested SQL living in a React server component.
- Charts must be self-contained (no CDN) to match the platform's CSP posture, and must have table
  fallbacks: at 2am on a phone, a table beats a chart anyway.
- Money rendering deserves its own test even in the UI. A `toFixed(2)` on a float somewhere in a chart
  tooltip is exactly the kind of thing that erodes trust in the numbers.
- Resist making the review queue "smarter" with client-side heuristics. Scoring lives in Task 10, on
  the server, where it is tested adversarially; the UI's job is to present it faithfully.
