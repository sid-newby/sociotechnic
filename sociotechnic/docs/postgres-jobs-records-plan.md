# PostgreSQL authority for jobs and records

Status: authorized implementation. See the companion verification report for the final cutover evidence.

## Outcome

PostgreSQL becomes the sole source of truth for job state, records, design
evidence and run archive state. Local files exist only as agent input/output
staging or temporary exports for an external command. Deleting idle staging
must not affect listing, inspection, gates, approvals, history or the ability to
continue a job whose Git repository and branch still exist.

Job operations require PostgreSQL. Remove file fallback, local-over-database
precedence and warning-only persistence failures. Keep the engine's roles,
record parsers, commit binding, plan/design digests, bounds and human gates.
This migration does not authorize a run, acceptance, publication or merge.

## Current paths that must change

- `src/job.ts` loads and saves `job.json`; `src/engine.ts` also saves jobs inside
  `step`, reads records and writes checks, diffs, plans and human reviews.
- CLI mutation wrappers and `ui/driver.ts` save files before best-effort sync.
  `db/listing.ts` merges database and file history, preferring local jobs.
- `ui/server.ts` requires a local `job.json` to identify jobs, reads details and
  records from disk, watches the job directory for events and stores archive
  markers separately under `.sociotechnic/console-archives`.
- `db/sync.ts` mirrors regular text files, skipping binary files, files over
  2 MiB, temporary files and runtime locks. Existing database rows therefore
  cannot be assumed to contain every local artifact.
- `src/design.ts` fingerprints packets and preview bytes from disk. Previews can
  be HTML, PNG, JPEG or WebP, up to 8 MiB. Tool receipts are also local evidence.
- `driverlock.ts`, CLI commands and the driver coordinate through local files.
  `db/restore.ts`, version backfill, agent-library history, provider adapters,
  role prompts and both consoles also depend on the current layout.

These are implementation paths verified during planning, not proof that the
live database and local folders currently agree. The checkout also contains
unrelated edits; implementation must preserve them and establish its own diff.

## Storage and execution contract

### One committed job and record set

Reuse `jobs`, `records`, `events`, the agent catalog and run bindings. Extend
them rather than add another job store.

- Keep `jobs.job` as the canonical job document, with a monotonically increasing
  revision for concurrency checks. Update searchable columns from that document
  in the same transaction. Store archive state in PostgreSQL as well.
- Migrate record content from `text` to one canonical byte payload (`bytea`),
  with media type, byte count, content digest, revision and producing dispatch
  where applicable. Decode text at validated boundaries; do not maintain two
  writable text/binary copies. Preserve existing paths and superseded records.
- Do not persist a second `job.json` record. Generate it from `jobs.job` when an
  agent or export needs it. Reconcile the existing duplicate during import.
- Commit job changes, record changes, release bindings and derived events in one
  transaction. Record ingestion and dispatch completion are atomic and
  idempotent. Failed commits cannot report a successful transition or completion.
- Persist the dispatch execution envelope before launch: pinned configuration,
  prompt, input revision/manifest, output scope and deadline. Track its launch
  claim separately from completion. A restart can prepare an unlaunched dispatch
  from the database; an uncertain prior launch must be reconciled before another
  agent starts. A commit followed by a crash cannot lose the execution request.
- Preserve malformed agent output as evidence with its parser result. A bad
  verdict still follows the current retry/park rules; storage/path violations
  fail ingestion. Neither case can become a passing record by accident.
- Remove the mirror's silent omissions. Preserve existing large/binary evidence
  during import. Define explicit record and dispatch-bundle limits, including
  the existing 8 MiB preview support; report every unsupported file before
  cutover instead of silently dropping it.

### Engine reads committed data

Add a shared job-operation boundary used by CLI, HTTP and the driver. It loads a
database snapshot, supplies records to the existing engine/parser functions and
commits the resulting state and record changes. Keep simple state transitions
and gate calculation testable without file I/O. Replace engine file reads with
record access and engine file writes with an explicit set of record changes.

The engine must not decide from a materialized staging folder. Plan, checks,
comment inventory, design receipt, preview bytes, review and approval validation
all use the committed database records. Preserve the current digest algorithms
and exact artifact bytes so existing approvals are not silently rebound.

### Staging belongs to one dispatch

Use `.sociotechnic/staging/<job>/<dispatch>/` with separate inputs and outputs.
Materialize inputs from a committed job/record revision immediately before
execution. Prompts and runner contexts receive the resolved staging paths;
logical record paths remain stable in the database.

Only the assigned outputs and declared auxiliary artifacts may be ingested.
Capture designer packets, previews and tool receipts, approver notes, and the
comment-cleanup coordinator's worker/coverage evidence. Do not import an entire
directory simply because it exists. Reject traversal, symlinks, foreign-job
paths and outputs from an obsolete dispatch/owner. Both provider adapters use
the same ingestion boundary. Agents receive no database credentials or direct
database write tools; strip database credentials from child environments.

Hash the input manifest and verify it before ingesting output. An agent's edit
to an input cannot change an approved plan or other committed evidence. Keep
staging after an interrupted upload for explicit retry of that same dispatch;
successful ingestion permits cleanup. Lost staging for an unfinished dispatch
produces an explicit interrupted/missing-output result and uses existing retry
bounds. Never infer completion from an uncommitted output file.

Read-only roles retain their permissions. Update write guards to the assigned
output scope, and update Codex read roots and designer tool scope. Builders
continue to work and commit in the Git worktree. Legacy pinned release prose
that names old paths needs an explicit adapter instruction and a regression
test; do not rewrite immutable releases or broaden their permissions.

### Ownership and external effects

Replace `job.lock` and `driver.json` authority with PostgreSQL coordination.
Use distinct session advisory locks for a driver lifetime and serialized job
operations, backed by dedicated connections. Persist driver owner identity,
host/process information and a unique ownership token for
completion fencing. Every mutation checks ownership and job revision.
Parallel review outputs serialize their short completion transactions.

Do not hold a database transaction open while an agent, check or Git operation
runs. Record pending work before execution and finalize it in a short checked
transaction. On ownership-connection loss, stop scheduling, abort owned agents
and reject late completions. A new owner must reconcile an interrupted dispatch
and confirm the old local process has stopped before starting overlapping work
in that worktree. Database fencing prevents stale commits; it cannot stop an
already-running process from editing Git files.

Git and PostgreSQL cannot commit atomically. For creation, merge, cleanup and
publication, record an operation identity/intent before the external effect and
its observed result afterward. Retry reconciles actual branch/worktree/PR state
before repeating the effect. An uncertain remote result never triggers a blind
second publication or bypasses a human gate. Preserve existing dirty-worktree
protection, driver handoff rules and remote confirmation requirements.

### Outages, commands and events

- Job reads and writes fail explicitly on database failure. HTTP returns a
  service-unavailable error; CLI exits nonzero. Never show an outage as an empty
  job list, switch to files or accept a mutation with a persistence warning.
- `SOCIOTECHNIC_DATABASE_URL=off` cannot run job workflows. Keep database-free
  pure utilities and bundled-agent validation where they do not access jobs.
  In-memory stores remain explicit test dependencies, never a production fallback.
- Remove normal `db sync` and `task db:sync`; stale callers get a migration hint.
  Introduce `db import-jobs` only as the explicit legacy migration command below.
- `run` and `resume` load jobs from PostgreSQL and prepare staging as needed.
  Reuse `restore` for missing Git worktree recovery only; remove its ability to
  overwrite canonical job/record state from files, including the old `--force`
  meaning. Preserve missing-repository/branch errors and uncommitted work.
- Details, record downloads, previews, PR text and library history read directly
  from the database. Temporary files required by `gh --body-file` are generated
  from committed PR text and cleaned up; a returned path is not durable storage.
- Remove job-folder `present` semantics from the API and both consoles. Report
  worktree availability separately where execution needs it. Missing staging
  does not make a job unavailable. Keep archive/unarchive distinct from recovery.
- Replace filesystem watch notifications with committed database change events.
  Use transactional PostgreSQL notifications to invalidate database reads,
  including record-only and archive changes. Subscribe and then refresh current
  state on every connection/reconnection, so missed notifications cannot leave
  the console stale. Preserve SSE ping and live driver activity; uncommitted
  output changes do not appear as completed evidence. Reuse the existing events
  table for history; do not build a second event-sourced job model.

## Stages and allowed file scope

Paths below are relative to `sociotechnic/` unless explicitly called root files.
New filenames are proposed owners, not claims that they already exist.

1. **Specify ownership and migration.** Update `CONTRACTS.md` before behavior
   changes, then `AGENTS.md` and the relevant technical references. Implement
   additive/versioned schema migration in `src/db/schema.sql`, `db/init.ts` and
   `db/store.ts`; add `db/import-jobs.ts`. Extend the existing memory store in
   `store.ts`. Add dry-run inventory, content-hash comparison, conflict resolution
   and an import checkpoint. Scope includes `tests/db.test.ts`, `dbpg.test.ts`
   and `tests/job-import.test.ts` plus `import-review-regressions.test.ts`. Document the import and schema in
   the engine/CLI references and development map in this stage.
2. **Replace persistence and engine record I/O.** Add a shared operation owner
   such as `src/job-store.ts`; update `job.ts`, `engine.ts`, `db/listing.ts`,
   `db/sync.ts`, `db/restore.ts`, `db/backfill-agent-versions.ts`, `design.ts`,
   `brief.ts`, `paths.ts`, `driverlock.ts` and their callers. Reuse existing
   parsers, checks and gate helpers. Implement transactional records/events,
   ownership fencing and external-effect reconciliation. Scope includes
   `cli.ts`, `ui/driver.ts`, `tests/job.test.ts`, `design.test.ts`, `driver.test.ts`,
   `agent-library.test.ts`, `agent-version-backfill.test.ts`, `remote-merge.test.ts`
   and `tests/job-store.test.ts` plus `effect-recovery.test.ts`. Update state/driver/CLI contracts with
   the changed transaction and outage behavior in this stage.
3. **Move agent I/O to staging.** Add `src/staging.ts`; update `brief.ts`,
   `ui/runner.ts`, `codex-runner.ts`, `codex-read-tools.ts`, `design-tools.ts`,
   `hooks/guard-write.sh`, `hooks/guard-design.sh` and fake-runner fixtures.
   Update `tests/agents.test.ts`, `agent-versions.test.ts`, `codex.test.ts`,
   `driver.test.ts`, `design.test.ts` and proposed `tests/staging.test.ts`.
   Assess seed instructions in `seeds/agents.json`; existing catalog releases
   stay immutable, with any needed new release handled explicitly rather than
   silently changing pins. Update Codex, cleanup and design documentation with
   the actual staging boundary in this stage.
4. **Move all surfaces to database reads.** Update `ui/server.ts`,
   `src/console-client.ts`, `src/agent-library.ts`, `ui/index.html`,
   `ui/web/src/{App.tsx,model.ts,library-model.ts,api.ts,use-console.ts}` and the
   existing actions, design, technical, experience and agent-library components
   affected by response changes. Remove disk-based identity/presence, archive
   markers and filesystem events. Update `tests/ui.test.ts`, `console.test.ts`,
   `run.test.ts`, `e2e.test.ts`, `repositories.test.ts` and `ensure.test.ts` where
   their old file/offline setup is invalid. Update root `README.md`, root
   `DESIGN.md` for changed states, the API reference and feature map in this stage.
5. **Verify, cut over and retire legacy state.** Update root `Taskfile.yml`,
   root `.gitignore`, root `CLAUDE.md`, the project skill
   `.claude/skills/sociotechnic/SKILL.md`, `global/SKILL.md` and any affected global
   shim. Complete the cutover below; untrack the existing `.sociotechnic/jobs/`
   files only after verified import. Ignore staging and retained migration
   archives. Remove obsolete mirror/fallback code and tests, and record actual
   verification in `docs/postgres-jobs-records-verification.md`;
   `tests/backup-restore-pg.test.ts` proves the final recovery criterion.

Stages describe build order, not independently deployable mixed-authority modes.
Keep the old runtime active until the complete database-only path is verified in
a disposable database. Existing unrelated changes are outside this scope.

## Import and cutover

1. Verify the implementation against a disposable PostgreSQL database first.
   Before touching live data, stop/drain all drivers and other old CLI/server
   writers, including agents still producing outputs. Take a PostgreSQL backup
   and a separate byte-preserving archive of legacy folders and archive markers.
   Retain repositories, branches and worktree edits independently.
2. Run proposed `db import-jobs --dry-run`. Inventory both local and database-only
   jobs, all record bytes, duplicate `job.json` content, preview dependencies,
   pinned agent bindings and archive markers. Report malformed jobs, unsupported
   artifacts, missing referenced evidence and conflicts. Compare content hashes,
   not mtime/size alone. No job or record is silently omitted.
3. Resolve divergent job/record sets explicitly per job in a reviewed import
   manifest. Pre-cutover files are the old authority, but a differing database
   row must still be reported and preserved in the backup. A chosen local job
   cannot silently erase database-only evidence. Validate approval references
   against the selected bytes. Keep malformed historical output as historical
   evidence; unresolved job corruption or missing approval evidence blocks that
   job's migration and must be resolved before overall cutover.
4. Run proposed `db import-jobs --apply --manifest <file>`. Bind the manifest to
   source hashes and expected database revisions; refuse changed inputs.
   Import each complete job, artifacts, bindings and provenance transactionally.
   Checkpoint completed jobs so reruns are idempotent without duplicate events.
   Import never infers acceptance, approval or a completed dispatch. DB-only jobs
   and their history remain intact. Remove duplicate stored `job.json` only
   after the job document is reconciled.
5. Verify job IDs/counts, per-record lengths/digests, binary round trips, pending
   dispatches, statuses, history, archive state and plan/design fingerprints.
   Pending dispatches with no surviving process are reconciled explicitly under
   existing timeout/retry rules; do not run them merely to test migration.
6. Complete the authority-version checkpoint and start only the new runtime.
   New runtime refuses an incomplete import. Prevent concurrent old writers
   through database triggers requiring the new connection writer epoch for job
   and record writes. Older binaries never set that epoch and their writes fail
   inside PostgreSQL. This avoids changing the maintainer's shared administrator
   privileges. A migration marker alone cannot block old binaries that never
   read it. If old-writer rejection cannot be demonstrated, cutover stops.
7. Move legacy `.sociotechnic/jobs` out of runtime paths and verify real API/CLI
   inspection with no job staging. Rebuild staging and run a disposable fake-agent
   job through planning, checks and a human hold. Untrack legacy job files using
   an index-only removal; retain the backup until verification is accepted.

After cutover, import is locked out for existing canonical jobs; it is not a
repair/fallback path. `db init` can migrate schema but never reimports staging or
legacy edits. A deliberately authorized later import requires a separate
maintenance procedure, not a normal job command.

Rollback before new-runtime writes may restore the pre-cutover database and
legacy archive together. After new-runtime writes, do not restart the old
file-authoritative runtime against stale files. Prefer a forward repair; any
rollback needs a fresh database export of every job and record plus an explicit
compatibility check and reconciliation of external effects.

## docsImpact

- `CONTRACTS.md`: job/record authority, schema migration, atomic completion,
  import, staging permissions, ownership, outage behavior, events and API shapes.
- `AGENTS.md`: database-backed driver workflow, materialized dispatch inputs,
  completion ingestion and recovery; preserve all human gates.
- `docs/engine-reference.md`: replace the file-truth/mirror diagram, sync and
  restore model; document bytes, digests, ownership and transaction boundaries.
- `docs/cli-reference.md`: import command, removed sync workflow, revised
  restore/resume/run outputs, required database and failure codes.
- `docs/development.md`: new owners and feature map, PostgreSQL integration gate,
  explicit memory fixtures and tests that no longer use database-off jobs.
- `docs/{codex-integration,design-ceremony,comment-cleanup}.md`: staging roots,
  output ingestion, designer preview durability and coordinator evidence.
- Root `README.md`: web outage/recovery experience and durable run history;
  command internals stay in technical references. Root `DESIGN.md`: availability
  and archive/recovery behavior; no visual redesign is planned.
- Root `CLAUDE.md`, project/global skills and Taskfile descriptions: accurate
  navigation and removal of file-based sync/read instructions.
- Historical plans and verification reports remain historical evidence. This
  plan and the new verification report describe the new behavior.

## Required proof before removing legacy files

- **No fallback:** conflicting/corrupt local `job.json`, injected records and
  archive markers never affect database listings, detail, library history, gates
  or execution. An unreachable database fails reads and writes without file
  mutation or a false empty/success response.
- **Atomicity and retry:** failures before/after commit, duplicate finishes,
  ambiguous connection loss and parallel reviewer completions produce one
  durable outcome without lost updates, duplicate events or repeated agents.
  Crash between dispatch commit, launch claim and process creation; demonstrate
  recovery without losing the request or blindly duplicating an uncertain launch.
- **Staging loss/tampering:** delete idle staging, restart the server and continue
  an existing disposable job. Modified inputs and foreign/late outputs cannot
  change committed plans, reviews or approvals. Lost pending output follows an
  explicit recovery path within existing bounds.
- **Evidence durability:** text over the old mirror limit and HTML/PNG/JPEG/WebP
  previews survive import, database backup/restore and complete staging loss
  byte-for-byte. Plan, design and comment-inventory digests remain valid.
- **Ownership and effects:** two real database clients cannot own the same job;
  old owner tokens are rejected after reconnect. Kill a driver, disconnect its
  ownership session, and interrupt Git/worktree/PR boundaries. Recovery observes
  effects before retry and preserves dirty worktrees and human confirmations.
- **Cutover:** repeat dry-run/apply and interrupt an import. Source changes and
  unresolved conflicts block it; DB-only jobs survive; rerunning `db init` cannot
  overwrite a post-cutover job. Demonstrate that old runtime connections cannot
  write after epoch cutover, using a disposable database first.
- **Surfaces:** real CLI and HTTP against PostgreSQL, plus a browser check of
  list/detail, record viewing, binary previews, archive/unarchive, a fake-agent
  planning hold, database outage and reconnect/event catch-up. Inspection works
  without a repository; execution reports a missing branch/repository accurately.
- **Regression:** run `task checks` and `task test:pg`. Keep fast pure/in-process
  tests on the explicit memory store. Move subprocess workflow tests that relied
  on `SOCIOTECHNIC_DATABASE_URL=off` to disposable PostgreSQL integration tests;
  do not add a persistent file fake to keep those tests passing. The migration
  cannot pass on a run that skips the PostgreSQL integration suite.

No live model call is required for storage verification. Fake agents prove
transport, ingestion and workflow behavior; they do not prove model quality.
The final removal criterion is successful database backup/restore followed by
inspection and continuation of a disposable job with no surviving job staging.

## Boundaries

Git repositories, commits, branches and uncommitted edits remain Git/filesystem
state. Bundled scaffold files, application configuration, UI assets and trusted
skill installations are not job records. Do not add object storage, offline job
mode, a second persistent cache, an event-sourced rewrite or automatic production
job execution. The user subsequently authorized implementation, data migration, commit, sync,
merge and cleanup. Existing application jobs retain their separate human gates.

## Final refinements from execution and audit

The user requested preserving real successful history while removing only two
confirmed early development cancellation/retry blemishes. The bounded
`db/history-cleanup.ts` maintenance operation adds canonical performance
annotations; agent-library projections exclude those cancellations and normalize
only their successful retry display. Original dispatch counters, outcomes,
configurations, usage, gates and records remain unchanged.

Four legacy plans had been changed by an earlier repository-wide rename without
updating their pinned digests. A reviewed import recovery restored content that
matches each original digest, with altered copies and provenance retained as
historical database records. Routine staging excludes `migration/` records;
provider read/search boundaries exclude retired runtime files and backups.

The final source scope also includes `PRODUCT.md` (stale optional-mirror claim),
`db/events.ts` (replaces the deleted mirror module), `db/history-cleanup.ts`,
`tests/history-cleanup.test.ts`, `tests/storage-boundaries.test.ts` and
`tests/restore-guards.test.ts`. Worktree recovery checks database authority,
ownership and runnable state before effects. Runtime catalog reads fail closed;
bundled seeds remain initialization/validation data only.
