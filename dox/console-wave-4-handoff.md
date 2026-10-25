# Wave 4 handoff

Wave 4 implements History, Agents in a run, browser defaults and restore-only
recovery on the merged run-page foundation. The branch is `codex/console-history`;
PR #28 merged at `11d1a1b01ef93bb6e92b2f0c5a51e43eb0e1db71` after review and
passing checks, with the owner's explicit approval. Wave 4 is [PR #29](https://github.com/sid-newby/sociotechnic/pull/29), labeled
`release:none`. The owner subsequently authorized merging after checks and
cleaning up the remaining completed branches and worktrees.

## Implemented behavior

- History queries filter in PostgreSQL before the 100-run cohort bound, label
  incomplete coverage and page contributing dispatches. Token/cache, cost and
  elapsed totals retain missing data; interrupted calls remain separate.
- Global Agents retain latest definitions. In-run Agents show actual pinned or
  recorded configurations, including assigned identities and undeployed roles.
  Metric, feedback and cohort selections retain exact source provenance.
- Run/dispatch/record selection survives reload, including superseded attempts.
  Opening a record temporarily closes its dispatch dialog; Escape returns to
  the dispatch's Read record action without competing modal focus traps.
- Settings saves browser defaults. New jobs pin those holds in the database;
  later browser changes leave them unchanged. Plan review remains mandatory,
  including temporary holds chosen before planning finishes. Continuing a
  reviewed gate omits its current status from the next start's holds.
- Restore worktree calls the existing guarded restore operation and never
  launches a driver. Recover and continue remains a distinct action.

Contracts, CLI/API and engine references, README and the development source map
are updated. No database migration or immutable catalog edit is included.
The owner's README changes and nine supplied images are included as requested.
Unrelated primary-checkout `.gitignore` and linked-worktree changes are preserved.

## Verification

- `SOCIOTECHNIC_TEST_DATABASE_URL=postgres://localhost:5433/postgres task checks`:
  397 tests, 396 passed, one optional installed-skill test skipped; 18 release
  checks, TypeScript, web build, agent validation and production audit passed.
- `task test:pg`: 396 passed, one optional installed-skill test skipped, zero
  failures. Final targeted UI changes were followed by `task typecheck` and
  `task build`, both passing.
- `verify-console-history.mjs --stable`: 40/40 across 1440px and 390px, dark
  and light, including mandatory plan hold, exact superseded record reload,
  pinned agents, saved defaults and restore-only. Proof
  `/tmp/sociotechnic-wave4-final/report.json`.
- `verify-run-page.mjs --stable`: 99/99, proof
  `/tmp/sociotechnic-wave4-regression-run-page/report.json`.
- `verify-run-wizard.mjs`: all 18 scenario groups passed; proof
  `/tmp/sociotechnic-wave4-regression-run-wizard`.
- `verify-console-ownership.mjs`: all eight scenario groups passed; proof
  `/tmp/sociotechnic-wave4-regression-ownership`.
- `verify-interactive-design.mjs`: passed with the actual installed Impeccable
  command, fixture SDK events, zero model calls and the normal planned hold;
  proof `/tmp/sociotechnic-wave4-regression-design-installed-runtime/verification.json`.

Browser scripts used the installed Playwright module at
`/tmp/sociotechnic-browser-tools/node_modules/playwright/index.mjs` where needed.
The native design check used `SOCIOTECHNIC_TEST_IMPECCABLE_SKILL` pointing to the
installed skill and `IMPECCABLE_BIN=/Users/sidnewby/.impeccable/bin/0.1.5/impeccable`.
Without the explicit installed binary, the launcher's download populated the
fixture workspace with a 12 MB executable and exceeded the artifact limit;
that first attempt failed and is not counted as passing. The configured rerun
kept the runtime cache outside the artifact workspace. No live model invocation
or sandbox launch was used.

## Design review and limits

The approved shadcn dashboard direction is retained. Impeccable context and
relevant guidance were applied; the targeted detector reported no findings.
Desktop and narrow screenshots were inspected in dark and light themes,
including open selects, exact records, errors, saved defaults and restoration.

The premium static audit reports 21 findings: composed Radix controls are
misidentified as actionless buttons/native selects; the shared Textarea wrapper
has no unconditional resize class while its consumers set it; and DESIGN.md is
intentionally deferred to wave 5. The canonical capability-map gaps were fixed.
These findings are retained as audit evidence, not reported as a clean static
pass. Browser journeys verify the composed controls. The build retains the
existing bundle-size advisory; no new splitting project is included.

## Next work

Read [the redesign plan](console-redesign-plan.md) for wave 5: finish review,
final DESIGN.md and console-ui.md, a coherent screenshot refresh and the eventual
minor release. Do not repeat the approved visual-direction interview. Use
`/impeccable` for critique, hardening and finish work, with the installed skill
and the existing surface context.

The owner's design-chat request is recorded in
[the dedicated follow-up brief](briefs/design-chat.md), with the exact supplied
[shadcn reference](references/design-chat-shadcn.tsx.txt). Reuse the existing
Anthropic Agent SDK session, designer agent Markdown, native Impeccable tools,
images/previews, and HANDOFF.md plus artifact snapshot. Improve thread scrolling
and composition, then introduce a new immutable designer release for the
requested Opus 5.5/high configuration after verifying its exact provider ID.
The literal `opus-5-5` is not in the checkout's current accepted model table;
this handoff does not claim a provider invocation or silently repin old runs.

## Checkout state and cleanup

The owner requested all completed branches be merged and cleaned up. An audit
verified that the old Stop-note branch matches the merged patch, the banner
branch matches merged commit 9636446 except an accidental worktree gitlink, and
all twelve dirty files in the old Claude checkout exactly match the already
merged continuation snapshot d8a19de. Those files were committed as a recovery
snapshot. Ancestry-only merges preserve those histories while leaving the
verified wave 4 tree unchanged and excluding the accidental gitlink.

After PR #29 checks pass, merge it, synchronize the primary checkout and remove
completed linked worktrees and feature branches with safe deletion. The old
wave-2 preview is a read-only fixture with no live driver; shut it down gracefully
before removing its source checkout. Use the owning app's archive workflow where
available. Recheck Git and runtime state immediately before removal. Preserve
the owner's unrelated `.gitignore` changes in the primary checkout.
