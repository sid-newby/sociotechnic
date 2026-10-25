# Codex subscription integration

The first Codex roles are code review (`gpt-6.1-sol`, high) and bounded research
(`gpt-6-luna`, high). These remain the baseline assignments. Agent-library
creation and version publication also support Claude/OpenAI switching for
planning, research, review, conformance and approval templates, including custom
identities. Ordinary build templates also support Codex with workspace-write
shell and edit tools in the assigned job worktree. Design and Agent-worker
templates retain Claude execution; both forms explain that restriction.
The optional [infrastructure expert](infrastructure-agent.md) supplies both plan
and build identities with pinned Terraform and container instruction resources.

Supported OpenAI choices are `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`,
`gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra` and `gpt-5.6-luna`, centralized in
`src/agent-models.ts`. They match the installed CLI's visible model catalog checked
on October 24. All use high effort in this adapter. A listed model is not proof
of account access or live execution. See the [selection plan](agent-model-selection.md).

## Scope and implementation

The earlier “Consider agents for new runs” chat proposed these assignments but
did not implement a Codex runner. The October 24 assessment found only Claude SDK
and fake execution. The local Codex CLI was installed and logged in with ChatGPT;
that alone did not connect it to Sociotechnic.

1. Preserve existing role names and records. Add explicit provider bindings to
   `src/roles.ts`, retain the Claude prompt definitions, and pin the selected
   model/effort on each engine dispatch. Group usage by binding.
2. Add `ui/codex-runner.ts` and `ui/codex-read-tools.ts`. Route compatible
   reader templates through subscription-authenticated Codex, supply bounded read
   tools, publish successful records, and preserve deadlines and stop behavior.
   Reuse existing Context7 loading and the console driver.
3. Have both skills use the shared console execution path. Update the driver
   contract, behavioral contracts, CLI/engine references and feature-to-code map.
4. Verify real subprocess execution and tool boundaries with deterministic tests,
   run the repository checks, then make bounded live calls to both selected models.
   Report live access failures separately from deterministic test results.

Allowed scope: this guide; `CONTRACTS.md`, `AGENTS.md`, `docs/{cli-reference,
engine-reference,development}.md`; `src/{roles,agents,usage}.ts`;
`ui/{runner,driver,codex-runner,codex-read-tools,codex-context7}.ts`;
`ui/web/src/{model.ts,components/technical.tsx}` for truthful tool/budget labels; tests and fixtures for these
paths; the project and global Sociotechnic skills. No target application code,
runtime job records, new agent roles or visual redesign is required.

`docsImpact`: provider routing, authentication prerequisites, reader permissions,
token normalization, skill execution and feature-map entry points change. Update
the documents in this scope with the implementation. The root app README needs
no command inventory; setup belongs in the technical development guide.

## Setup

Install a Codex CLI supporting `exec --ignore-user-config`, `--ignore-rules`,
`--ephemeral` and JSON output (initial verification uses 0.159.3). Run
`codex login`, choose ChatGPT, then confirm `codex login status`. The same account
must have access to the exact selected models. Authentication does not establish
model entitlement; only a completed inference verifies access.

Set `SOCIOTECHNIC_CODEX` to an executable path when `codex` is not on PATH. Restart
the console after updating Sociotechnic. Existing dispatches keep their recorded
models; newly created code-review and research dispatches use the Codex models.
Missing login, unsupported CLI flags, model access failures and rate limits fail
the dispatch through the normal bounded engine retry path. There is no automatic
Claude or API-key fallback.

Codex uses saved CLI authentication. The runner forces ChatGPT login and removes
API-key and external-access-token environment variables from the child. It never
reads or copies auth.json.
See OpenAI's [authentication](https://learn.chatgpt.com/docs/auth) and
[non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
documentation.

## Reader permissions and usage

Codex runs from a temporary directory with a read-only sandbox and shell tools
disabled. The tool orchestration host is enabled for discovery and tool calls.
Only the three bounded readers are preapproved on the local MCP server; each
advertises read-only annotations. Its tools read files, match path globs and search literal text
only inside canonical target-checkout, worktree and dispatch-input roots. Symlinks
cannot escape those roots. File reads and result sizes are bounded. These tools
cannot run tests or write code. The successful final response is written verbatim to the assigned staged output;
the shared ingestion boundary parses and commits it with dispatch completion.
Only that committed record can affect the engine's gate.

Live web search and Context7 follow the pinned template tools: planner and
research templates have both; security review has web search only; the other
review, conformance and approval templates have neither.
Only `resolve-library-id` and `query-docs` are enabled and preapproved there. HTTP
header secrets travel through environment references; stdio credentials use a
private temporary file and wrapper, keeping values out of Codex's arguments.
The code reviewer has neither. User/project Codex settings, plugins and hooks are
not loaded into this role. The Claude agent Markdown body supplies the role
instructions; its Claude frontmatter is retained for historical bindings and
validated independently of the Codex model selection.

Codex reports input including cached input. The runner subtracts cached input
before reporting uncached input, retains output and cache-read counts, and leaves
unreported measurements absent. It does not estimate subscription charges. The
deadline bounds the whole process; `maxTurns` additionally caps completed tools
for Codex because its CLI emits one execution turn rather than SDK model turns.

## Database records and staging

Pinned instructions and role settings resolve from immutable PostgreSQL releases.
Committed `seeds/agent-releases/*.json` migration bundles carry complete historical
versions across upgrades; they are not runtime fallback definitions. The model
selection changes above remain part of those complete configuration documents.

Dispatch inputs are materialized from committed database records. The adapter
reads those inputs through its bounded MCP roots and writes only its final
assigned staged output. Ingestion rejects foreign or obsolete dispatch output;
failed database persistence cannot become a successful completion. Clearing idle
staging does not delete code-review or research evidence. Database credentials
are not an agent tool or permission and are stripped from child environments.

## Verification

The deterministic repository gate passed: engine/web type checks, production
build, thirteen agent definitions, 135 tests (one optional PostgreSQL test skipped),
and the production dependency audit. The focused Codex tests include a real local
MCP subprocess behind a fake CLI; they do not establish model/tool access.

Browser inspection of the isolated demo confirms Sol/high and Luna/high profiles,
read-only tool lists, distinct Codex tool-call labels, and historical Sonnet model
labels. The premium UI static audit reports three existing Radix trigger wrappers
as actionless buttons; each is owned by its Dialog/Tooltip/Collapsible trigger and
is outside the changed profile labels.

Live verification on October 24 used Codex CLI 0.159.3 with saved ChatGPT login:

| Role | Observed behavior | Result |
| --- | --- | --- |
| Sol/high code reviewer | Seven bounded file reads and one glob; identified a seeded `n * 3` regression in a function required to double its input | Valid `VERDICT: CHANGES`, matching fixture HEAD, one high finding |
| Luna/high researcher | Read the source and searched official Node.js documentation about `readFileSync` encoding | Valid `STATUS: DONE` with file/line and primary-source evidence |

The captured CLI events contained no shell execution or file changes. Both
responses passed the existing record parser. The models used 68,367 and 78,588
reported total tokens respectively, including cache reads. These are CLI-reported
usage measurements, not subscription charges. [Recorded smoke evidence](evidence/codex-reader-smoke.json)
contains the fixture, records, model bindings, normalized counters and tool counts.
Context7 forwarding is covered by deterministic configuration tests; this live
research probe exercised web search without Context7.

The initial live probes exposed two integration requirements: the orchestration
host must be enabled, and the bounded MCP readers must declare read-only behavior
and have explicit tool approvals. The user approved the host on October 24.
Shell tools, plugins, child agents and arbitrary writes remain disabled.

## Ordinary Codex builders and packaged skills

Only build templates whose tools fit the shell/edit/network adapter can select
Codex; Agent coordinators and design tools remain unsupported. Builder processes
still start with isolated configuration, saved ChatGPT login, high effort, fixed
tools, disabled plugins/hooks/child agents, bounded lifetime/output and no provider
fallback. Their shell workspace is the assigned worktree using workspace-write;
no extra writable Git roots are added.
A branch/HEAD-bound commit_changes MCP tool stages explicit files and commits
without hooks, fsmonitor or signing helpers; it refuses clean filters that could
execute host code, an already-staged index and changed branch/HEAD. Shell network access follows WebSearch in the
pinned template. Shell tools can access credentials and services available in their
execution environment, including Docker if configured; this is not a microVM.
Infrastructure mutations need explicit scope/authorization in the brief. Existing
engine checks, clean-worktree and commit binding, reviewers and human gates apply.

Completed shell and file-change events count toward the tool-call budget. Reader
roles continue to reject them. The successful final build record is published by
the runner and ingested by the same validated completion path. Failure, cancellation
or timeout publishes no success record; already-made worktree edits remain for
normal retry/rework handling.

Packaged skills are UTF-8 entrypoints and text references/templates, frozen in
release `skillResources`. The adapters load the entrypoints and materialize the
remaining files under a disposable root for on-demand reads. These are not local
Codex plugins or automatically discovered installed skills; no tool entitlement
is inferred from a skill's text. The SDK receives the same snapshots instead of
trying to resolve their names as external installations. Future publications and
source updates cannot replace a running or pinned skill snapshot.
The [Azure SME](azure-sme.md) also retains inert upstream helper scripts;
materialization does not execute them or grant a reader shell access.
