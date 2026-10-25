# PostgreSQL authority for agent releases

## Outcome

PostgreSQL owns immutable releases and run-to-release bindings. Local release
files become disposable, verified caches. Repository definitions bootstrap the
first catalog and supply explicitly disabled-database baseline mode; they never
replace an existing database release. A configured but unavailable database does
not fall back to files for publication, run creation or new dispatches.

## Stages and allowed scope

1. Update CONTRACTS.md. Add idempotent schema migration for immutable agent
   releases and run bindings in `src/db/schema.sql`; extend `db/store.ts` and its
   memory implementation with transaction-scoped catalog locking and inserts.
2. Split pure release validation/fingerprinting from database catalog operations
   in `src/agent-version-data.ts`, `agent-versions.ts`, `agent-catalog.ts`. Import
   existing catalogs and explicit run snapshots on first `db init`, atomically,
   rejecting conflicting agent/version content. Subsequent initialization keeps
   database authority and repairs caches without importing edits.
3. Resolve and freeze full release configurations for new runs and each new
   dispatch in `engine.ts`, `job.ts`, CLI and server callers. Preserve version
   overrides, gates, guards and bounds. Validate/link releases during job sync;
   restore their cache before restoring run files or executing agents.
4. Test with memory and real PostgreSQL: migration/idempotency, JSONB ordering,
   immutability, concurrent publication, corrupt/missing/stale cache, binary
   compatibility, failed imports/rollback, run binding and full cache-loss restore.
5. Apply the migration to the user's configured database after disposable-database
   verification, refresh the idle console, verify API/UI, commit, publish, merge,
   synchronize main and delete the completed feature branch.

## docsImpact

README: database-backed versions and outage behavior. CONTRACTS and driver guide:
catalog authority, import, pinning, compatibility and restore rules. Engine and
CLI references: `db init` migration and run recovery. Development: source map,
database tests and actual validation. Historical library plan/verification remain
historical records; link this change rather than rewriting prior evidence.
Extend the library with guided agent creation, Markdown import, overlap review,
and an explicit role assignment in New run. Existing roles remain the engine's
contract and permission ceiling. New identities cannot add workflow stages or
broaden permissions. Add immutable template identity and differentiation notes to
release documents; pin assignments with versions and configurations. Preserve
the existing modal, form, feedback and identity owners; update DESIGN.md.

Remove live `.claude/agents/sociotechnic-*.md` definitions. Preserve their exact
initial instructions in `sociotechnic/seeds/agents.json` solely for first catalog
initialization and explicit database-off mode. Execution uses pinned database
definitions. Document Add agent, Manage versions, semantic version guidance,
legacy selection, duplication review and backup/restore in the user guide and
technical references. Extend allowed scope to agents, providers, driver, shared
identity UI, creation/version forms and their tests.

## Validation

`task checks`, `task test:pg` against PostgreSQL 17 on port 5433 using disposable
databases, focused failure/concurrency cases, database catalog inspection and
live console release reads. No live-model quality claim or paid agent test.

## Delivery scope and evidence

The change also updates `.gitignore` for disposable release caches, Taskfile seed
validation wording, README/CLAUDE navigation, DESIGN context and the new
`assets/console/agent-creation.jpg` demonstration. User-owned New run screenshots
are outside this change. See [verification](postgres-agent-versions-verification.md)
for automated, browser and real backup/restore evidence.
