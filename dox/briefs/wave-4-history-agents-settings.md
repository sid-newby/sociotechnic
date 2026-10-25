# Wave 4 brief: History, Agents and Settings

Build the remaining console pages and workflows on the completed run-page
foundation. Read [the handoff](../console-wave-2-handoff.md) and
[the amended plan](../console-redesign-plan.md) before starting. This brief
authorizes the implementation described below after the preceding work is on a
verified base; it does not authorize merging, release publication or cleanup of
unrelated/dirty worktrees.

## Outcome

The developer can move from History to the exact run, dispatch and record that
explain a measurement; inspect the agents actually pinned to a run; change
Settings that take effect; and recover a worktree without starting agents.
History, Agents, Settings and the retained forms feel like one console.

The owner prioritizes instant recognition, readable type, useful density,
meaningful stage colors and cohesive layouts. Use the available space; do not
make people read repetitive instructions to find their facts. Drawers and
other off-screen reveals are encouraged for supporting detail. Keep real
confirmations and input guidance, and cut filler, repeated caveats and
pseudocode-like product copy. No fake curves, sample totals or decorative
controls may appear in the application.

Do not be afraid to use `/impeccable` to help. The owner explicitly requested
this. Load its project context and use the relevant layout, critique, clarify,
audit or finish guidance as needed. The approved shadcn dashboard direction is
already settled: no repeat interview or new aesthetic direction is required.
The house special means the existing Vite/React/Tailwind/shadcn conventions; keep
the working Node HTTP server, CLI and engine. Do not migrate them to NestJS or
create a parallel backend.
GPT-6.1 Sol at high effort subagents are authorized. Give each a bounded task and
file ownership; do not let parallel agents edit the same files or rebuild while
browser evidence is being captured.

## Read first

1. Root `AGENTS.md`, `CLAUDE.md`, `PRODUCT.md`, the amended console plan and
   handoff. Read directory instructions for the files you change.
2. `sociotechnic/CONTRACTS.md`, the CLI/API and engine references, and the
   development feature map. Update affected contracts before behavior changes.
3. The approved surface contract under `sociotechnic/ui/web/.impeccable/` and
   the scaffold UI skill under
   `sociotechnic/scaffolds/react-nest/template/.agents/skills/scaffold-ui/`.
4. Current web `App.tsx`, `components/shell/`, `components/run/`, `run-model.ts`,
   `library-model.ts`, `components/agent-library.tsx`, `components/new-run.tsx`,
   `components/sandboxes.tsx`, `theme/`, `index.css` and installed primitives.
5. `sociotechnic/src/agent-library.ts`, `src/db/listing.ts`, `src/db/restore.ts`,
   `src/job-store.ts`, `src/driverlock.ts`, `src/token-usage.ts`, `src/usage.ts`
   and `ui/server.ts`, with their callers and tests.

Load the current TypeScript/type-system, React and frontend design skills. Keep
`cn` from the installed package, exact dependency pins, local Geist and the
existing token/theme system. The approved prototype is composition evidence,
not a source of production data or controls.

## Existing behavior to extend

| Already implemented | Canonical owner/API |
| --- | --- |
| Shell, inbox and run drawers | Web `App.tsx`, `components/shell/`, `components/run/` |
| Honest run telemetry | Web `run-model.ts`: confirmed active dispatch timing, coverage and missing values; completion-step chart; engine `token-usage.ts` |
| Global agent summaries/history | `src/agent-library.ts`, `src/db/listing.ts`; `GET /api/agents`, `GET /api/agents/:name?page=&sort=recent|longest|issues` |
| Pinned run agent configuration | `GET /api/meta?job=<id>`; plain `/api/meta` describes latest releases |
| Local dispatch limit | Settings sheet, `src/local-capacity.ts`; `GET|POST /api/local/capacity`, with optimistic `expectedLimit` and environment-managed refusal |
| Sandbox capacity/management | `components/sandboxes.tsx`; `GET /api/sandboxes` for inventory/capacity, `POST /api/sandboxes/capacity`, existing stop/clean routes |
| Theme and New run environment preferences | Web `theme/` and `use-run-environment.ts`; existing browser storage/error behavior |
| One-run holds | `POST /api/jobs/:id/run` with `hold`; initial New run plan review remains enabled |
| Restore without execution | CLI `restore <job>` calls `src/db/restore.ts:restoreJob`; there is no restore-only HTTP route yet |
| Recover and continue | `POST /api/jobs/:id/resume` restores and starts the driver; it must never be labeled restore-only |

Do not create a second Settings implementation for capacity/theme, a parallel
agent-history store, or a second record viewer. PostgreSQL remains authoritative;
there is no local-file history fallback. Live log buffers are process-local and
are not durable execution history.

## Required work

### History page

Add a real History destination to the shared shell when the page works. Provide
per-run and cross-run views for tokens by role/round, reported estimated cost
over time, dispatch elapsed time, execution errors and categorized feedback.
Use existing checked-build feats for measured successes; acceptance is human
context, not an accuracy score. Keep interrupted calls distinct from failures,
timeouts, pending calls, malformed records and valid requests for changes.

Every meaningful total or chart selection leads to its contributing source
run/dispatch/record. Preserve round, commit, pinned model/effort/release and
measurement coverage. Show missing data as unknown and partial coverage as
partial. Cache reads are a subset of total tokens, not another additive total.
Do not interpolate usage between completion reports or keep an orphan/queued
unfinished dispatch ticking as active agent work.

Reuse `loadJobHistory` and existing projections. Define only the bounded History
API needed; current agent routes are not a general History API. Specify filters,
archive inclusion, paging and limits rather than downloading every run/record
for browser aggregation. Preserve development-cancellation cohort exclusions.

### Agents in a run and provenance

Add an explicit in-run filter to Agent library and a clear path from the run
page. Show actual pinned assignments/releases, configuration, tools, budgets and
dispatches, not the latest catalog release disguised as historical settings.
Use `/api/meta?job=<id>` and recorded dispatch configuration as applicable.
Preserve global search, cohort comparison, Add agent and Manage versions.

Make deployment, error, feedback and feat counts open the actual contributing
evidence at the right run/dispatch/record. Extend shared navigation so the
selection survives navigation and reload; do not stop at a generic source-run
link where an exact record is known. Historical superseded record paths from
`sourceRecord` must still identify the evidence they actually reference.
Unavailable provenance needs a short local state, not an invented link or the
same caveat repeated on every row.

`src/agent-library.ts` currently lacks a complete interrupted metric/observation
category even though `library-model.ts` accepts interrupted row outcomes. Change
the projection, API contract, parser, presentation and tests together. Never
rewrite canonical outcomes or count interrupted calls as success or execution
failure merely to make totals sum.

### Settings defaults and retained-surface cohesion

Extend the existing Settings sheet. Capacity, theme and environment persistence
already work. Default holds remain to implement: define whose defaults they
are, persistence and precedence, and the exact consumer before adding a field.
Reuse existing preference/configuration ownership. Resolve routine choices from
the contracts and record the decision; ask only about an unresolved choice that
materially changes the owner's workflow.

Saved defaults must affect a real subsequent start and survive the persistence
boundary promised by their label. Existing runs retain pinned state; initial
plan review and human gates remain protected. Do not broaden CLI/global defaults
or change running jobs as an incidental settings action. One-run Controls holds
remain separate from persistent defaults.

Finish the information hierarchy across Agent library, New run, Add agent,
Manage versions, Sandboxes and Settings. Reuse labels, status/role cues, error
placement, drawer behavior and consequential confirmations. Put explanation at
the relevant setting or behind help once. Preserve working repository browsing,
Git initialization/publication choices, sandbox retention, images, design chat,
permissions and version constraints. A terse surface must still be understandable.

### Restore without continuing

Define and add a dedicated job API operation around `restoreJob`, then expose a
clearly named restore-only control for eligible missing-worktree cases. Do not
call `/resume` and claim that it only restores. Reuse the database authority,
operation boundary, driver lock/owner checks and filesystem/branch recovery
logic. Do not expose a force path or copy `restoreWorktree` into the route.

Prove that restoration dispatches no agent, preserves human-gate status, records
and branch history, and refuses active/interrupted foreign ownership. Cover an
already present worktree, a missing repository/branch, idempotent retry and
concurrent ownership. Define the existing `no-branch` outcome's HTTP/UI treatment
rather than reporting a successful restore. Keep the CLI/API parity table
accurate throughout the change.

## Stages and allowed paths

1. Trace each workflow and write the contract/data/navigation decisions and
   docsImpact. List fields and routes that exist versus those being added.
2. Implement and prove the shared history/provenance projections and bounded
   API. Include interrupted metrics and coverage at the owning boundary.
3. Build History and its source drawers; extend Agents with the run filter and
   exact evidence navigation. Reuse the existing shell, table/chart wrappers and
   viewer rather than adding a separate visual system.
4. Complete Settings defaults and restore-only as separate working vertical
   slices. Do not render a control until its persistence or operation exists.
5. Apply the retained-surface cohesion/content pass, verify the complete journeys
   and update documentation in the same change. Commit reviewable checkpoints.

Allowed implementation scope:

- `sociotechnic/ui/web/`, including existing retained components, shared
  primitives, helpers, parsers, navigation and necessary exact dependency pins.
- `sociotechnic/ui/server.ts` and focused supporting history/restore ownership
  code under `sociotechnic/src/`, primarily `agent-library.ts`, `db/listing.ts`,
  `db/restore.ts`, `job-store.ts`, `driverlock.ts`, shared usage and settings code.
  Extend only what these workflows need; preserve engine decisions and gates.
- Focused `sociotechnic/tests/` and browser scripts under
  `sociotechnic/scripts/`; isolated fixtures and evidence metadata as needed.
- The documents in docsImpact below.

Do not modify `.claude/settings*`, live `.sociotechnic/` state, logs, immutable
catalog releases, target repositories or unrelated engine/provider behavior.
No schema migration is assumed. If tracing proves one necessary, document the
reason, migration/rollback scope and PostgreSQL acceptance before broadening it.

## docsImpact

Update `sociotechnic/CONTRACTS.md` before behavior changes, including response
shapes, provenance/metric rules, default ownership, restore guards and the
Canonical UI Map. Update the following in the implementation stages that touch
them, not as a later documentation cleanup:

- `README.md`: actual History/Agents/Settings navigation and completed workflows.
- `sociotechnic/docs/cli-reference.md`: added routes, request/response/error
  contracts and remaining React parity gaps.
- `sociotechnic/docs/engine-reference.md`: history interpretation, interrupted
  accounting and restore/default behavior where affected.
- `sociotechnic/docs/development.md`: source tree, feature map and verification.
- `dox/console-redesign-plan.md`, this brief/handoff and `CHANGELOG.md`: completed
  scope, remaining work and honest release notes.

Wave 5 still owns the finish review, final `DESIGN.md`,
`sociotechnic/docs/console-ui.md`, refreshed `assets/console/` captures and final
minor release preparation. Keep its handoff concrete. Do not regenerate the
committed screenshot set or publish a release incidentally during this wave.

## Verification and delivery

Run `task checks` and `task test:pg` using the repository's pinned local tooling
and disposable PostgreSQL fixtures. Check the actual runtime, not only types or
aggregate screenshots. Pure helper tests must exercise real fixture projections,
missing/partial usage, interrupted metrics, exact provenance and pinned-versus-
latest configuration. Route tests must demonstrate persistence and failures;
restore tests must assert zero dispatch calls and unchanged gate state.

Build once for the batched browser pass. Exercise History -> source dispatch ->
record, global Agents -> in-run filter -> pinned configuration -> feedback
record, Settings save/reload/failed save and actual next-run defaults, and
restore-only -> unchanged human gate. Include archived/empty/loading/error
states, stale data, missing provenance, keyboard entry/Escape/focus return,
sidebar and open-dialog resize, light/dark, 1440px and 390px without page overflow.
Keep semantic text/icons alongside stage/status color. Respect reduced motion
and the 16px/13px typography and 24px card-padding contract.

Reuse and extend `verify-run-page.mjs`, `verify-console-ownership.mjs`,
`verify-run-wizard.mjs` and `verify-interactive-design.mjs`. Start fixture servers
with a runner guard; no live models, database mutation of real jobs, sandbox
launch or remote publication is part of UI verification. Record commands,
results, viewports and evidence locations in the PR. Fix the first batched
inspection's genuine defects together, then confirm; avoid open-ended polishing.

Finish on an isolated `codex/` feature branch with coherent commits, a PR using
the repository template, accurate docsImpact and `release:none` for this
intermediate wave. Final minor release preparation stays in wave 5. Merge only
with user authorization and the required checks passing. Before claiming complete,
list every control and its route/local operation, each metric's source and
coverage, the successful and relevant failed journeys, and any remaining work.
Use root AGENTS.md for branch/worktree lifecycle; discover actual checkouts with
`git worktree list --porcelain`, preserve dirty owner work and the original
Claude tree, and never force cleanup to satisfy an old handoff example.
