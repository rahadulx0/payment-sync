# SMS parsing

Parser rules are **data**, not code (`architecture.md §8`). They live in
[`packages/parsers/rules/*.json`](../packages/parsers/rules), are served to devices via
`/device/config`, and drive the server-authoritative `ParserService`. Adding a provider or fixing a
regex is a rule-version bump + a config push — **no app release**.

## Rule format

A `ProviderRule` has `sender_addresses` (the allowlist) and ordered `message_types`. Each type:

| Field                               | Meaning                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `direction`                         | `CREDIT` \| `DEBIT` \| `INFO`. Only `CREDIT` is ever extracted/matched.              |
| `must_contain` / `must_not_contain` | substring guards; first type whose guards pass wins                                  |
| `patterns`                          | `field → regex` (capture group 1 or a named group); extraction is **label-anchored** |
| `required`                          | fields that must extract, else the result is `PARTIAL`                               |

Evaluation: resolve provider from the address → first matching `message_type` → if not `CREDIT`,
return `IGNORED` **before any field extraction** (a debit can never produce a matchable record) →
otherwise extract + normalise + score.

## bKash (v1) — the two credit flows we support

Both credit the merchant's personal number and both carry a customer-usable `TrxID` (the exact-match key):

- **CASH_IN** — `Cash In Tk {amount} from {agent-msisdn} … TrxID {id} at {dd/MM/yyyy HH:mm}`
- **SEND_MONEY** — `You have received Tk {amount} from {customer-msisdn} … TrxID {id} at {…}`

Amount is anchored to the credit verb so it's never confused with `Fee Tk`/`Balance Tk`. Note the
`from` number is the **agent** for Cash In and the **customer** for Send Money — so sender-MSISDN is a
matching signal only for Send Money (Task 10).

`CASH_OUT`, `SEND_MONEY_SENT` and `PAYMENT` are `DEBIT` types → always `IGNORED`. This is the #1
false-positive guard: the merchant's phone receives outgoing SMS carrying an amount + TrxID too.

**Nagad / Upay are provisional** (debit-ignore guards only; credit messages fall to `UNPARSED` and are
captured in the parser-improvement queue) until a real corpus arrives.

## Normalisers (shared, never reimplemented)

`normalizeAmount` → `Money` 2-dp string; `normalizeMsisdn` → `+8801XXXXXXXXX`; `normalizeTrxId` →
uppercased `[A-Z0-9]{6,20}`; `normalizeTimestamp` → UTC from Dhaka-local, rejects >24h future.

## Fixtures are the regression suite

[`packages/parsers/fixtures/*.json`](../packages/parsers/fixtures) assert the **whole** `ParseResult`
per message and are CI-gating. The two real bKash samples are exact positives; debit/OTP fixtures prove
they are `IGNORED`/`UNPARSED`. Debit/promotional fixtures are currently _synthesised_ and will be
replaced with real samples (they become gating the moment they land).

## Server & operations

`RuleRepository` caches the active rules (one per provider, enforced by a partial unique index) and
refreshes across processes via Redis pub/sub. Admin endpoints: `GET /admin/parser-rules`,
`POST /admin/parser-rules/:id/activate`, `GET /admin/parser-health`, `GET /admin/sms-logs/unparsed`,
`POST /admin/sms-logs/:id/reparse` (before/after diff; refuses a verified message without `force`). The
device `parsed_hint` is compared for the `parser_hint_mismatch_total` metric but **never** influences
the stored extraction (ADR-5).
