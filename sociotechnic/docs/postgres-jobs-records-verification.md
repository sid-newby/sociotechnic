# PostgreSQL authority migration verification

Verified on 2026-10-24. Companion plan: [PostgreSQL authority for jobs and records](postgres-jobs-records-plan.md).

## Result

PostgreSQL owns jobs, records, archive state, dispatch history and immutable agent
releases. Runtime reads do not fall back to legacy job folders or bundled agent
definitions. Local agent evidence lives in dispatch-scoped input/output staging;
temporary command exports are disposable. Git still owns repositories, commits,
branches and worktrees.

## Live data preservation

- All 9 jobs, 179 records and 16 agent releases survived cutover. All 9 jobs
  retained their archive state; 6 were merged and 3 stopped.
- Verified all 171 eligible legacy record payloads against their source bytes,
  all 179 committed record hashes, all 9 pinned plan digests and 72 historical
  parsed non-plan/non-design verdicts. No duplicate `job.json` record remains.
- Four historical plans had been altered by an earlier repository rename.
  Recovery restored the original pinned content rather than changing approvals.
  Altered copies and recovery provenance remain in database migration records;
  those records are excluded from ordinary agent staging.
- Both full migration bundles match the union of all 16 immutable releases,
  including prior semantic versions, instructions, model choices, tools, effort
  and other configuration. Catalog checking rejects omissions and changed
  content for an existing version.
- All 83 raw dispatches remain: 81 successful and 2 canceled. Explicit reviewed
  annotations exclude only the two early human cancellations and their retry
  blemishes from agent performance projections. The affected agents were the
  planner and COMPLEX builder. Raw counters, records and successful work remain.
- The live agent library reports 81 successes, zero failures, zero malformed
  results and zero reasks after that bounded cleanup.

The pre-cutover database dump, legacy archive, import manifests, history cleanup
pairs and moved legacy folders are retained under
`.sociotechnic/backups/20261024-job-authority/` (ignored by Git). The post-cutover
dump SHA-256 is
`a2da294b0e0187fd2c3d93e3a4ae137ac3c0dbd038cf929bf74625d03bc283db`.
Restoring it into a disposable database preserved all jobs, records, events and
releases; real HTTP inspection returned the same 9 jobs and 81 successes. The
disposable restore database was removed after verification.

## Behavioral verification

`task checks` passed type checking, the console build, agent seed validation,
the fast suite (213 passed; 30 PostgreSQL tests intentionally skipped), and the
production dependency audit with no known vulnerabilities. `task test:pg`
passed all 243 tests with no skips before integration of the independent
Markdown record-rendering change.

After integrating the latest `origin/main` record-viewer changes, frozen
dependency installation and `task checks` passed again (219 passed; 30
PostgreSQL tests intentionally skipped). The final `task test:pg` passed all
249 tests with no failures or skips. The production dependency audit remained
clean. The restarted live console returned all 9 archived jobs, 14 agent
identities, 81 successes and zero failed/malformed/reask projections. Browser
inspection confirmed the new formatted reader renders the original committed
build record. All disposable verification databases were removed; only the
live `sociotechnic` database remained.

The suite exercises real PostgreSQL transactions, concurrent driver ownership,
stale completion fencing, launch recovery, effect reconciliation, interrupted
creation, archive state, binary and large records, import checkpoints, immutable
catalog bundles, staging tamper rejection, provider read boundaries, outage
behavior and database backup/restore. Restore and run guards reject unsafe
effects before touching a worktree. An old connection without the writer epoch
was also rejected against the live database with SQLSTATE `55000`.

Real CLI/HTTP and browser inspection worked after the legacy runtime folders
were moved away. Archived lists, records, recovered pinned plans and cleaned
agent profiles remained available. Disposable fake-agent workflows verified
continuation and human holds with no surviving job staging. No live model calls
were needed; these checks establish storage and workflow behavior, not model
quality.

## Remaining boundaries

Backups are retained deliberately. Existing target repositories, stopped work,
branches and worktrees were preserved. Historical configuration prose is
immutable; execution adapters explain staging paths without rewriting a prior
release. Database outages now stop job workflows explicitly. Existing human
approval, acceptance and publication gates remain in force.
