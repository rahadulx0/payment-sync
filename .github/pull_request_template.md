<!-- PR title: `Task NN — <title>` -->

## Task

Task NN — <title>

## Acceptance criteria

<!-- Paste this task's acceptance criteria from workplan/NN-*.md as a checklist. -->

- [ ] ...

## Definition of Done (workplan/README.md §4)

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green (plus `./gradlew lint test` for Android tasks).
- [ ] New behaviour has tests at the right level; money-path behaviour has a failing-first test.
- [ ] `docs/openapi.yaml` regenerated and CI's breaking-change check passes (backend tasks).
- [ ] Docs updated: `architecture.md` if a decision changed, `docs/runbook.md` if ops behaviour changed, `.env.example` if config changed.
- [ ] No `TODO`/`FIXME`/`any`/silent `catch` on the money path (ingest → parse → match → webhook).
- [ ] Secrets never logged; new log lines checked against the redaction list.
- [ ] The task's own smoke demo performed and recorded below.
- [ ] Progress table in `workplan/README.md §5` updated.

## Smoke demo

<!-- What you ran and what you observed. -->
