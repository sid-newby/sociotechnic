# Browser verification for builders

Two opt-in COMPLEX and EASY browser builders will receive a packaged verification
skill. Default assignments stay unchanged. Agent-browser owns compact snapshots and reads;
Chrome DevTools owns network, console and performance diagnostics. This uses
their existing Bash permission and does not expand read-only roles or gates.

## Scope and stages

1. Add a curated, version-pinned skill with upstream provenance and a shared
   tool installer/verifier. Local setup is an explicit task; Sandbox dispatches
   prepare the tools inside their VM only when their pinned skill requires them.
2. Give each dispatch its own browser sessions and bounded cleanup. Pass the
   same environment to Claude and Codex; never fall back to the host from a VM.
3. Publish immutable skill-bearing specialist releases for the two builder templates and
   export the complete catalog. Existing runs retain their recorded releases.
4. Verify skill snapshots, tool/version failures, session ownership, provider
   propagation and Sandbox preparation with real subprocess fixtures. Exercise
   the installed CLIs and distinguish Linux provisioning from fake-transport tests.

`docsImpact`: behavioral and driver contracts, browser setup guide, CLI/engine
references and development feature map. No target-repository schema, record
format, role permission or UI design change is required.

Allowed scope: `Taskfile.yml`, the root README, `sociotechnic/{AGENTS,CONTRACTS}.md`,
the affected technical references and feature map, `ui/browser-tools.ts`, provider
and Sandbox adapters, skill parsing, the new packaged skill, browser/skill/Sandbox
tests and fixture transport, the existing real-VM smoke script, and the complete
new catalog migration bundle. No visual design or target-repository change.

## Verification record, October 25, 2026

Follow-up scope: repair Linux ARM64 provisioning in `ui/browser-tools.ts`, add a
regression in `tests/browser-tools.test.ts`, and rerun the real VM smoke. Update
the behavioral contract, setup guide, this verification record, development map
and changelog with the observed result. No catalog, profile or target-run changes.

- Both installed CLIs rendered the disposable proof page on the host and their
  isolated sessions closed successfully.
- Real subprocess fixtures cover binary/runtime failures, pinned manifests,
  exact-session cleanup, Claude/Codex environment propagation, reader-role refusal,
  specialist creation and immutable pinning. The fake Sandbox transport covers
  preparation failure before provider execution and a successful retry.
- With the operator's authorization, capacity was temporarily raised from one
  slot to two. The first real VM exposed Chrome for Testing's missing Linux ARM64
  download. Debian system Chromium resolved the failure; the installer now uses
  `chromium` and `chromium-sandbox` through apt on that architecture.
- A second, fresh Debian 13 ARM64 VM passed automatic tool/browser installation,
  rendering through agent-browser 0.39.2 and Chrome DevTools 1.12.0, Linux checks,
  Git bundle import with a matching commit, and owned VM/fixture cleanup.
  The limit was restored to one. Only the original retained VM remained, with
  the same ID, stopped state and last-used timestamp; its job remained planned.
  No provider requests or browser-enabled live model dispatch were tested.
- Repository checks passed: 286 tests passed, 31 PostgreSQL tests skipped,
  18 release tests passed, and the production dependency audit was clean.
