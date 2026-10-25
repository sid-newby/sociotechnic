# Interactive design replacement

Implement local sessions first on `codex/interactive-design-session`. The user
has authorized live testing and fixes without a token budget. Fixture streams
must be clearly distinguished from provider evidence.

1. Replace new packet dispatches with a generic resumable session lifecycle.
   Keep historical packet readers and approved handoffs; require explicit
   migration for unfinished legacy sessions. Reject Docker before inference.
2. Load the normal agent Markdown file through the SDK system prompt and invoke
   the installed /impeccable command with native Bash and Skill tools. Remove
   the command MCP adapter, forced subcommand, host-run context and window
   suppression. Link the actual installed plugin into normal skill discovery.
3. Store opaque SDK transcript entries, messages, images and work products in PostgreSQL,
   with driver-lease guards, explicit session-ID resume, durable user input,
   interrupt/recovery and surfaced persistence failures.
4. Replace the packet form with a turn-based chat, image input/output, native
   question replies, errors and interrupt/resume. Native Impeccable opens its own
   windows. Preserve existing
   console tokens, Markdown rendering and ownership navigation.
5. Return HANDOFF.md and samples/prototypes to the caller, which decides the
   next step. The assignment controls whether the agent plans, prototypes,
   builds or critiques. Support repeated planner assignments and continued chat
   after handoff. Retain work-product digests for existing pipeline integrity.
6. Verify deterministic SDK, native subprocess, HTTP, PostgreSQL and browser
   interaction including failure and recovery. Report live verification
   accurately and exercise the real Claude session through the application.

`docsImpact`: CONTRACTS.md, AGENTS.md, design-ceremony.md, cli-reference.md,
engine-reference.md, scaffolds.md, development.md feature map, README, PRODUCT.md, DESIGN.md
and changelog, plus clearly labeled integration evidence and screenshots.
Allowed implementation scope: normal agent Markdown and global installation,
design modules, engine/job state,
driver/SDK integration, records, HTTP/CLI, design UI/model/styles, agent catalog
release bundles, focused tests/fixtures and browser verification script.

Required checks: `task checks`, `task test:pg`, native Impeccable decision-page
start/update/answer/stop checks and fixture-backed browser journey. Integration
proof does not establish live model creative quality.
