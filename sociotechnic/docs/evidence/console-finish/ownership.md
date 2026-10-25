# Final ownership and handoff

Integration owner: this console-finish coordinator. Integration branch
`codex/console-finish-plan`, worktree
`/Users/sidnewby/Documents/Codex/2026-10-25/task-2/sociotechnic-console-finish`.
HEAD/base `1eb0a89d3c32319c3be5e530caf5605f1e0cecf3`. Every change is uncommitted.
No other worker is authorized to edit this worktree. The separate orchestration
planning task is read-only; its plan must treat the following files as owned.

| Package | Writer and handoff | File boundary |
| --- | --- | --- |
| P0 reconciliation/plan | Coordinator | console-finish-plan.md, baseline evidence; original inputs reconciled byte-for-byte before appended status notes |
| P1 design/builder documentation | Sol/high documentation worker; returned | DESIGN.md, docs/console-ui.md; coordinator owns later factual/evidence reconciliation |
| P2 screenshot harness | Sol/high tooling worker; returned | scripts/console-screenshots.mjs; coordinator owns final style/assertion/provenance integration |
| P3 shared UI hardening | Coordinator | components/ui/textarea.tsx, components/ui/button.tsx |
| P4 screenshots/docs | Coordinator | assets/console set/manifest, README, PRODUCT, development, contracts, historical-plan continuations, direction related-target paths, Unreleased notes |
| P5 single integration/exit gate | Coordinator | final typechecks/build/tests, fixture browser batch, review and evidence inventory |
| P6 recorded provider usage | Projection Sol/high worker returned token-usage.ts + tests/token-usage.test.ts; coordinator integrated all consumers | Exact current list in usage-package-files.txt; shared source boundary below |

P6 shared source boundary (coordinator owns all):

- src/token-usage.ts and src/history.ts: nullable provider-aware reporting,
  scopes, full-cohort aggregation and legacy-compatible History filter.
- ui/web/src/token-usage.ts, model.ts, history-model.ts, run-model.ts,
  telemetry.ts and run-table-model.ts: display projections and CSV labels.
- ui/web/src/components/usage-breakdown.tsx, history.tsx, design.tsx,
  run/section-cards.tsx, run/metrics-sheet.tsx, run/dispatch-sheet.tsx and
  run/run-table.tsx: usage UI and progressive disclosure.
- tests/token-usage.test.ts, history.test.ts, run-controls.test.ts,
  run-table.test.ts: separate tests, real projection/parser/CSV paths.
- scripts/verify-run-page.mjs and verify-console-history.mjs: fixture assertions;
  scripts/console-screenshots.mjs: capture provenance includes untracked source.
- Current docs/contracts, screenshot/provenance and evidence inventories in the
  full changed-files.txt list.

There are no runner, Codex/Claude adapter, designer collector, engine-policy,
schema/migration, agent catalog or model changes. Raw usage records and existing
historical total calculations remain intact. New scopes describe the existing
source precedence rather than revising historical collection semantics.

The two original worker branches/worktrees retain their handoffs at the same
base: codex/console-finish-docs and codex/console-finish-captures. They are not
additional integration heads. The active primary checkout is main at the base
and retains its exact pre-existing .gitignore edit; it was never switched,
stashed, reset or edited. No other worker's temporary evidence was consumed.

One proposed integration pass: review P0–P5, then P6 projection/nullability and
API compatibility, UI/CSV, separate tests, docs and current images. The shared
exit gate is verification.json with explicit strict-audit/official-lint limits.
Publication and changes to the user's checkout remain outside this task.
