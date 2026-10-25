# Sociotechnic repository instructions

@AGENTS.md

The imported [AGENTS.md](AGENTS.md) contains shared development rules and this
repository's branch cleanup policy. If reading this file with a file tool, open
that file explicitly rather than assuming the import was expanded.

## Get oriented

Sociotechnic is the app in this checkout. The root [README](README.md) explains
its web experience. Start technical work from the
[feature-to-code map](sociotechnic/docs/development.md#feature-to-code-map), then
read the relevant source, callers and tests. Load the sections needed for the
task rather than the whole repository.

| Working on | Read first |
| --- | --- |
| Commands, HTTP routes, console lifecycle or publishing | [CLI and driver reference](sociotechnic/docs/cli-reference.md) |
| Planning, tiers, roles, records, gates, bounds or state | [Engine and state reference](sociotechnic/docs/engine-reference.md) |
| Agent execution and human decisions | [Driver contract](sociotechnic/AGENTS.md) |
| Finding specialists or requesting bounded help | [Agent discovery](sociotechnic/docs/agent-discovery.md) |
| Behavior changes | [Behavioral contracts](sociotechnic/CONTRACTS.md) |
| Comment-cleanup workers | [Cleanup workflow](sociotechnic/docs/comment-cleanup.md) |
| Setup, checks, dependencies or source ownership | [Development guide](sociotechnic/docs/development.md) |
| Contributions, licenses or releases | [Contributor guide](CONTRIBUTING.md), [release guide](sociotechnic/docs/releasing.md), [third-party notices](THIRD_PARTY_NOTICES.md) |
| Fable interviews, previews and design approval | [Design ceremony](sociotechnic/docs/design-ceremony.md) |
| Bundled project starters and validation before use | [Scaffold maintenance](sociotechnic/docs/scaffolds.md) |
| Product scope, UI behavior or visual design | [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) |

The engine lives in `sociotechnic/src/`; its HTTP server and SDK driver live in
`sociotechnic/ui/`; the React console lives in `sociotechnic/ui/web/`. The
database owns jobs, records and immutable agent releases. Agent library owns
creation and version edits; `sociotechnic/seeds/agent-releases/*.json` carries the
complete release history through migrations. Export and check catalog changes
before committing. `sociotechnic/seeds/agents.json` holds original initialization
definitions and must agree with the engine role table. `source/` holds upstream
reference copies, separate from the app.

## Planning a capability

1. Find the existing command, route, helper or role that owns the behavior.
   Trace the affected path from the console or CLI into the engine and records;
   consult the feature map for entry points and existing verification.
2. Read the relevant contract before proposing changes. Reuse established tools
   and keep engine decisions, driver execution and human gates in their existing
   owners. Verify documentation claims against current source and tests.
3. Include affected contracts, technical references and map entries in the plan's
   `docsImpact`, stages and file scope. A moved module or changed entry point can
   require documentation even when user-facing behavior stays the same.
4. Name the checks that will demonstrate the changed behavior. Distinguish fake
   agent tests, optional database integration and live model runs; one does not
   establish the others.

Keep this file as an entry point. Shared maintenance rules belong in `AGENTS.md`,
the detailed source map belongs in the development guide, and command/API detail
belongs in the technical references. Update the affected links with each feature
or move instead of copying a second inventory here.

## Engine checkout versus target repository

An SDK dispatch runs from the Sociotechnic home, while its brief can name a
different repository or job worktree. Resolve target paths from the brief; do
not assume the process's current directory is the code being changed. These
development instructions and branch cleanup policy apply to Sociotechnic itself,
not every target repository. Runtime roles still obey their own prompts, assigned
scope, write guards and human gates. Files under `.sociotechnic/staging/` are
agent input/output staging, not canonical records or files to hand-edit while
developing the app. Read committed records through the console or job store.
