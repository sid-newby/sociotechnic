# PostgreSQL agent catalog verification

Verified 2026-10-24 against the feature branch and local PostgreSQL 17.10.

- `task checks`: backend/UI typechecks, production build, fourteen seed
  definitions, 181 passing tests (two PostgreSQL-only tests skipped), and
  production dependency audit with no known vulnerabilities.
- `task test:pg`: 183 passing tests, no skips. Disposable databases are dropped
  after testing. Real PostgreSQL covers initialization/idempotency, immutable
  update/delete guards, concurrent publication with one winner, conflicting
  content, run foreign keys and restoration after complete cache loss.
- Final focused catalog/library tests passed after adding purpose editing and
  publication instruction validation; final backend/UI typechecks and build passed.
- Memory/API cases exercise template permission ceilings, stale peer review,
  duplicate identities/instructions, imported metadata stripping, explicit
  role assignment, frozen custom identities/instructions, legacy selection,
  incompatible binary contracts, cache repair, failed-adoption rollback,
  configured outage refusal and validation before Git initialization.
- Browser fixture: created Migration planner v1.0.0, verified the selected profile
  and template icon/color, published changed instructions as v1.0.1, and selected
  that identity with legacy v1.0.0 in New run. Verified native select keyboard
  selection, empty-form error focus, initial name focus, modal dismissal/focus
  restoration, long form scrolling and a narrow viewport with no horizontal
  document overflow. Creation was confined to an isolated memory catalog; no
  paid model calls or test agents were added to the user's database.
- `assets/console/agent-creation.jpg` captures the isolated demonstration catalog.
  Existing user screenshots were left untouched.
- The premium static audit's five remaining actionless-button findings are
  framework false positives: Radix Dialog.Trigger in New run/Add agent/Manage
  versions, Tooltip.Trigger in Hint, and Dialog.Close in records. Their owners
  supply the actions through `asChild`; the audit does not resolve that contract.
  New form validation/textarea findings were fixed. Runtime browser evidence,
  rather than this static audit, verifies those actions.

## Local migration and real backup recovery

Backed up the existing database before migration, ran `db init` and `db sync`,
then produced a complete custom-format backup. Restored that backup with
`pg_restore --exit-on-error` into a disposable PostgreSQL database. Compared
all release identities, versions and canonical content digests, plus all row
counts: **14 releases, 9 jobs, 180 records, 235 events**, identical after restore.
The temporary restored database was dropped; backup files are private to the
local user. The idle console was restarted and the user-facing Vite proxy
returned all fourteen agents with `{ ok: true, problems: [] }` validation.

This verifies persistence and execution provenance, not live model quality,
comparative accuracy or support for independent nested-worker versions.
