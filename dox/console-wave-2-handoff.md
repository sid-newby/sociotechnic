# Console handoff after the run page

Update: PR #28 merged after owner approval and passing checks. Continue from
[the wave 4 handoff](console-wave-4-handoff.md); the delivery table below is the
original pre-merge snapshot.

The run page is implemented. The next work is the History page, completion of
Agents and Settings, and the finish pass across the console. Start with
[the next-wave brief](briefs/wave-4-history-agents-settings.md) and
[the amended plan](console-redesign-plan.md).

## Current delivery state

This is a handoff snapshot, not a claim that the branch has merged.

| Item | State |
| --- | --- |
| Pull request | [#28](https://github.com/sid-newby/sociotechnic/pull/28), ready for review and not merged, base `main`, label `release:none` |
| Working branch | `codex/run-page` |
| Main at this snapshot | `0a6b660`; fetch and verify before choosing the next base |
| Run page | Implemented and checked at desktop and 390px |
| Agent library crash | Missing TooltipProvider fixed in `1723004`; actual Chrome check rendered 21 roles, profile/history and no console errors |
| Final browser closure | Verified: run page 99/99 plus 6/6 post-provider smoke checks; New run 18 scenario groups; ownership 8 groups; native design journey passed twice |
| Whole-console completion | History and the remaining Agents/Settings work are still to build; finish documentation/screenshots and release follow afterward |

Implementation and verifier work is pushed through `b166a1c`, whose required
Release label and Repository checks passed. The PR is ready for review; the
subsequent handoff commits change documentation only. Check the latest PR head
and its CI before merging. Merge only with the owner's authorization.
Inspect the PR and current Git state rather than treating these snapshot values
as permanent instructions.

## What the owner wants

The owner wants the needed facts and next action to register immediately. Use
the available space well: readable type, useful density, adaptable card layouts,
meaningful stage/status colors and a cohesive experience across pages. Drawers
and off-screen disclosure are welcome when they reveal real supporting evidence.

Keep detailed explanations near their decision or behind disclosure. Remove
repeated caveats, filler, pseudocode-like product copy and instructions that say
the same thing on every row. Keep consequential confirmations and useful input
guidance. Every chart must use recorded measurements and every control must do
its named job. Missing evidence is an explicit state, never a sample value.

Do not be afraid to use `/impeccable` to help. The owner explicitly asked for
that guidance to reach the next agent. Use it for layout, critique, clarity,
accessibility and finish work where it helps. The visual direction is already
approved; do not restart the design interview or replace the chosen world.
GPT-6.1 Sol at high effort may be used for subagents with bounded file ownership.

The house special means the existing Vite/React/Tailwind/shadcn conventions here.
Keep the working Node HTTP server, CLI and engine. Do not migrate them to NestJS
or create a parallel backend to make the scaffold name fit.

## What is implemented

- The shadcn dashboard composition: inbox sidebar, header, human decision bar,
  four summary cards, completion-step token chart and activity table.
- Dispatches, Records, Log and Decisions. Dispatch sorting, column visibility
  and CSV export operate on the real filtered table. Record download returns
  original bytes; Formatted and Raw remain available in record sheets.
- Card, chart, dispatch, record and round-evidence drill-down. Earlier build,
  check, review, conformance, gate and diff evidence stays accessible.
- Continue/recovery, Pause, executed Step once, hold after a transition, early
  bound override, Stop with a persisted note, interrupt one dispatch, explicit
  reopen discard, local PR text, publishing and separate merge confirmations.
- Existing design conversation, image/question/preview/handoff behavior, New
  run, Add agent, Manage versions and Sandboxes on shared primitives.
- Settings already saves the local dispatch limit and sandbox capacity and
  switches the theme. These controls must be extended, not rebuilt.
- Meaningful supplementary status colors and shared role colors, 16px body
  text, a 13px utility floor, 24px section-card padding and mobile drawers.

The old stage strip, Overview/Activity/Analysis/in-run Agents tabs,
`components/actions.tsx`, `experience.tsx`, `technical.tsx` and `experience.css`
are removed. Do not restore that parallel UI to recover an old feature.

## Remaining work and existing owners

| Work | Current evidence and next step |
| --- | --- |
| History page | No History page/navigation exists yet. Build useful per-run and cross-run history with actual source drill-down, using the database and existing usage/agent projections. |
| Agents in a run | The library is global. Add an explicit run filter and show the run's pinned configuration; `/api/meta?job=<id>` already distinguishes pinned settings from latest releases. |
| Metric provenance | The library can open a source run, but many counts and feedback record paths are still plain text. Make meaningful metrics lead to their actual run/dispatch/record. |
| Interrupted metrics | The web parser accepts `interrupted`; engine library totals/observations do not yet give it a complete separate metric treatment. Update the projection, parser and tests together. |
| Settings defaults | Capacity and theme are implemented. Default holds are not. Specify persistence/precedence and wire a real consumer while preserving initial plan review and human gates. |
| Restore without continuing | CLI `restore <job>` exists. There is no restore-only HTTP route or React control. Add the guarded route before exposing it; `/resume` starts the driver. |
| Retained-surface cohesion | Forms and management surfaces have migrated to primitives and some boilerplate is disclosed. Finish the fact-first information hierarchy and provenance across the whole experience. |
| Finish/release | Impeccable finish review, final DESIGN.md, `console-ui.md`, refreshed screenshot set, documentation reconciliation and the agreed minor release remain. |

## Code and contracts to reuse

Paths are relative to the repository root.

| Concern | Owning source |
| --- | --- |
| Shell/routing | `sociotechnic/ui/web/src/App.tsx`, `components/shell/` |
| Run controls and legal actions | `src/run-model.ts`, `src/components/run/use-run-actions.tsx` under the web workspace |
| Recorded usage/live distinction | Web `src/run-model.ts`, `src/token-usage.ts`; engine `sociotechnic/src/token-usage.ts` |
| Drawers and records | Web `src/components/run/`, `src/components/records.tsx`, `src/components/record-content.tsx` |
| Table and CSV | Web `src/components/run/run-table.tsx`, `src/run-table-model.ts` |
| Agent history/provenance | `sociotechnic/src/agent-library.ts`, `sociotechnic/src/db/listing.ts`, web `src/library-model.ts`, `src/components/agent-library.tsx` |
| Settings | Web `src/components/shell/settings-sheet.tsx`, `src/components/sandboxes.tsx`, `src/theme/`; `sociotechnic/src/local-capacity.ts` |
| Restore authority | `sociotechnic/src/db/restore.ts` (`restoreJob`), CLI `case "restore"`, `src/job-store.ts`, `src/driverlock.ts` |
| API | `sociotechnic/ui/server.ts`, [CLI/API reference](../sociotechnic/docs/cli-reference.md) |
| Design direction | [PRODUCT.md](../PRODUCT.md), [approved surface contract](../sociotechnic/ui/web/.impeccable/surfaces/sociotechnic-ui-web-src-app-tsx.md), `src/index.css`, `src/theme/` |
| Behavioral authority | [CONTRACTS.md](../sociotechnic/CONTRACTS.md), [driver contract](../sociotechnic/AGENTS.md), [development map](../sociotechnic/docs/development.md#feature-to-code-map) |

Settings uses `GET|POST /api/local/capacity` with `expectedLimit`,
`GET /api/sandboxes` for inventory/current capacity,
`POST /api/sandboxes/capacity` for capacity changes, and browser-owned theme
preferences.
Agent history uses `GET /api/agents` and
`GET /api/agents/:name?page=<n>&sort=recent|longest|issues`.
Read the actual response types before extending either surface.

## Verification on record

The coordinator recorded these final wave verification results:

- Exact repository checks with disposable PostgreSQL enabled: 372 passed,
  1 skipped, no failures; 18 release tests passed; TypeScript, production build,
  bundled agents and production dependency audit passed.
- Built run-page browser proof: 99 checks passed at 1440px and 390px, including
  real table export, drawer chains, keyboard focus, unknown usage and log retry.
- After the TooltipProvider fix, run-page smoke passed 6/6; New run passed
  18 scenario groups including agent navigation, storage failures and resize;
  ownership passed 8 groups including contrast, mobile target size, keyboard,
  release, unsafe URL and interrupted-owner cases. The native design journey
  passed twice with no model calls. Actual Chrome Agent library verification
  rendered 21 roles, profile/history and no console errors.
- No live model run or live sandbox deployment was used to establish these UI
  claims. Existing screenshots in `assets/console/` predate the redesign.

Use the maintained scripts, including `verify-run-page.mjs`,
`verify-console-ownership.mjs`, `verify-run-wizard.mjs` and
`verify-interactive-design.mjs`, under `sociotechnic/scripts/`. Their fixture
checks are not substitutes for the real engine/database tests, or vice versa.
The build reports a large main chunk; record any deliberate future splitting
without treating it as a reason to remove useful behavior.

## Safe continuation

Run `git status`, `git worktree list --porcelain`, the branch/remote checks and
PR inspection first. Find checkouts from Git/app state; do not assume a personal
absolute path from an earlier chat. Reuse a suitable worktree, or create an
isolated one from the verified base after PR #28 lands. Do not reset the current
branch to an old handoff's suggested commit.

Preserve the primary checkout's owner edits to README/banner assets and the
original Claude worktree's dirty work. The continuation preserved that work;
this handoff does not authorize overwriting or deleting either checkout.

Root [AGENTS.md](../AGENTS.md) governs cleanup. Fetch and verify merges, inspect
runtime dependencies, use the owning app workflow for managed worktrees, and
remove only clean, merged, unused linked worktrees. Never force-remove a
worktree or force-delete a branch to follow a stale handoff. Git's actual primary
checkout is protected. Older handoff cleanup examples are superseded by AGENTS.md.
