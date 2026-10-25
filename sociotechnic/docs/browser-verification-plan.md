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

- Both installed CLIs rendered the disposable proof page on the host and their
  isolated sessions closed successfully.
- Real subprocess fixtures cover binary/runtime failures, pinned manifests,
  exact-session cleanup, Claude/Codex environment propagation, reader-role refusal,
  specialist creation and immutable pinning. The fake Sandbox transport covers
  preparation failure before provider execution and a successful retry.
- Real-VM browser installation/rendering was refused by capacity admission before
  provisioning: a retained run occupied the only configured slot. The limit and
  retained run were preserved. This does not establish Linux browser setup or
  a successful browser-enabled live model dispatch.
