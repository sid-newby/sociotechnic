# Console finish review

Current combined-base evidence is in [combined-verification.json](combined-verification.json). The earlier sections below are preserved historical checkpoints.

Verdict: **bounded finish implementation and fixture verification delivered**.
The approved dashboard direction is retained. No blocking visual defect was
found in the inspected frames. The strict premium analyzer still exits 1 with
19 findings; this is not a clean static-audit pass. Official DESIGN format lint
is unavailable and was not installed. Those limits remain explicit acceptance
risks rather than invented passes.

## Integrated scope and ownership

Base: `1eb0a89d3c32319c3be5e530caf5605f1e0cecf3`. Integration branch:
`codex/console-finish-plan`. Worktree:
`/Users/sidnewby/Documents/Codex/2026-10-25/task-2/sociotechnic-console-finish`.
All changes are uncommitted; no merge, push, PR, release or deployment occurred.

P1's Sol/high worker wrote only root DESIGN.md and docs/console-ui.md. P2's
Sol/high worker wrote only scripts/console-screenshots.mjs. Their handoffs were
reviewed and copied exactly into the coordinator worktree. The coordinator then
owned all shared changes and the authorized final fixture/capture batch.
Worker branches remain codex/console-finish-docs and
codex/console-finish-captures at the same base with their handoffs retained.

Before P6, application-component changes were limited to the shared Textarea's
`resize-none` default and Button sm's canonical `text-xs` (13px) token.
Existing caller sizing, forwarding, focus/error states and component APIs are
preserved. No engine, backend, policy, catalog, model or dependency-manifest
change was made. README, product facts, builder/design docs, source-map links,
the direction brief's stale source references and Unreleased notes were
reconciled. No new release version was reserved.

## Verification

[Machine results](verification.json) and the [capture provenance](../../../../assets/console/capture.json)
record the actual results and source/build digests. Existing installed packages
were copied privately, excluding caches; copied regular files have distinct
inodes and all 1,631 dependency links resolve within the isolated tree. No
installation or writable dependency link to the active checkout was used.

| Check | Actual result |
| --- | --- |
| Engine TypeScript | `node sociotechnic/node_modules/typescript/bin/tsc --noEmit -p sociotechnic`: passed |
| Web TypeScript | Private local `tsc -b --noEmit`: passed |
| Production build | Private local `tsc -b` then `vite build`: passed; existing >500kB chunk advisory remains |
| Agent initialization seeds | CLI `agents`: passed, no catalog publication |
| Release tooling | 18 tests passed; no release action |
| Application suite | 400 total, 368 passed, 32 optional/database checks skipped, 0 failed; PostgreSQL and native-skill unit opt-ins absent |
| Run-page browser | [99/99](run-page-browser.json), including exact evidence, export, control payloads, empty/error/retry and 1440/390px |
| History/Agents/Settings browser | [40/40](history-browser.json), both schemes and widths, pinned provenance/defaults, failures and restore-only with zero dispatch |
| New run browser | 18 scenario groups passed, disposable repositories and fake GitHub/agent transports |
| Ownership browser | 8 scenario groups passed using two owned fixture servers and a named browser session |
| Designer browser | [Passed](designer-browser.json), four fake SDK conversations, actual installed native preview command, zero model calls, final planned hold |
| Designer accessibility | [30 passes, zero violations and zero incomplete checks](designer-a11y.json); scoped to the conversation, not a product-wide certification |
| Primary screenshots | Eight 1600 × 1000 neutral-dark images, no browser/HTTP errors, zero dispatches; independently inspected |
| Computed style | Minimum visible shared-button text 13px; visible textareas resize:none; non-default scrollbar colors in the eight capture states |
| Authored select | Run type popup equals trigger width: 624px at 1600 and 310px at 390; viewport containment and deferred Escape focus restoration passed |
| Sandboxes UI | Browser-intercepted invalid response, retry, empty state and canceled removal confirmation; zero real sandbox operations |
| Static/source checks | Canonical DESIGN headings, YAML/reference structure, neutral palette, inventory, local links/anchors, image hashes/dimensions, syntax and whitespace checked |

The first restricted-sandbox attempts could not open loopback listeners (EPERM),
so they do not count as product failures or passing browser checks. The authorized
execution retry succeeded. A targeted popup assertion initially looked up its
trigger after Radix hid the parent dialog; it was corrected to measure before
opening. The immediate focus check was also corrected to wait for Radix's
asynchronous restoration. The final capture run passed. These were harness
assertion fixes; no product focus behavior was changed. No open-ended polishing
or extra application redesign followed the inspected batch.

## Visual review and evidence boundaries

The independent reviewer inspected eight primary frames, six 390px History/
Settings/error frames and two designer-thread frames. Text and controls were
readable, content stayed within the inspected widths, recovery actions remained
visible, and the 390px composer stayed reachable. No corrective visual edit was
recommended. Coordinator inspection included dashboard, New run, History,
Add agent, Settings, designer and Commands frames; final capture confirmation
retained the same application build.

The captures use demonstration data. Primary images use the committed demo run;
Settings/designer/Commands supplements use separate deterministic scenarios.
The [screenshot manifest](../../../../assets/console/README.md) records those
boundaries. No user run, canceled run, live database or provider was inspected
or repaired. Fixture/native executable success does not prove live model
availability, provider aliases or a live model's skill execution.

## Strict audit dispositions

The unchanged [baseline](premium-baseline.json) contains 21 errors. The offline
and final reports retain 19: 13 actionless-button and six native-select-conflict
findings. DESIGN presence and shared Textarea default findings are absent after
implementation. The external auditor and premium-ui ownership manifest were
not weakened. Source shows Radix composition/forwarding and authored Select
owners; fixture journeys exercised the shared interaction paths. This supports
specific analyzer-limit explanations, not a blanket runtime pass for every
possible caller/state. Any remaining unsupported interaction stays unproven.

The baseline locations below remain the reference for each disposition. The
proof column names the relevant runtime obligation; use the actual reports and
coverage table above, rather than treating source explanation alone as success.

| Baseline location | Rule | Source disposition | Required later proof |
| --- | --- | --- | --- |
| `sociotechnic/ui/web/src/components/add-agent.tsx:29` | `affordance.actionless-button` | DialogTrigger asChild supplies the Add agent dialog action. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/agent-versions.tsx:42` | `affordance.actionless-button` | DialogTrigger asChild supplies the Manage versions dialog action. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/hint.tsx:7` | `affordance.actionless-button` | TooltipTrigger asChild supplies focus/hover disclosure for the named help button. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/run/decision-bar.tsx:20` | `affordance.actionless-button` | Button asChild renders the owning-console anchor; ordinary actions execute through the controller. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/run/decision-bar.tsx:21` | `affordance.actionless-button` | DropdownMenuTrigger asChild opens the decisions menu; menu items call controller.execute. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/run/evidence-sheet.tsx:33` | `affordance.actionless-button` | Button asChild renders the actual pull-request anchor. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/run/run-table.tsx:38` | `affordance.actionless-button` | DropdownMenuTrigger asChild opens column visibility; checkbox items update the table. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/run/run-table.tsx:50` | `affordance.actionless-button` | DropdownMenuTrigger asChild opens row actions; menu items open dispatch/record or download the record. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/shell/run-controls.tsx:12` | `affordance.actionless-button` | DropdownMenuTrigger asChild opens Run controls; menu items call controller actions or disclosure callbacks. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/ui/dialog.tsx:72` | `affordance.actionless-button` | DialogPrimitive.Close asChild supplies dialog close behavior. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/ui/dialog.tsx:118` | `affordance.actionless-button` | DialogPrimitive.Close asChild supplies optional footer close behavior. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/ui/input-group.tsx:93` | `affordance.actionless-button` | InputGroupButton forwards props to the shared Button; callers own their action. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `sociotechnic/ui/web/src/components/ui/sheet.tsx:71` | `affordance.actionless-button` | SheetPrimitive.Close asChild supplies sheet close behavior. | Keyboard/pointer activation; accessible name; focus return and relevant failure path. |
| `DESIGN.md` | `contract.design-missing` | Missing root DESIGN.md is a real documentation gap; P1 drafts from current code and direction. | Current document format/lint, token mapping, rendered finish comparison and final evidence reconciliation. |
| `sociotechnic/ui/web/src/components/ui/textarea.tsx:6` | `form.textarea-resize-missing` | Canonical default hardened with resize-none; all prior consumers already supplied it. | Computed resize:none, auto-grow/adequate height, long input and reachable actions. |
| `sociotechnic/ui/web/src/components/form-select.tsx:12` | `ownership.native-select-conflict` | Authored Select backed by installed Radix wrapper; onValueChange is wired. Source supports an analyzer limitation, not a native control migration. | Open popup; selection, labels, keyboard, width/collision/scrolling at desktop and narrow sizes. |
| `sociotechnic/ui/web/src/components/run/evidence-sheet.tsx:25` | `ownership.native-select-conflict` | Authored Select backed by installed Radix wrapper; onValueChange is wired. Source supports an analyzer limitation, not a native control migration. | Open popup; selection, labels, keyboard, width/collision/scrolling at desktop and narrow sizes. |
| `sociotechnic/ui/web/src/components/run/log-panel.tsx:15` | `ownership.native-select-conflict` | Authored Select backed by installed Radix wrapper; onValueChange is wired. Source supports an analyzer limitation, not a native control migration. | Open popup; selection, labels, keyboard, width/collision/scrolling at desktop and narrow sizes. |
| `sociotechnic/ui/web/src/components/run/use-run-actions.tsx:103` | `ownership.native-select-conflict` | Authored Select backed by installed Radix wrapper; onValueChange is wired. Source supports an analyzer limitation, not a native control migration. | Open popup; selection, labels, keyboard, width/collision/scrolling at desktop and narrow sizes. |
| `sociotechnic/ui/web/src/components/shell/app-sidebar.tsx:37` | `ownership.native-select-conflict` | Authored Select backed by installed Radix wrapper; onValueChange is wired. Source supports an analyzer limitation, not a native control migration. | Open popup; selection, labels, keyboard, width/collision/scrolling at desktop and narrow sizes. |
| `sociotechnic/ui/web/src/theme/theme-switcher.tsx:10` | `ownership.native-select-conflict` | Authored Select backed by installed Radix wrapper; onValueChange is wired. Source supports an analyzer limitation, not a native control migration. | Open popup; selection, labels, keyboard, width/collision/scrolling at desktop and narrow sizes. |


## Remaining limits and resource state

- Strict premium audit: still exit 1 / 19 findings, with source and fixture
  evidence retained. No claim of a universally clean static gate.
- Official `designmd` is absent from PATH and the inspected existing package
  trees/caches. Supported source/structure/token checks ran; none replaces the
  official CLI. A separately authorized official tool installation would be
  needed for that exact lint command; no install was attempted.
- Registry dependency audit and PostgreSQL integration were not run in this
  local/offline scope. `task checks` is not reported as passed because its
  registry audit was not executed.
- Native preview/fixture proof does not establish provider/model success.
  Formal cross-device/high-contrast/complete accessibility coverage is not
  claimed beyond the recorded scenarios.

Owned fixture servers used OS-assigned port 0 and isolated headless profiles or
named browser sessions. Their finally handlers closed only owned browser/server
handles and disposable homes. Capture requests were same-origin GET/HEAD only;
sandbox responses were intercepted before reaching the API. No port-clearing,
user-server restart/stop or broad process kill occurred. The normal console and
other existing listeners were left alone; the owner's deliberately canceled run
was not treated as a defect. No owned long-lived preview was left running.

The primary checkout remains on its original base and its exact .gitignore edit
is preserved. The [complete changed-file list](changed-files.txt) records the
reviewable uncommitted scope. No action has an uncertain outcome or an
outstanding automatic-approval denial.


## P6 final revision — provider usage reporting

The owner explicitly added removal of API-dollar estimates. P6 is implemented
without changing collectors, adapters, runner, schema, raw records or historical
totals. Dashboard and History use Cache reads; shared metric/dispatch sheets,
History cohort/row detail and optional table/CSV columns expose recorded input,
output, cache reads/creation and thinking subsets with missing-data coverage.
Image and per-turn detail remains explicitly unreported. Designer labels its
last recorded aggregate without inventing categories.

Nested main-agent usage excludes auxiliary calls. Per-model pipeline totals
may include them and are a fallback, never added to main usage. Snapshot sums
may be cumulative; labels do not claim deduplicated session usage. Codex cache
creation is unavailable even for historical synthetic zero. Measured zero is
retained for actually reported counters. No cache-hit ratio, warm state or
expiry is inferred. Whole-cohort coverage is computed before paging.

Final P6 checks supersede the earlier application counts/captures above:

| Check | Current evidence |
| --- | --- |
| Engine and web typechecks | Passed against private copied dependencies |
| Production build | Passed; existing chunk-size advisory retained |
| Application suite | 409 tests: 377 passed, 32 optional skips, zero failed; separate tests structure |
| Run-page browser | [99 passed](usage-run-page-browser.json), dashboard dollar absence and usage interactions included |
| History browser | [40 passed](usage-history-browser.json), full-cohort breakdown, coverage, token-day bars and cache-read drilldown included |
| Designer | [Fake SDK plus actual native preview](usage-designer-browser.json), four fake queries, zero model calls; [axe](usage-designer-a11y.json) zero violations/incomplete |
| Primary and supplements | Eight fresh 1600px captures plus three refreshed 1440px supplements; image/build/source hashes verified |
| Strict premium | [19 errors, exit 1](premium-usage.json), same 13 actionless-button and six authored-select findings |

Current dashboard, History dark/light desktop and narrow frames, designer and
Commands were inspected after P6; no blocking defect was found in that bounded
batch. Prior source explanations remain explanations, not new per-control
runtime passes. The capture manifest now hashes tracked and untracked source
so the new shared component is covered. Every fixture uses disposable data;
model/provider success and historical cache timing remain outside this proof.

[Current machine summary](verification.json) distinguishes final P6 checks from
prior release/wizard/ownership checks. [P6 files](usage-package-files.txt) and
[all changed files](changed-files.txt) give the exact uncommitted scope. The
coordinator is the sole integration owner. Review projection/nullability and
API compatibility first, then UI/CSV, tests, docs and current captures in one
integration pass. No implementation from the separate orchestration PRD is
included. No commits, installs, pushes, PRs, releases or user-service changes.


## Production dependency audit addendum

After explicit approval to close the registry-lookup gap, the existing
`pnpm audit --prod --audit-level high` check ran with JSON output using the
already-installed pinned pnpm 12.15.0 executable. The configured registry was
`https://registry.npmjs.org/`. Exit 0: zero informational, low, moderate, high
or critical vulnerabilities (374 reported total dependencies). No installation
or dependency upgrade ran. Before/after hashes of both package manifests, the
lockfile and workspace configuration are identical.

[Registry response](production-dependency-audit.json) and
[execution/hash record](production-dependency-audit-result.json) close the
earlier documented registry-audit gap. This supersedes earlier statements in
this evidence history that the registry audit was not run.

The aggregate `task checks` command was not invoked. Final P6 typechecks, build
and application tests passed individually, followed by this production audit.
Agent seed validation and 18 release tests passed at the prior finish checkpoint;
their relevant inputs were unchanged by P6. No passed suite was unnecessarily
repeated. PostgreSQL remains optional for this projection-only scope and was not
run. Strict premium remains 19/exit 1; official DESIGN lint remains unavailable.
This is still an uncommitted patch, not a release or publication assertion.
