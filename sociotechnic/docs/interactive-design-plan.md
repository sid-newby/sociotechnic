# Interactive design replacement

Implement local sessions first on `codex/interactive-design-session`. The user
has authorized live testing and fixes without a token budget. Fixture streams
must be clearly distinguished from provider evidence.

1. Replace new packet dispatches with a generic resumable session lifecycle.
   Keep historical packet readers and approved handoffs; require explicit
   migration for unfinished legacy sessions. Reject Docker before inference.
2. Pin and preflight the actual Impeccable directory and platform executable.
   Load it through native SDK skill discovery. Run its own decision server and
   command protocol rather than reimplementing questions or options.
3. Store opaque SDK transcript entries and session artifacts in PostgreSQL,
   with driver-lease guards, explicit session-ID resume, durable user input,
   interrupt/recovery and surfaced persistence failures.
4. Replace the packet form with conversation, native question replies, errors,
   interrupt/resume and a separate native preview window. Preserve existing
   console tokens, Markdown rendering and ownership navigation.
5. Fingerprint the final artifact set for explicit human approval, and bind the
   final planner/build/review handoff to that digest. No implementation edits
   occur during design.
6. Verify deterministic SDK, native subprocess, HTTP, PostgreSQL and browser
   interaction including failure and recovery. Report live verification
   accurately and exercise the real Claude session through the application.

`docsImpact`: CONTRACTS.md, AGENTS.md, design-ceremony.md, cli-reference.md,
engine-reference.md, scaffolds.md, development.md feature map, README, PRODUCT.md, DESIGN.md
and changelog, plus clearly labeled integration evidence and screenshots.
Allowed implementation scope: design modules, engine/job state,
driver/SDK integration, records, HTTP/CLI, design UI/model/styles, agent catalog
release bundles, focused tests/fixtures and browser verification script.

Required checks: `task checks`, `task test:pg`, native Impeccable decision-page
start/update/answer/stop checks and fixture-backed browser journey. Integration
proof does not establish live model creative quality.
