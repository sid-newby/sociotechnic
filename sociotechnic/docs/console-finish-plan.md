# Console and designer finish plan

Status: **P1–P5 finish and authorized P6 usage package delivered; strict-audit and official-lint limits retained.**
Prepared October 25, 2026. Integration owner: this supervising Codex session.
The owner approved starting the two independent tracks after the plan checkpoint.
Browser/Vite verification remains prohibited. Two GPT-6.1 Sol/high workers contributed independent read-only
source and documentation inventories. They did not edit application files.

## Scope and authority

Finish wave 5 of [the console plan](../../dox/console-redesign-plan.md), including
the remaining documentation and verification around
[designer chat](design-chat-implementation.md). Preserve the approved shadcn
dashboard-01 direction, progressive disclosure, native designer process,
runtime-owned tokens and existing behavior. Do not restart the design interview.

Read authority: root [AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md),
[PRODUCT.md](../../PRODUCT.md), the committed
[direction contract](../ui/web/.impeccable/surfaces/sociotechnic-ui-web-src-app-tsx.md),
[canonical UI map](../CONTRACTS.md#canonical-ui-map),
[development guide](development.md), [scaffold guidance](scaffolds.md) and the
[scaffold UI skill](../scaffolds/react-nest/template/.agents/skills/scaffold-ui/SKILL.md).
Current Impeccable, frontend-design and frontend-design-premium guidance was
loaded. The fallback context launcher is absent in this worktree; product and
surface context were read directly. No context migration was performed.

Excluded: Scout's orchestration PRD, checks-first behavior, agent policy, catalog
or model IDs, database/schema work, new features, frameworks, dependency updates,
installs, cloud credits, paid runs or provisioning. No live model, database or
sandbox operations. The subsequent owner approval permits owned fixture servers and isolated browser
verification; existing dev servers and user runs remain protected. No push, PR,
merge, release or deployment. Local worktrees do not authorize any of those.

## Reconciliation and protected work

Base: `1eb0a89d3c32319c3be5e530caf5605f1e0cecf3`.

| Checkout/ref | Observed state | Treatment |
| --- | --- | --- |
| `/Users/sidnewby/Prog/sociotechnic` | Primary `main`; local `origin/main` and tag `v0.6.0` point to base; only tracked dirt is `.gitignore` | Never edit, stash, reset, switch or clean this checkout |
| `/Users/sidnewby/Documents/Codex/2026-10-25/task/sociotechnic-checks-first` | Registered branch `codex/checks-first` at base | Outside this scope; do not inspect or modify its work |
| `/Users/sidnewby/Documents/Codex/2026-10-25/task-2/sociotechnic-console-finish` | Our isolated branch `codex/console-finish-plan`, created at base | Only this worktree receives our plan and evidence |

Committed history proves the run-page PR #28, History PR #29 and designer-chat
PR #30 are integrated in this local base. `aea31f3` contains the designer-chat
implementation; `1eb0a89` merges it. The latest available **Review design chat
brief** activity is idle/completed and reports PR #30 merged and v0.6.0 published.
The **Review next UI handoff wave**, **Move web console to Vite**, and **Match new
screenshots to README** threads are also idle in the available inventory. This
is stronger evidence than branch names alone; it does not prove the absence of
work in an unlisted tool. Remote publication was not independently queried or
fetched in this task. Historical handoff test results are not new test results.

The primary `.gitignore` edit adds `dox/`, `PRODUCT.md` and `.impeccable` ignore
rules. Existing tracked files remain tracked; ignored local prototype material
is not all present in a clean worktree. Root `.agents/` and `.codex/` are absent;
the scaffold-local UI skill exists and was read. No memory-summary file was
found in the repository inventory. Do not import ignored prototypes, private
runtime state, or another worker's temporary proof. No main-checkout content was
copied into our worktree to hide a missing committed dependency.

Before any implementation dispatch, repeat the Git/worktree and relevant activity
check. Confirm the exact allowlist has no new active claimant or dirty changes;
then assign it once. If another agent claims one of those files, stop only that
package, report the exact overlap to the parent, and keep independent work moving.
No runtime ownership claim is being made at this plan checkpoint.

### Input byte comparison

The supplied `docs/...` paths do not exist at the root. Actual committed inputs
are `dox/console-redesign-plan.md` and
`sociotechnic/docs/design-chat-implementation.md`. The primary checkout copies,
isolated committed copies and both uploaded snapshots are identical; no newer
local edits need reconciliation.

| Input | Exact Library ID | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Console plan | `libfile_d8bcf03238d08191aad3e2329a3823f0` | 11599 | `0f5f1e3b199bf9d76a6edf9ce663ebdb6b49a4229efc847e2fd56d67f4011082` |
| Designer chat | `libfile_0533314fcd588191a3583e49888c6b49` | 7136 | `71381bbfd037658bce9717c8c7e13570e27a82989ec28f2f41eec86a1c2789b6` |

The current Library skill and transfer helpers materialized the exact IDs into
this consumer's `task-2/inputs/` directory. Helper transfers succeeded after the
initial restricted-network attempt failed; SHA-256 and byte counts were checked
locally. No cloud workspace path or generic download fallback was used.

## Already complete: do not replay

- Foundation, local theme presets and dark neutral default; dashboard shell,
  decision bar, four cards, burn chart, ledger tabs, column customization,
  filtered CSV, original record download, sheets and real control wiring.
- Driver/API parity already represented in current source and contracts:
  Stop notes, interrupt, concurrency, log catch-up, holds, single-step and
  guarded restoration. Verify retained behavior; do not build another API.
- History's bounded cohort/provenance, pinned in-run Agents, browser defaults,
  exact record reload and restore-only operation. These are not missing pages.
- Designer chat's anchored turns, live-edge following, Return to latest,
  images, failed-send retention, synchronous send guard, IME behavior, separate
  previews and explicit return of work. Preserve native agent/session ownership
  and the design-digest protection against using an obsolete reviewed plan.
- README already uses owner-provided `fog1`, `fog2`, `fog5`–`fog8` images where
  appropriate. Do not repeat the earlier image-matching task or discard them
  without a coherent replacement set.

## Remaining work supported by current evidence

The fresh [strict audit baseline](evidence/console-finish/premium-baseline.json)
exits 1 with **21 errors**, matching the historical count:

| Findings | Source triage | Required disposition |
| --- | --- | --- |
| 13 `affordance.actionless-button` | Radix trigger/close composition, `asChild` menu links and forwarded props explain the static detections | Trace each to its actual action and later verify keyboard/success/failure behavior; no dummy handlers or renaming to silence the detector |
| 6 `ownership.native-select-conflict` | The reported source uses authored `Select` from the installed Radix wrapper with `onValueChange` | Keep authored ownership; verify opened popup geometry, labels and keyboard behavior; do not switch the manifest to native |
| 1 `form.textarea-resize-missing` | Shared Textarea lacks a default; all current consumers already supply `resize-none` | Small shared-default hardening opportunity, not proof of a current visible defect |
| 1 `contract.design-missing` | Root `DESIGN.md` is absent | Real deferred documentation deliverable |

Source triage does not establish runtime success. Keep the strict failure visible
even if later review accepts specific analyzer limitations. Do not edit the
external auditor, weaken `premium-ui.json`, or treat a smaller count as complete
finish verification.

The screenshot harness is demonstrably stale: `console-screenshots.mjs` still
queries **What the evidence says**, Overview/Activity/Analysis and
`.round-evidence`. Those selectors belong to the removed layout. It cannot be
treated as a valid current-dashboard capture path without repair. The screenshot
manifest still describes eight October 24 captures at `e831dea`.
Its `analysis.png` link is missing; `analysis-ov.png` instead exists at
3450 × 1990. Seven original full-console captures are 1600 × 1000; targeted
publishing/header captures have other dimensions. Reconcile exact filenames and
provenance rather than repeat a blanket dimension claim.

The surface brief's `related_targets` names removed `actions.tsx`,
`experience.tsx` and `technical.tsx`. Preserve its direction; reconcile those
references only. Root `PRODUCT.md` also contains historical screenshot/release
evidence. Update affected facts with actual final evidence, not a context reset.

## Packages and exclusive ownership

P0 is complete. P1/P2 handed off their exact allowlisted files and the coordinator
reviewed/integrated them alongside bounded P3 source work. P4/P5 remain held.
The table defines exclusive ownership throughout.
Use GPT-6.1 Sol at high effort for the two substantive independent builder
tracks after the checkpoint. No cloud-spend dependency. Worktrees stay local.
Workers may read the whole committed baseline, but write only their allowlist.
The supervising session is the sole integration owner throughout.

| ID | Owner and exact write scope | Dependencies | Handoff and acceptance |
| --- | --- | --- | --- |
| P0 — reconcile and plan | Coordinator: this plan and `sociotechnic/docs/evidence/console-finish/premium-baseline.json` | None | Complete: byte reconciliation, local history/activity, audit baseline, ownership and gate |
| P1 — design record and builder guide | Sol/high documentation worker: root `DESIGN.md`; `sociotechnic/docs/console-ui.md` | P0; may run alongside P2 | Draft from current source/direction, then reconcile against the frozen integrated result. Handoff exact diff plus token/component/source links; label all visual claims pending until P4 |
| P2 — capture harness repair | Sol/high tooling worker: `sociotechnic/scripts/console-screenshots.mjs` only | P0; may run alongside P1 | Replace obsolete navigation/selectors using current accessible UI. Preserve memory store, disposable home, runner refusal, isolated port, local fonts, dimensions and browser/HTTP error guards. `node --check` plus source review now; execution awaits P4 authorization |
| P3 — shared hardening and audit dispositions | Coordinator: `sociotechnic/ui/web/src/components/ui/textarea.tsx`; `sociotechnic/docs/evidence/console-finish/finish-review.md` | P0; no other worker owns shared UI | Add canonical resize default only if source review still warrants it. Record all 21 audit rows with explanation and proof needed. No caller rewrites from the static report alone. Appropriate offline checks, then P4 computed-style/form confirmation |
| P4 — one visual and interaction batch | Coordinator/evidence owner: the eight main `assets/console/*.png` named in the existing manifest, optional new `settings.png` and `designer-chat.png`, `assets/console/README.md`, reports under `sociotechnic/docs/evidence/console-finish/` | P1/P2/P3 integrated to frozen local tree; explicit browser permission | Run fixture journeys and capture/inspect final set after build. Record application commit/tree, viewport, scheme, preset, fixture, source, command and limitations. No actual provider calls. At most one batched defect correction and one confirmation pass |
| P5 — reconcile and close | Coordinator only: `README.md`, `PRODUCT.md` repository-derived surface/evidence facts, `sociotechnic/docs/development.md`, `sociotechnic/CONTRACTS.md` canonical UI map, `sociotechnic/docs/cli-reference.md`, `sociotechnic/docs/engine-reference.md`, `sociotechnic/docs/design-ceremony.md`, `sociotechnic/docs/design-chat-implementation.md`, `dox/console-redesign-plan.md`, the committed surface brief, `CHANGELOG.md` Unreleased, P0/P3 reports | P4; only edit documents with demonstrated impact | One final documentation/acceptance pass. Correct stale paths, screenshot claims and finish status. Preserve owner-confirmed facts and open questions; keep historical results labeled. No version bump or publication; next release is a separate decision |

No blanket ownership of `App.tsx`, `index.css`, `components/run/`,
`components/shell/`, forms or designer components is delegated. A reproduced
defect in those files gets a new exact file assignment from the coordinator;
do not silently expand P1–P3. Backend, engine, agent definitions, catalog,
lockfiles and dependency manifests remain outside every implementation package.
Root AGENTS.md and CLAUDE.md remain read-only; existing navigation is sufficient
once DESIGN.md exists. A new link there is not needed for this scope.
Verification scripts other than the capture harness remain read-only unless
the coordinator assigns a demonstrated coverage gap and its exact file.

### Why this fan-out is useful

P1 writes two new documentation files; P2 writes one existing capture script.
Neither owns the other's output or shared application source. They can work
concurrently from the same agreed base. The small P3 primitive change is handled
by the coordinator instead of spawning a worker for one class. Captures, shared
references, changelog and acceptance remain serial because they depend on the
same frozen result. Do not create separate screenshot sets from worker branches.

Suggested future worktrees/branches: P1 `codex/console-finish-docs`, P2
`codex/console-finish-captures`, both from the agreed plan/base after a fresh
ownership check. These branches now exist at the agreed base. Each handoff supplies base,
tip/tree, exact changed files, docsImpact, checks with exit codes, skipped checks,
unresolved findings and a patch/commit. Workers do not integrate themselves.

## Acceptance detail and docsImpact

P1's DESIGN.md records the shipped direction, semantic token ownership,
typography (Geist, 16px body, 13px utility floor), spacing and 24px card padding,
status/role/chart meaning, light/dark presets, reduced motion, layout/scroll
ownership and installed component boundaries. Values come from `index.css`,
`theme/provider.tsx`, `theme/presets.ts`, preset JSON and `role-colors.ts`; DESIGN
does not introduce a second token source. Use the current documenter's format and
lint. A source-derived draft does not count as the final rendered finish review.

P1's console-ui.md covers actual React/Vite/Tailwind/Radix stack, `cn`, installed
component inventory, preset flow and persistence, source map, adding a view by
reusing existing primitives, API/engine boundaries, canonical form/feedback/
evidence patterns, and exact safe checks. Do not copy the scaffold's dependency
inventory into the application or install more components. Existing CONTRACTS.md
is the behavioral equivalent of UX-CONTRACT; do not add a competing contract.
Current guide facts include 29 installed UI modules (including `radio-group`)
and 43 preset JSON files (neutral plus 42 TweakCN). shadcn CSS is inlined, not
an installed shadcn dependency. Theme access remains in Settings when the header
switcher is hidden below 1500px. Verify these facts again at final source freeze.

P2 keeps the eight existing manifest filenames coherent: dashboard (`overview`),
New run (`start-a-run`), dispatch ledger (`activity`), checks/review evidence
(`round`), History (`analysis`), Agents (`agent-library`), unpublished draft
(`agent-creation`), formatted record (`records`). Captions name the actual new
surface rather than promising removed tabs. Settings and designer chat may add
two explicitly named captures. Settling the final README selection belongs to
P4/P5. Preserve owner images until replacement captures are inspected.

P5 checks actual controls against route/local action, legal status/ownership,
success proof and relevant failure proof. References need updates only for
real changed entry points or verified stale statements. No behavior changes are
planned, so engine/driver contracts and API semantics need no new rules. The
canonical UI map gains final design/guide links and verification references.
All package handoffs must explicitly say if their docsImpact is unchanged.

## Single integration sequence and shared exit gate

1. After the plan checkpoint, recheck source/activity and assign the two exact
   P1/P2 worktrees. If their base is stale, inspect intervening changes before
   selecting the common base; never overwrite the active primary checkout.
2. Review P1/P2 handoffs against their actual diffs, apply each once in the
   integration worktree, then apply the bounded P3 change. Reject scope drift.
   Resolve shared-file questions here; workers never race on conflict resolution.
3. Freeze the integrated application tree. Check locally available dependency
   tooling without installing or borrowing another worker's mutable evidence.
   P1 may then reconcile its draft with the integrated source.
4. Run the shared offline gate once, then P4 only if browser authorization is
   available. Group desktop/narrow and theme checks in one inspection batch.
   Correct observed defects in one assigned batch; repeat affected checks once.
5. Complete P5 against that same result, record final verdict and unresolved
   findings, then stop. Publish nothing.

The gate distinguishes **plan ready**, **offline implementation ready**,
**visually verified finish**, and **release authorized**. They are separate
states. Wave 5 remains open while required visual/interaction evidence or real
defects are unresolved. A source-reviewed harness is not a successful capture.

| Check | Required evidence / current restriction |
| --- | --- |
| Plan/source integrity | Local Markdown targets, exact input hashes, allowed-file diff and `git diff --check`; recheck protected checkout |
| Static premium audit | Fresh strict JSON and exit code, every finding disposition. Baseline 21 fails. Do not call accepted analyzer limitations a clean strict pass |
| DESIGN/context | Current documenter format/lint, source token mapping and component inventory; no speculative context migrations |
| Offline project checks | Read scripts first; typecheck, production build, agent-seed validation, release tests and fake-agent suite using disposable home and database test opt-ins absent. No installs. Report missing dependencies instead of using the main dev server |
| Network dependency audit | `task audit` uses registry access. Currently deferred; report unavailable result. Do not run aggregate `task checks` and imply all checks passed when this is skipped |
| PostgreSQL tests | `task test:pg` creates/drops databases and is prohibited now. No storage change is planned; a new storage dependency requires rescoping and explicit permission |
| Fixture browser regression | After permission: frozen build; `verify-run-page.mjs --stable`, `verify-console-history.mjs --stable`, wizard, ownership and interactive-design journeys as appropriate. Audit current script isolation first; no user Vite/browser session or live resources |
| Real interaction matrix | 1440px and 390px, light/dark, reduced motion; 1600 × 1000 primary README set. Check keyboard, Escape/focus return, opened select width/collision/scrolling, stale/error/empty/loading states, drafts/retry/duplicate submit and truthful missing measurements |
| Designer regression | Anchoring and history reading during streaming, Return to latest, IME/Shift+Enter, attachments and failed send, reconnect/interrupt/resume, separate preview and explicit handoff. Fixtures/native preview do not prove provider/model success |
| Finish evidence | Every visible control's real route/action and success/failure proof; coherent screenshots/captions/provenance; final design/guide/source-map consistency; actual limitations and reviewer verdict |

No repository formatter/linter script is declared in the inspected application
package manifests. Use existing maintained tooling if discovered; do not invent
a command or install a formatter to fill that box. This planning change does not
need application regression execution.

## Plan-checkpoint evidence and remaining blockers

Completed here: isolated worktree creation; instructions/source/history/activity
inspection; two input byte comparisons; two independent read-only inventories;
fresh strict audit (exit 1, 21 findings); plan and baseline evidence persisted.
At the plan checkpoint no runtime code, guide, screenshot script, screenshots or
release files had changed. Implementation progress is recorded below.
No application tests, browser journeys, build, PostgreSQL or provider runs are
claimed in this checkpoint. Existing temporary evidence from prior workers was
not consumed or modified.

Browser interaction and screenshot completion are **pending authorization**;
the target is an isolated fixture browser/server only, after source freeze.
The user's Vite, browser and running dev server stay protected. Final DESIGN.md
rendered claims and all success/failure proof therefore remain pending. Network
dependency audit and database tests have not run. No automatic approval rejection
remains outstanding: the initial Library network failures were retried through
the authorized restricted-file transfer route and succeeded.

No exact active file collision was observed at the recorded snapshot; absence of
current overlap is not a permanent clearance. Report any newly claimed runtime
file before dispatching its package. P1/P2 began after the owner approved the
plan checkpoint, with P4 still held. Release/version decisions and
live provider verification are outside this finish plan's current authority.

## Authorized implementation progress

The owner approved P1/P2 on October 25, 2026. The Git/activity preflight showed
no new exact file claimant; primary main remained at the base with only its
existing .gitignore edit. P1 and P2 branches/worktrees were created under task-2
from the same base. GPT-6.1 Sol/high workers own only their table allowlists.
The coordinator added the shared Textarea resize default and the
[offline finish review](evidence/console-finish/finish-review.md), including all
21 audit dispositions. Twenty-four existing fixture/helper tests passed. Product visual claims,
capture execution, browser journeys and P4/P5 remain held.

P1/P2 now handed off and integrated byte-for-byte in the coordinator worktree.
DESIGN.md and console-ui.md have been source-reviewed; 89 local link/anchor
targets, token values/references, headings, whitespace and inventories passed.
The script passes node --check and static isolation/navigation invariants; it
was not executed. The final strict audit exits 1 with 19 existing composed-control
findings; [offline audit](evidence/console-finish/premium-offline.json) and the
finish review preserve their limits. The approved 13px utility floor also has
a newly documented Button sm source discrepancy outside the current allowlist.
Official DESIGN lint is unavailable, and application dependencies are absent;
no installs, typecheck/build/full suite or browser work were performed. P4/P5
and final acceptance remain pending. All deliverables are uncommitted.

## Final authorized fixture finish

The owner subsequently authorized local preview/browser/capture work and then
started their own server. The coordinator preserved that server and the user's
intentionally canceled run. P4/P5 were completed in the same isolated worktree,
with fake/demo data, owned ephemeral ports/profiles and no live provider,
database or sandbox operations. The small shared Button sm typography drift was
resolved to the canonical 13px token after this explicit expanded authorization.

The final [finish review](evidence/console-finish/finish-review.md) supersedes
earlier pending-verification status in this planning history. It records 368
passing application tests of 400 (32 skipped), 18 release tests, typechecks and
production build, 99 run-page and 40 History checks, wizard/ownership journeys,
designer/native-preview fixtures, eight refreshed primary captures and three
supplements. Computed button size, textarea resize, select geometry/focus and
intercepted sandbox recovery checks passed. No blocking defect appeared in the
inspected frames. All owned fixture services were closed.

No installation was needed: existing dependencies were copied privately with
no shared file inodes or escaping links. Strict premium still exits 1 with 19
composed-control findings; official DESIGN lint is unavailable. Registry audit,
PostgreSQL and live-provider verification were not performed. These remain
explicit limits, not implied passes. Docs and Unreleased notes describe actual
scope; no version bump or publication occurred. All work remains uncommitted.


## Authorized P6 continuation — recorded usage

The owner subsequently requested removal of API-dollar estimates in favor of
recorded provider token categories. The separate [P6 plan](console-usage-plan.md)
and package file list identify this addition; P0–P5 was snapshotted before P6.
P6 replaces the current test/capture summary: 409 tests, 377 passed, 32 skipped,
zero failures, plus final-source typechecks/build, 99 run-page checks, 40 History
checks, designer fake-SDK/native-preview verification and current screenshots.
Prior release/wizard/ownership checks above were not rerun unnecessarily.
Raw records, totals and API cost compatibility remain, while usage reports
show nullable categories, per-field coverage and main/per-model scope labels.
No collector/schema/runner changes or inference of cache expiry, per-turn data
or request hit percentage occurred. The strict audit remains 19, not clean;
other resource/official-lint limits above still apply. All work is uncommitted
in the same isolated integration branch; the user's checkout remains untouched.


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
