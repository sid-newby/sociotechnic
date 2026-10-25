# P6 — Recorded provider usage in the console

Owner: supervising coordinator. Explicit owner request after the bounded finish
checkpoint: remove API-dollar estimates from usage reports and expose recorded
input/output/cache details instead. P0–P5 was snapshotted in the task workspace
before this package; its screenshots are historical until P6 is recaptured.

The projection worker owns only src/token-usage.ts and tests/token-usage.test.ts;
the coordinator owns every other file and integration. Existing tokenUsage totals
and stored raw payloads remain unchanged. No schema, collector, engine policy,
model/catalog or paid/live operation is included.

Add a shared nullable breakdown and per-field coverage. Reasoning is an explicitly
recorded output subset and is never added to totals; image detail remains
unavailable because this projection has no verified retained image mapping.
Codex historical optional details and designer per-turn data cannot be recovered.
Do not infer cache hits, TTL/expiry, session context size or per-turn events.

File scope: shared token projection/tests; history projection/parser; run/detail
models and telemetry; a shared usage breakdown component; dashboard, metric and
dispatch sheets, History, designer report, table/CSV labels; existing tests under
sociotechnic/tests and fixture scripts under sociotechnic/scripts; affected docs,
contracts and screenshot/provenance set. Tests stay in the existing separate
structure; fake providers are the boundary required to avoid paid/live calls.

Acceptance: unknown vs zero, stable totals, reasoning subsets, source precedence,
partial per-counter coverage over the entire cohort (not a paged subset), raw
history compatibility, no dollar UI, cumulative scope labels, real fixture API
and browser interactions, final-source typecheck/build/tests and fresh captures.
Reuse isolated private dependencies and owned loopback profiles. No install,
commit, push, PR, merge, release or live database/provider/sandbox operation.

## Delivered state

Implemented and integrated only into `codex/console-finish-plan` at base
`1eb0a89d3c32319c3be5e530caf5605f1e0cecf3`; all changes remain uncommitted.
Projection worker ownership has returned to the coordinator. The worker wrote
only token-usage.ts and its separate test; the coordinator integrated every
shared consumer, scope/coverage edge case, docs and final evidence. No other
worker may modify this worktree.

Final application revision: engine/web typechecks and production build pass;
409 tests, 377 pass, 32 optional skips, zero failures. Browser fixtures pass
99 run-page and 40 History checks; designer fake-SDK/native-preview verification
also passes with zero model calls. Eight primary screenshots and three
supplements now describe this revision. Capture source provenance includes new
untracked source files, including the shared UsageBreakdown component.

Strict premium still exits 1 with 19 composed-control findings; official DESIGN
lint remains unavailable. No registry audit, PostgreSQL integration, live model,
provider or real sandbox operation was performed. See the current
[evidence summary](evidence/console-finish/verification.json),
[review](evidence/console-finish/finish-review.md) and
[package file list](evidence/console-finish/usage-package-files.txt).

Integration sequence remains one owner and one pass: review the P0–P5 finish
checkpoint, then the P6 projection/API and nullable semantics, shared consumer
UI/CSV, tests, docs and final screenshot evidence. No branch merge, commit,
publication or integration into the user's active checkout is authorized here.


### Registry acceptance gap closed

The subsequently authorized production dependency lookup passed with exit 0
and zero vulnerabilities at the configured official npm registry, using
installed pnpm 12.15.0. No install or manifest/lock/workspace changes occurred.
The aggregate `task checks` command was not invoked; component-gate chronology
and raw registry evidence are recorded in
[evidence/console-finish/verification.json](evidence/console-finish/verification.json).
This supersedes the earlier registry-not-run limitation; PostgreSQL, strict
premium and official DESIGN-lint limitations remain as described.


## Combined local-review revision

Reconciled the preserved UI patch onto confirmed merged main
`bc09db86f346939b1a8ddb697d984b08241eedc0` in
`codex/ui-combined-verification`. Four shared documents were patched by hunks;
all 27 merged paths outside UI ownership remain byte-identical to that base.
Port-fixture repair, candidate isolation/custom-release safeguards and runner
evidence tests are retained. No new UI features or polishing were added.

Six required component stages passed on the recorded uncommitted source/test
digest: engine/web types, build, agent validation, release tests, full
application/PostgreSQL suite and registry audit. 494 application passes, zero
failures, one optional native-unit skip; 18 release passes; zero registry
vulnerabilities. An additional 66 focused usage/runner tests passed. Browser
proof: 99 run-page checks, 40 History checks, designer fake-SDK/actual-native
preview and eight primary plus three supplemental captures. The approved
private-socket PostgreSQL fixture was stopped after tests. No live database,
catalog import, provider calls or installs.

Checks identify the exact base plus source/test content digest. A later explicit
handoff instruction authorized committing this verified snapshot locally; no
remote publication is authorized. Tests ran before that commit, and unchanged
source/test bytes are verified across the checkpoint. Strict premium remains 19/exit 1, and official DESIGN lint remains
unavailable. [Combined machine evidence](evidence/console-finish/combined-verification.json)
supersedes earlier test and capture counts. The original UI worktree/archive
remains untouched. Normal-checkout preservation/handoff is reported separately.
