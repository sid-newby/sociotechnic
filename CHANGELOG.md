# Changelog

Release notes are committed before publication. [GitHub Releases](https://github.com/sid-newby/sociotechnic/releases) confirms which versions shipped.
Dates on backfilled entries use America/Chicago. See the [release guide](sociotechnic/docs/releasing.md).

## v0.8.0

- Add a bundled team-writing standard with original Unslop and Technical Writing references for human-readable prose. Preserve facts, uncertainty, code and required record syntax; keep writing review within the current response.
- Let immutable agent releases append selected skills without refreshing previous resource bytes. Reject conflicting selections, duplicate resources and additions that shadow native skills; preserve existing pins, settings and custom metadata.
- Give initial and resumed native designer queries their pinned skill entrypoints and temporary reference roots, with cleanup on completion, failure and interruption. Preserve native Impeccable, transcripts and human handoff gates.
- Apply the writing standard to this repository's development assistant. Runtime catalog publication remains an explicit operator action.

## v0.7.0

- Let planners ask the human specific questions before pinning a plan or dispatching a builder, including after research. Show the questions in the console and retain dispatch-bound answers for resumed planning with mandatory plan review.
- Preserve review/report requests as written deliverables instead of assuming they need an application integration. Reject stale replies and retain answer drafts on failed saves.
- Replace console API-dollar estimates with recorded token categories, cache-read coverage and report scopes in dashboard/detail sheets, History and optional CSV columns. Preserve raw records and existing totals; unavailable counters remain unknown, and thinking is never added twice. No cache-hit, expiry or per-turn inference is made.

- Document the shipped console design system and UI builder conventions, preserving the approved dashboard direction and runtime token ownership.
- Refresh the console screenshot set and capture provenance against current dashboard, History, Settings and designer fixtures; repair retired capture selectors and strengthen isolation and computed-style checks.
- Keep compact shared buttons at the established 13px utility floor and make non-resizable Textarea behavior the shared default.

## v0.6.1

- Keep Agent library profiles, roster selection, open disclosures and version drafts stable while live run updates arrive. Reuse the console run list and avoid refetching immutable run assignments on each event.
- Preserve loaded History results during background refreshes and keep readable data with explicit retry after refresh failures. Add browser regression coverage for irregular SSE updates, slow responses, failures and scope changes.

## v0.6.0

- Rebuild the run console around an inbox sidebar, decision bar, evidence sheets, live summary cards, recorded token chart and Dispatches/Records/Log/Decisions table, with column customization, CSV export and exact record drill-down.
- Add History with bounded database cohorts, recorded token/cost/time coverage, role and round views and interrupted outcomes. Show pinned configurations and metric, feedback and cohort provenance in the in-run Agent library.
- Save browser-owned New run hold defaults and pin them per run. Preserve mandatory plan review, add guarded restore-only recovery that never starts agents, and retain evidence selections across reload.
- Give the designer conversation an anchored chat thread, a reachable composer, readable Markdown/code and image sharing. Preserve native /impeccable questions and separate-tab samples and prototypes, with streaming history navigation, retry, interruption and resume.
- Keep the planner-to-builder handoff bound to the returned artifact snapshot and reviewed plan digest. Park revised designs that no longer match the reviewed plan, and improve chat and shared scroller accessibility.
- Expose single-step execution, hold-after-transition, early bound overrides, dispatch interruption, local concurrency settings, Stop notes, explicit reopen discard and PR text without publishing. Preserve ownership gates and local-testing/merge confirmations.
- Adopt shared shadcn tokens and components, local Geist, chart and sidebar colors and light/dark theme presets. Start in neutral dark and remember this browser's theme.

## v0.5.0

- Replace design packets with a normal turn-based Claude Code chat whose Markdown agent definition runs the installed /impeccable command with native tools and windows.
- Support image input and output, persistent SDK history, Markdown work-product handoffs and follow-up assignments in the same conversation. Apply committed catalog additions at console startup and recover unused retired designer bindings in place.
- Interrupt one in-flight dispatch from the CLI or API while the rest of its step keeps running; the interrupt is recorded with the human's note, and the step retries under the existing retry bound with that note as the reason.
- Add an optional installation limit on concurrent local dispatches, stream driver log lines as SSE events with a paged catch-up route, and download any record as a file. Correct the references where they described console controls that only the legacy console offers.
- Move the product record to `PRODUCT.md` at the repository root and record the console redesign brief and plan under `dox/`; the console itself is unchanged in this release.

## v0.4.2

- Show when another console owns a run and open that console at the selected job instead of offering a local resume that cannot succeed.
- Refresh ownership across consoles, distinguish interrupted drivers, and preserve existing driver locks and recovery checks.

## v0.4.1

- Fix browser provisioning on Debian-compatible Linux ARM64 by installing system Chromium and its sandbox package instead of requesting an unavailable Chrome for Testing build.
- Verify automatic installation, both browser CLIs, Linux checks and Git import in a fresh real Sandbox, with owned-resource cleanup and the original run preserved.

## v0.4.0

- Add opt-in browser builder profiles with pinned agent-browser and Chrome DevTools verification skills, keeping default assignments and read-only role permissions unchanged.
- Isolate browser sessions per dispatch, verify Chrome launch before use, clean up only owned sessions, and prepare browser tools inside selected Sandbox builds. Real-VM browser verification remains experimental pending a free Sandbox slot.

## v0.3.3

- Publish the starter base branch to a private GitHub repository before planning a New repository run, with setup errors and retry guidance.
- Keep the record viewer usable when formatting fails, show the original source, and prevent rendering tests from sharing the development server's Vite cache.

## v0.3.2

- Remember the selected new-run environment and valid sandbox CPU, memory and concurrency settings across browser sessions, including canceled dialogs.
- Keep saved resources when switching to local execution, and allow the form to work when browser storage is unavailable.

## v0.3.1

- Connect Docker Sandbox agents to Context7 through Docker's host-managed MCP gateway while keeping credentials on the host and preserving the two-tool role allowlist.
- Stop sandbox dispatches with setup guidance when Context7 is unavailable, and verify gateway discovery in the real-VM smoke check.

## v0.3.0

- Add retained-sandbox management and configurable installation sandbox slots, separate from workers per run.
- Retry failed planning with human feedback and hold for plan review before building.
- Remove preserved sandboxes after confirmed GitHub merges and report cleanup blockers without losing the merge record.

## v0.2.1

- Fix Docker Sandbox startup for standard pinned agent configurations, preserving custom-agent and nested-worker role validation.
- Document recovery for retained VMs affected by the parser failure.

## v0.2.0

- Create a new folder directly from the run wizard and remember a chosen browsing start point across browser sessions, defaulting to `~/Prog` or the user's home folder.
- Add a New repository run type that requires local Git tracking and retains the initial commit and planning review flow.
- Suggest the bundled React + NestJS house special for UI work without an existing scaffold, while preserving the user's stack choice and design approval.

## v0.1.5

- Show the changelog's semantic version beside the application name in matching typography.
- Embed the version when building the console, using the same parser as GitHub releases.
- Keep the version visible on narrow screens without crowding header actions.

## v0.1.4

- Require release notes and the next version in each patch or minor PR before merge.
- Add a local changelog command and CI validation against the release label and current main.
- Publish the version reserved in the tested commit without post-release file changes or extra credentials.
- Backfill the missing v0.1.1 through v0.1.3 release notes.

## [v0.1.3](https://github.com/sid-newby/sociotechnic/releases/tag/v0.1.3) - 2026-10-24

### What's Changed

* Fix model-specific effort options in agent configuration by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/7


**Full Changelog**: https://github.com/sid-newby/sociotechnic/compare/v0.1.2...v0.1.3

## [v0.1.2](https://github.com/sid-newby/sociotechnic/releases/tag/v0.1.2) - 2026-10-24

### What's Changed

* Pin CI and release runners to Ubuntu 24.04 by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/6


**Full Changelog**: https://github.com/sid-newby/sociotechnic/compare/v0.1.1...v0.1.2

## [v0.1.1](https://github.com/sid-newby/sociotechnic/releases/tag/v0.1.1) - 2026-10-24

### What's Changed

* Refresh console screenshots with consistent framing by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/1
* Use one Azure Builder for EASY and COMPLEX work by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/2
* Add PR labels, CI checks and gated GitHub releases by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/3
* Use the Node 24 pnpm setup action by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/4
* Release merged PRs from protected main pushes by @sid-newby in https://github.com/sid-newby/sociotechnic/pull/5

### New Contributors

* @sid-newby made their first contribution in https://github.com/sid-newby/sociotechnic/pull/1

**Full Changelog**: https://github.com/sid-newby/sociotechnic/compare/v0.1.0...v0.1.1

## 0.1.0 - 2026-10-24

First release of Sociotechnic.

- Local web console for planning, building, reviewing and accepting changes.
- Claude Code and Codex execution with versioned agent profiles and explicit
  model, tool and budget settings.
- PostgreSQL storage for jobs, evidence and immutable agent releases.
- Commit-bound checks and reviews, bounded retries and separate human decisions
  for acceptance, publication and merging.
- Design interviews and composition approval, comment cleanup, agent discovery,
  infrastructure and Azure specialists, and experimental Docker Sandbox runs.

This is an experimental release. Fake-agent tests verify workflow behavior;
they do not establish live model quality, account access or production readiness.
