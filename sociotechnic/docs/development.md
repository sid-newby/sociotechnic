# Local setup and development

[App guide](../../README.md) · [CLI and driver reference](cli-reference.md) · [Engine and state reference](engine-reference.md)

## Local setup

Run these commands from the repository root. You need Node 24 or newer, pnpm 12 (pinned in `sociotechnic/package.json`), git, go-task and Claude Code configured to run agents. Codex CLI logged in with ChatGPT is required for code review and research; see
[Codex integration](codex-integration.md). PostgreSQL 17 on localhost:5433 is the default store for agent releases and run history.

```bash
task install
task checks
task db:init
task ui
```

The console opens in your browser at `http://127.0.0.1:4747`. It runs in the background. Stop it with `task ui:stop`. Follow [Start a run](../../README.md#start-a-run) to use the web interface. `task ui` builds the React workspace before starting or reusing the server.

Start PostgreSQL before `task db:init`. Use `SOCIOTECHNIC_DATABASE_URL` for another connection URL. `SOCIOTECHNIC_DATABASE_URL=off` disables job operations and does not provide file-backed jobs. Rerun `task db:init` when upgrading to apply schema and committed complete catalog migrations. [State-store details](engine-reference.md#state-store) explain import and recovery limits.

## Console development

`task dev` stops listeners on ports 5173 and 4748, starts Vite and a development API, and opens `http://127.0.0.1:5173`. Ctrl-C stops both. Port cleanup requires `lsof`. To develop against an existing console without restarting its driver:

```bash
SOCIOTECHNIC_API_URL=http://127.0.0.1:4747 task dev
```

This clears only port 5173 and leaves the existing API running when development stops. See [console lifecycle](cli-reference.md#run-console) for ports, the foreground server, legacy UI and development CSP.

## Development

For contribution scope, issue reports and PR expectations, read
[CONTRIBUTING.md](../../CONTRIBUTING.md). [Releasing](releasing.md) covers checks,
tags, public snapshots and GitHub setup. Licenses for bundled sources are listed
in [third-party notices](../../THIRD_PARTY_NOTICES.md).

Agents changing this repository should start with the root
[AGENTS.md](../../AGENTS.md); [CLAUDE.md](../../CLAUDE.md) loads those same
instructions for Claude Code. The [driver contract](../AGENTS.md) links the
technical references used when adding capabilities.

### Merge and branch cleanup

For `sid-newby/sociotechnic` only, clean up completed feature branches after their work
is merged and verified on `origin/main`. GitHub automatically deletes PR head
branches after merge. After a direct git merge, delete the merged remote branch
explicitly, prune tracking refs, and use `git branch -d` for local branches no
active worktree needs. Keep unmerged work, open PRs and active follow-ups. The
root agent instructions define the full policy; it does not apply to target
repositories or change the runtime's human gates.

Chat/thread association is not runtime ownership. Try the owning app's managed
archive workflow first. If it refuses only because it labels the current chat's
folder as primary, explicitly requested cleanup can use `git worktree remove
<exact-path>` from the retained main checkout. First verify the target is a
registered linked worktree in this repository, clean, verified merged, and unused
by jobs, tests and servers. Preserve needed ignored files. Never remove Git's
actual primary checkout, use `--force`, or edit app metadata to get around the
label. Run `git worktree prune` afterward. Verify the directory and Git
registration are gone; the app may retain a historical attachment.

```text
README.md             this app guide
sociotechnic/
  docs/               CLI, engine, development and comment-cleanup references
  CONTRACTS.md        the spec
  AGENTS.md           orchestration contract shared by both drivers
  package.json        { "type": "module" }, pinned packageManager, three runtime dependencies (pg, @anthropic-ai/claude-agent-sdk, @babel/parser), three dev dependencies
  pnpm-workspace.yaml pnpm settings: the supply chain policy
  pnpm-lock.yaml      committed lockfile
  tsconfig.json       type check only: tsc --noEmit with erasableSyntaxOnly
  bin/sociotechnic           shell shim that runs src/cli.ts with node
  hooks/guard-write.sh  PreToolUse hook for the read-only roles
  global/             SKILL.md (the global /sociotechnic skill) and sociotechnic, its POSIX shim; symlinked by task install:global
  scaffolds/          standalone project starters, import provenance and their own lockfiles; outside the engine workspace
  src/                engine
  src/db/             PostgreSQL store, schema, explicit legacy import, catalog migrations and worktree recovery
  src/job-store.ts    shared database job-operation boundary
  src/record-store.ts scoped in-memory view of committed records
  src/staging.ts      dispatch input materialization and output ingestion
  ui/                 server.ts, driver.ts, runner.ts, legacy index.html, seed/demo-job/
  ui/web/             React/Vite workspace: source, package.json, built dist/
  tests/              node:test suites
assets/               banner and console screenshots
notes/                upstream study
source/               upstream reference copies
.sociotechnic/        temporary dispatch staging, runtime files and Git worktrees
Taskfile.yml          go-task entry point
sociotechnic/seeds/agents.json       original initialization definitions
sociotechnic/seeds/agent-releases/  committed complete immutable catalog migration bundles
.claude/skills/sociotechnic/SKILL.md  the driver skill
```

Completed worktrees in this project are retired only after their work is committed,
synchronized and verified merged, with no active run depending on them. Use the
owning app’s archive/remove workflow for managed worktrees and prune stale
registrations. Keep records and worktrees still needed for testing or rework.

#### Background process checks

A working directory is inherited process state, not proof that a checkout is
still needed. In particular, idle app tool helpers can outlive the work, and a
sandbox daemon can remain after its last sandbox is removed. Investigate before
either retaining the worktree or stopping the process:

1. Identify exact PIDs, executables, parents and children. Inspect working
   directories, open project files and network clients/listeners. On macOS,
   `ps -p <pid> -o pid,ppid,stat,pcpu,time,etime,comm` and
   `lsof -nP -p <pid>` provide evidence. Do not print credential-bearing command
   arguments. An inherited cwd, low CPU use, no open source files or a listening
   port alone cannot establish whether a service is needed.
2. Cross-check actual job and driver state, running tests and development
   services, and any other consumers of shared services. For Docker Sandboxes,
   inspect `sbx ls` and `sbx daemon status`; check all local sandboxes, not just
   this project's jobs. Confirm where the live console runs. Chat association
   does not count as a consumer. Preserve unfinished work and genuinely needed
   services; a stopped run may still contain work intended for reopening.
3. When the process is a verified leftover, stop it gracefully. Prefer its own
   shutdown command, such as `sbx daemon stop` for an unused sandbox daemon.
   For idle tool helpers, recheck executable identity and cwd immediately before
   sending SIGTERM to the exact PIDs. Stop only the identified leftovers, never
   a parent app, unrelated database, shared service with consumers, or every
   process with a matching name. If shutdown fails, diagnose the specific failure
   rather than forcing worktree removal.
4. Verify the processes exited and did not restart, then repeat the clean-tree,
   merge and ignored-file checks before normal worktree removal. Preserve needed
   ignored state; dependencies, build output and disposable caches are usually
   regenerable. After removal, prune registrations and verify retained services,
   the primary checkout and synchronized `main` still work. If a dependency cannot
   be resolved safely, name the process and the actual work or consumer that
   remains uncertain instead of reporting a generic background-process blocker.

### Feature-to-code map

The [Azure SME guide](azure-sme.md) describes the optional profiles and selection.
Its sources are [the routing skill](../skills/azure-sme/SKILL.md),
[provenance](../skills/azure-sme/UPSTREAM.md),
[snapshot parser](../src/agent-skills.ts), and
[initial catalog bundle](../seeds/agent-releases/20261024-azure.json), and
[identity-guidance release](../seeds/agent-releases/20261024-azure-onboarding.json).
[Azure tests](../tests/azure-sme.test.ts) and
[skill tests](../tests/agent-skills.test.ts) verify bytes, permissions, bounds,
catalog restore and assignments; also run catalog export/check and PostgreSQL checks.

Paths in this map are relative to the Sociotechnic checkout. Read the relevant
contract and trace the implementation before extending a capability. Existing
verification below names automated suites; it does not claim a live model run or
browser interaction was exercised.

| Capability | Implementation entry points | Existing verification |
| --- | --- | --- |
| Capability roster, team awareness and bounded advisor consultation | [agent-roster.ts](../src/agent-roster.ts), [agent-versions.ts](../src/agent-versions.ts), [engine.ts](../src/engine.ts), [plan.ts](../src/plan.ts), [driver guidance](agent-discovery.md) | [agent-discovery.test.ts](../tests/agent-discovery.test.ts): actual prompts, future-agent discovery, locks, advisor retries, blocked builder, nested-worker awareness and PostgreSQL auxiliary bindings |
| CLI commands and console bridge | [cli.ts](../src/cli.ts), [console-client.ts](../src/console-client.ts) | [run.test.ts](../tests/run.test.ts), [ensure.test.ts](../tests/ensure.test.ts), [e2e.test.ts](../tests/e2e.test.ts) |
| Workflow and legal transitions | [engine.ts](../src/engine.ts), [job.ts](../src/job.ts) | [job.test.ts](../tests/job.test.ts), [e2e.test.ts](../tests/e2e.test.ts) |
| Plans, tiers and generated briefs | [plan.ts](../src/plan.ts), [brief.ts](../src/brief.ts), [roles.ts](../src/roles.ts), [initialization seeds](../seeds/agents.json) | [plan.test.ts](../tests/plan.test.ts), [agents.test.ts](../tests/agents.test.ts), [e2e.test.ts](../tests/e2e.test.ts) |
| Fable design ceremony | [design.ts](../src/design.ts), [packet schema](../src/design-packet.ts), [designer brief](../src/design-brief.ts), [engine.ts](../src/engine.ts), [design tools](../ui/design-tools.ts), [guard](../hooks/guard-design.sh), [console](../ui/web/src/components/design.tsx), [workflow guide](design-ceremony.md) | [design.test.ts](../tests/design.test.ts), agent/API suites; isolated live-tool and browser verification |
| Bundled project starters and UI standards | [scaffolds/](../scaffolds/), [portable UI skill](../scaffolds/react-nest/template/.agents/skills/scaffold-ui/SKILL.md), [selection and maintenance](scaffolds.md), [contract section 14.1](../CONTRACTS.md#141-bundled-project-scaffold) | [design.test.ts](../tests/design.test.ts) checks reference integrity and digest binding; validate a disposable copy using its frozen lockfile and documented checks; verify the browser/API flow before adoption |
| Database agent catalog, creation, pinned assignments and versions | [agent-versions.ts](../src/agent-versions.ts), [pure data](../src/agent-version-data.ts), [schema](../src/db/schema.sql), [creation form](../ui/web/src/components/add-agent.tsx), [shared settings](../ui/web/src/components/agent-settings.tsx), [engine.ts](../src/engine.ts), [driver.ts](../ui/driver.ts), [runner.ts](../ui/runner.ts), [agent-versions.tsx](../ui/web/src/components/agent-versions.tsx), [version-overrides.tsx](../ui/web/src/components/version-overrides.tsx) | [agent-catalog-db.test.ts](../tests/agent-catalog-db.test.ts), [dbpg.test.ts](../tests/dbpg.test.ts), [agent-versions.test.ts](../tests/agent-versions.test.ts); browser publication, stale recovery, draft discard and legacy selection |
| Global agent library and feedback provenance | [agent-catalog.ts](../src/agent-catalog.ts), [agent-library.ts](../src/agent-library.ts), [db/listing.ts](../src/db/listing.ts), [baseline attribution](../src/db/backfill-agent-versions.ts), [server.ts](../ui/server.ts), [agent-library.tsx](../ui/web/src/components/agent-library.tsx), [agent-identity.tsx](../ui/web/src/components/agent-identity.tsx), [library-model.ts](../ui/web/src/library-model.ts) | [agent-library.test.ts](../tests/agent-library.test.ts), [agent-version-backfill.test.ts](../tests/agent-version-backfill.test.ts); fixture browser search, paging, feedback, navigation, keyboard and responsive checks |
| Agent definitions, permissions and provider execution | [model choices](../src/agent-models.ts), [version validation](../src/agent-version-data.ts), [shared editor settings](../ui/web/src/components/agent-settings.tsx), [agents.ts](../src/agents.ts), [runner.ts](../ui/runner.ts), [codex-runner.ts](../ui/codex-runner.ts), [codex-read-tools.ts](../ui/codex-read-tools.ts), [initialization seeds](../seeds/agents.json), [write guard](../hooks/guard-write.sh) | [agents.test.ts](../tests/agents.test.ts), [driver.test.ts](../tests/driver.test.ts), [codex.test.ts](../tests/codex.test.ts), [agent-models.test.ts](../tests/agent-models.test.ts); browser-check provider switching in Add agent and Manage versions |
| Driver execution, deadlines and ownership | [driver.ts](../ui/driver.ts), [runner.ts](../ui/runner.ts), [driverlock.ts](../src/driverlock.ts) | [driver.test.ts](../tests/driver.test.ts), [run.test.ts](../tests/run.test.ts) |
| Optional Docker Sandbox runs | [execution.ts](../src/execution.ts), [sandbox.ts](../src/sandbox.ts), [sandbox-runner.ts](../ui/sandbox-runner.ts), [worker](../ui/sandbox-worker.ts), [output boundary](../ui/sandbox-outputs.ts), [v3 environment](../sandbox-kit/sbxenv.yaml), [guide](docker-sandboxes.md) | [sandbox.test.ts](../tests/sandbox.test.ts): fake sbx with real Git/worker protocol; [sandbox-smoke.ts](../scripts/sandbox-smoke.ts): optional real VM without model calls; browser-check New run and recovery separately |
| Record parsing, checks, lens guards and gate | [verdict.ts](../src/verdict.ts), [checks.ts](../src/checks.ts), [guards.ts](../src/guards.ts), [gate.ts](../src/gate.ts) | [verdict.test.ts](../tests/verdict.test.ts), [checks.test.ts](../tests/checks.test.ts), [guards.test.ts](../tests/guards.test.ts), [gate.test.ts](../tests/gate.test.ts) |
| Target configuration and check detection | [config.ts](../src/config.ts), [engine.ts](../src/engine.ts) | [checks.test.ts](../tests/checks.test.ts) and [guards.test.ts](../tests/guards.test.ts) cover configuration consumers; no dedicated check-detection suite |
| Git operations, generated PR text and remote merge | [git.ts](../src/git.ts), [prmd.ts](../src/prmd.ts), [remote-merge.ts](../src/remote-merge.ts), [engine.ts](../src/engine.ts) | [e2e.test.ts](../tests/e2e.test.ts), [remote-merge.test.ts](../tests/remote-merge.test.ts) |
| Database jobs, records, legacy import and worktree recovery | [job-store.ts](../src/job-store.ts), [record-store.ts](../src/record-store.ts), [db/](../src/db/), [schema.sql](../src/db/schema.sql) | [db.test.ts](../tests/db.test.ts), [dbpg.test.ts](../tests/dbpg.test.ts); real PostgreSQL required for migration acceptance |
| Dispatch staging and validated ingestion | [staging.ts](../src/staging.ts), [driver.ts](../ui/driver.ts), provider adapters and write guards | Driver, design and Codex tests; staging-loss and output-boundary checks |
| Development cancellation cleanup | [history-cleanup.ts](../src/db/history-cleanup.ts), [agent-library.ts](../src/agent-library.ts), [job.ts](../src/job.ts) | [history-cleanup.test.ts](../tests/history-cleanup.test.ts); explicit pair manifests, canonical execution preservation and library projections |
| Infrastructure planner/builder and pinned instruction skills | [agent-skills.ts](../src/agent-skills.ts), [packaged skills](../skills/), [Codex adapter](../ui/codex-runner.ts), [scoped Git tool](../ui/codex-build-tools.ts), [expert guide](infrastructure-agent.md) | [agent-skills.test.ts](../tests/agent-skills.test.ts), [codex-build-tools.test.ts](../tests/codex-build-tools.test.ts), [codex.test.ts](../tests/codex.test.ts), catalog migration suites; bounded live builder smoke |
| Portable semantic agent history | [catalog-migrations.ts](../src/db/catalog-migrations.ts), [agent-releases/](../seeds/agent-releases/), [agent-versions.ts](../src/agent-versions.ts) | [catalog-migrations.test.ts](../tests/catalog-migrations.test.ts), PostgreSQL catalog round trip and export/check |
| HTTP API, events and static console assets | [server.ts](../ui/server.ts) | [ui.test.ts](../tests/ui.test.ts), [csp.test.ts](../tests/csp.test.ts) |
| New run folder browsing and initial Git commit | [repositories.ts](../ui/repositories.ts), [server.ts](../ui/server.ts), [actions.tsx](../ui/web/src/components/actions.tsx), [repository-browser.tsx](../ui/web/src/components/repository-browser.tsx) | [repositories.test.ts](../tests/repositories.test.ts): read-only browsing, real Git setup, preservation, safe retry, origin checks and fake-runner plan hold; browser-check selection, errors, keyboard and narrow layout |
| Run archive preferences and rail scrolling | [server.ts](../ui/server.ts) (archive route and database job state), [App.tsx](../ui/web/src/App.tsx), [use-console.ts](../ui/web/src/use-console.ts), [index.css](../ui/web/src/index.css) | [ui.test.ts](../tests/ui.test.ts), [console.test.ts](../tests/console.test.ts); browser archive/restore and independent scrolling |
| Formatted Run records and source view | [records.tsx](../ui/web/src/components/records.tsx), [record-content.tsx](../ui/web/src/components/record-content.tsx), [record-format.ts](../ui/web/src/record-format.ts), [records.css](../ui/web/src/records.css) | [record-content.test.ts](../tests/record-content.test.ts) (real React rendering via Vite SSR); browser-check Markdown, JSON, diffs, raw source, keyboard and responsive themes |
| React views, actions, records and server updates | [App.tsx](../ui/web/src/App.tsx), [components/](../ui/web/src/components/), [use-console.ts](../ui/web/src/use-console.ts), [api.ts](../ui/web/src/api.ts), [model.ts](../ui/web/src/model.ts) | [console.test.ts](../tests/console.test.ts) (console data helpers); build and exercise the affected view |
| Welcome state and README banner | [App.tsx](../ui/web/src/App.tsx), [index.css](../ui/web/src/index.css), [transparent banner](../../assets/sociotechnic-banner-v4-transparent.png), [original banner](../../assets/sociotechnic-banner-v4.png) | Build verifies both theme assets are bundled; browser-check the banner, header New run action and narrow layout |
| Builder verification in the Checks milestone | [model.ts](../ui/web/src/model.ts) (`parseBuildVerification`, `evidence`), [api.ts](../ui/web/src/api.ts) (`getDetail`), [experience.tsx](../ui/web/src/components/experience.tsx) (`Workflow`, `BuilderEvidence`), [technical.tsx](../ui/web/src/components/technical.tsx) | [console.test.ts](../tests/console.test.ts) (current, stale, missing and unchecked evidence); browser-check the milestone and original-record link |
| Usage and token reporting | [usage.ts](../src/usage.ts), [token-usage.ts](../src/token-usage.ts) (shared; web re-export retained), [telemetry.ts](../ui/web/src/telemetry.ts) | [token-usage.test.ts](../tests/token-usage.test.ts), [console.test.ts](../tests/console.test.ts) |
| Development servers and port cleanup | [dev.ts](../ui/dev.ts), [kill-ports.sh](../ui/kill-ports.sh), [vite.config.ts](../ui/web/vite.config.ts) | [dev-ports.test.ts](../tests/dev-ports.test.ts) |
| Project and global session entry points | [project skill](../../.claude/skills/sociotechnic/SKILL.md), [global skill and shim](../global/) | [run.test.ts](../tests/run.test.ts), [ensure.test.ts](../tests/ensure.test.ts); skill wording also needs manual review |
| Comment inventory and fixed cleanup plans | [comment-inventory.ts](../src/comment-inventory.ts), [engine.ts](../src/engine.ts), [cleanup guide](comment-cleanup.md) | [comment-inventory.test.ts](../tests/comment-inventory.test.ts), [ui.test.ts](../tests/ui.test.ts) |
| Comment cleanup | [cleanup guide](comment-cleanup.md), [coordinator/worker initialization seeds](../seeds/agents.json), [runner.ts](../ui/runner.ts) | [agents.test.ts](../tests/agents.test.ts), [plan.test.ts](../tests/plan.test.ts), [driver.test.ts](../tests/driver.test.ts), [e2e.test.ts](../tests/e2e.test.ts) |
| Contributions and releases | [Contributor guide](../../CONTRIBUTING.md), [security policy](../../SECURITY.md), [releasing](releasing.md), [third-party notices](../../THIRD_PARTY_NOTICES.md), root `.github/` templates | Verify Markdown links and template metadata, ignore rules, release contents and the checks described in the release guide |

Use [CLI/API contracts](cli-reference.md), [engine and state contracts](engine-reference.md)
and [the behavioral specification](../CONTRACTS.md) for supported behavior. For UI
work, also read [PRODUCT.md](../../PRODUCT.md) and [DESIGN.md](../../DESIGN.md).
Update affected rows and links alongside new features, removals or file moves.
Keep support utilities such as paths, atomic I/O and errors discoverable through
[the engine source directory](../src/) rather than duplicating a full file listing.

The engine's `sociotechnic/package.json` has three runtime dependencies: `pg` for the state store, `@anthropic-ai/claude-agent-sdk` for the console, and `@babel/parser` for comment inventory and proof. All are imported lazily, so commands that do not use those capabilities can run without `node_modules`. The React frontend has its own workspace package at `sociotechnic/ui/web/package.json`. Three engine dev dependencies support the type check.

| Dev dependency | For |
| --- | --- |
| `typescript` | Engine type checking; Node runs the engine source directly |
| `@types/node` | Node types for the `.ts` sources |
| `@types/pg` | Types for the `pg` driver |

The package manager is pnpm. The lockfile is `sociotechnic/pnpm-lock.yaml` and it is committed. `npm` lockfiles are not used. Install from the repository root.

```bash
task install
```

### Codex roles

Code review runs on Sol/high and research on Luna/high through subscription-authenticated
Codex CLI. See [setup, permission boundaries and verification](codex-integration.md).
`tests/codex.test.ts` exercises the real subprocess/MCP boundary with a fake CLI;
its success does not establish live model entitlement.

### Tasks

The root `Taskfile.yml` is the entry point. `task` with no argument lists them. Install is always frozen against the lockfile.

| Task | Does |
| --- | --- |
| `task install` | `pnpm install --frozen-lockfile` in `sociotechnic/` |
| `task install:global` | Symlinks `~/.claude/skills/sociotechnic` to `sociotechnic/global`. See [Global command](cli-reference.md#global-command) |
| `task checks` | `typecheck`, `build`, `agents`, `test`, then `audit` |
| `task typecheck` | Type check the engine and React workspace |
| `task build` | Build `ui/web` for the Node server |
| `task agents` | `sociotechnic agents`: validate bundled initialization seeds against the role table |
| `task test` | `node --test sociotechnic/tests/*.test.ts`. Local loopback servers and fake agents; no external model calls; PostgreSQL integration is opt-in |
| `task test:pg` | The same suite with `SOCIOTECHNIC_TEST_DATABASE_URL=postgres://localhost:5433/postgres`, so `dbpg.test.ts` runs against the local `postgresql@17` |
| `task audit` | `pnpm audit --prod --audit-level high` |
| `task dev` | Vite on 5173 and development API on 4748. Ctrl-C stops both |
| `task ui` | Build, then `sociotechnic ui --ensure`: background console |
| `task ui:stop` | `sociotechnic ui --stop` |
| `task db:init`, `task db:status` | Schema/catalog migration and database diagnostics |
| `task db:catalog:export -- --out <new-file>` | Export the complete database agent catalog to a new migration bundle |
| `task db:catalog:check` | Check committed bundle coverage before committing catalog improvements |
| `task jobs` | `sociotechnic jobs`. Pass flags after `--`: `task jobs -- --project <name>` |

Type checking is separate from running. Node 24 strips types when it runs a `.ts` file and never checks them, so `tsc --noEmit` is the check. `tsconfig.json` sets `erasableSyntaxOnly`, which rejects enums, namespaces and parameter properties, the same rule the source already follows. Nothing is emitted.

```bash
task typecheck
```

`ui/server.ts` and `ui/driver.ts` import the engine modules directly and never shell out to `bin/sociotechnic`. `ui/web` is the React/Vite frontend; its built assets and fonts are served locally. `ui/index.html` is the legacy fallback, with no build or external requests.

Run fast tests with `task test`. Pure and in-process tests use an explicitly injected memory store; production never selects it as a fallback. Driver and provider fixtures use fake agents, including `tests/fixtures/fake-agent.mjs`; no model call is required. Database-only job/record reads, atomic completion, staging loss, import conflicts and worktree recovery need dedicated regression coverage. Subprocess job workflows that previously relied on database-off files run against disposable PostgreSQL instead.

```bash
task test
```

PostgreSQL integration requires `SOCIOTECHNIC_TEST_DATABASE_URL`. It uses disposable databases and exercises real CLI/HTTP, ownership, transactions, legacy import, complete catalog migrations and recovery after staging loss. Point it at the server maintenance database, not the live `sociotechnic` database. Run `task checks` and `task test:pg` before storage cutover; skipped PostgreSQL tests do not establish migration safety. Verify binary-preview bytes and a database backup/restore round trip before retiring legacy files.

```bash
task test:pg
```

Check the role table against bundled initialization seeds.

```bash
task agents
```

Run every check in sequence: engine and console type checks, console build, agent validation, tests and dependency audit.

```bash
task checks
```

Where to change things: edit `CONTRACTS.md` first, then the code, then the tests. The role contracts, initialization seeds and tests must agree; live releases are edited through Agent library.

Rules for the source:

- Erasable TypeScript only: no enums, namespaces or parameter properties.
- Relative imports with explicit `.ts` extensions, named exports.
- No static imports of dependencies in the engine (`sociotechnic/src`). `pg` is imported dynamically inside `src/db/` only.
- No `any`.
- Almost no comments.
- Tests use `node:test` and `node:assert/strict`.

## Supply chain policy

Dependencies are the main way outside code reaches this repository, so the pnpm settings are strict. They live in `sociotechnic/pnpm-workspace.yaml` and are specified in [CONTRACTS.md section 14](../CONTRACTS.md).

| Setting | Value | Policy |
| --- | --- | --- |
| `minimumReleaseAge` | `1440` (24 h) | Reject versions published in the last day, except the exclusions below; this delay is not a security guarantee |
| `minimumReleaseAgeStrict` | `true` | pnpm falling back to a too-young version when no old enough one satisfies the range. It fails instead |
| `minimumReleaseAgeExclude` | `@anthropic-ai/*` | Exempts the Anthropic packages from the age rule (see below) |
| `trustPolicy` | `no-downgrade` | Installing a version whose publish provenance is weaker than an earlier release of the same package |
| `blockExoticSubdeps` | `true` | Transitive dependencies that come from git or a tarball URL instead of the registry |
| `allowBuilds` | `{}` | Any dependency running install or build scripts. pnpm fails loudly if one tries |
| `saveExact` | `true` | `^` and `~` ranges. `pnpm add` writes exact versions |
| `engineStrict` | `true` | Installing under a Node version outside `engines` (Node 24 or newer) |
| `verifyDepsBeforeRun` | `error` | Running a pnpm script on a stale install. It stops with an error |

Installs are always `pnpm install --frozen-lockfile`, so what runs is what the committed `pnpm-lock.yaml` says.

**Anthropic exemption.** `@anthropic-ai/*` bypasses the release-age rule so this checkout can adopt SDK updates without the 24 h delay. Exact dependency versions and the frozen lockfile still apply. Every other package keeps the age rule.

### Adding a dependency

1. Add it with an exact version. Run it from `sociotechnic/`.

```bash
pnpm add --save-exact <package>
```

2. Review the change to `package.json` and `pnpm-lock.yaml` in its own commit, apart from any feature work.
3. Leave `allowBuilds` empty. Add an entry only when a package genuinely needs a build step, and say why in the commit.

### Audit

`task audit` runs `pnpm audit --prod --audit-level high` and fails on a high or critical advisory in a production dependency. `task checks` runs it last.

```bash
task audit
```

## Status and historical runs

An experiment under active development. Automated tests use fake agents; passing them does not establish live model quality or production reliability. Run `task checks` for the current checkout rather than relying on a fixed test-count badge.

Two small demo runs were documented on 2026-10-24:

| Driver | Demo change | Reported outcome | Evidence |
| --- | --- | --- | --- |
| Claude Code project skill | Add `farewell(name)`, a test and API documentation | `ready` in one round, six dispatches, 136,334 reported tokens | [Committed job snapshot](../ui/seed/demo-job) with plan, build, reviews, checks and decision |
| Console Agent SDK | Add `shout(name)`, a test and API documentation | Reported `ready` in one round after a plan hold | Maintainer’s historical run report; no corresponding committed job snapshot |

The committed seed is a snapshot, not a live job. Its paths contain placeholders and its referenced repository and worktree are absent. The earlier console report included SDK dollar estimates; those do not establish actual subscription charges. Current Analysis presents recorded token usage and leaves missing measurements unreported.

## Design lineage

Sociotechnic grew from a study of [Swamp](https://github.com/swamp-club/swamp) by swamp-club. Sociotechnic keeps its deterministic workflow discipline and adds model tiers and agent roles. Upstream reference copies under `source/` are separate from the app. The orchestration contract that both drivers follow is [AGENTS.md](../AGENTS.md).

| Swamp mechanic | How sociotechnic does it |
| --- | --- |
| Verdict is a contract, not an inference | First-line marker, commit line, severity-consistent findings, and `malformed` never passes (`verdict.ts`) |
| Reviews run in a fresh worktree at the exact commit | One git worktree per job on `sociotechnic/<job-id>`. Reviewers read engine-written `diff.patch`, not the live tree |
| Path guards decide which lenses run | `lenses.<name>.paths` globs. A lens with no matching changed file gets an engine-written SKIPPED, distinct from PASS |
| Reviewers are read-only and told the diff is hostile | No Bash, a write guard hook, and a trust-boundary preamble in every review prompt |
| Two loop bounds, then park for a human | `rounds` and `dispatchesPerRound`, plus `retriesPerStep`. Past a cap the job parks. Overrides accumulate |
| Freshness and commit binding | Build, review and decision records carry `COMMIT`. A mismatch with HEAD is `stale` and blocks the gate. The plan digest is pinned |
| Committed database records are state; chat and staging are not | Agent outputs are validated and committed with completion; the driver never relays record prose |
| Pull-based context | Briefs name files to read and inline only small facts |
| Generated, never hand-assembled, attestation | `job.json` is engine-owned and `pr.md` is generated from records |
| Plan conventions and conformance as separate lenses | `plan.json` is pinned data. `sociotechnic-conformance` compares the diff to it stage by stage, and each deviation needs a written justification |

### Agent catalog development

PostgreSQL owns all semantic releases. `seeds/agent-releases/*.json` preserves the
complete immutable catalog through upgrades, including older releases and unused
custom agents. The migration validates complete row/bundle digests, rejects
conflicting content for the same identity/version, and inserts missing releases
idempotently. It never changes existing run pins. `seeds/agents.json` retains
original initialization definitions; it is not a live agent editor.

After publishing instruction, tool, model, effort or other configuration changes,
export a new bundle and check catalog coverage before committing:

```bash
task db:catalog:export -- --out sociotechnic/seeds/agent-releases/<new-bundle>.json
task db:catalog:check
```

Keep existing bundles immutable. A database export alone is not committed until
the new artifact is staged in Git; review its complete release payload and run
`catalog-check` again before the commit. The union of bundles must cover every
database release, not merely the latest per agent or versions used by jobs.
Runtime reads use PostgreSQL; bundle/cache edits cannot publish a release or
provide an outage fallback. `task agents` validates original seed/role
compatibility without PostgreSQL. Explicit baseline-only test fixtures may pass
an empty bundle list to catalog initialization; production initialization uses
the committed migration bundles.

See the [implementation plan](postgres-agent-versions-plan.md) and
[verification record](postgres-agent-versions-verification.md).

Database authority verification also covers [staging](../tests/staging.test.ts),
[ownership and SDK recovery](../tests/runtime-recovery.test.ts),
[external-effect recovery](../tests/effect-recovery.test.ts),
[import integrity](../tests/job-import.test.ts),
[old-writer fencing](../tests/import-review-regressions.test.ts) and real
[PostgreSQL backup/restore](../tests/backup-restore-pg.test.ts).

[Storage/read boundaries](../tests/storage-boundaries.test.ts) and
[restore guards](../tests/restore-guards.test.ts) cover retired evidence exclusion,
database-only catalog reads and refusal before Git recovery effects.
