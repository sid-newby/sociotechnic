# Agent discovery for planning and orchestration

Give planners and session orchestrators a concise, database-derived capability
roster. Reuse existing purposes, templates, skills, versions and permissions;
do not hardcode Azure names into the planner. Newly published agents should be
discoverable without editing the general planner's prompt.

## Stages and allowed scope

1. Define compact capability cards and a read-only CLI/API roster. Freeze the
   available roster on new jobs and include it in generated planner briefs.
   Validate cards against their immutable database releases. Files:
   `src/{agent-roster,agent-versions,job,engine,brief,cli}.ts`, `ui/server.ts`,
   `CONTRACTS.md`, focused tests.
2. Route recommendations through the existing role/record machinery within the
   chosen assignment policy. Preserve explicit user choices, dispatched releases,
   tier selection, research bounds and human gates. Record selected identities
   and reasons; never grant a role new tools or authenticate with Azure.
   Include `src/{plan,job-store}.ts` and `ui/runner.ts` for bounded research
   selection, immutable auxiliary release links and nested-worker awareness.
3. Update the driver contract and project/global driver skills to inspect the
   roster, plus README, CLI/API and engine references and the feature map.
   Verify real catalog discovery, future-agent publication, prompt contents,
   bounds, persistence/restore and dispatch behavior. Run repository checks.

`docsImpact`: the contracts, references and source map above must describe discovery
and selection truthfully. A read-only roster is not authority to change a pinned
assignment or execute a skill. UI controls, tokens, visual layout and business
surfaces are unchanged, so DESIGN.md and PRODUCT.md need no edits. Existing
semantic releases remain immutable; generated brief guidance does not require
rewriting their instructions. Catalog export is required only if releases change.

Acceptance: Azure advice, plans and EASY remediation are discoverable alongside
Terraform/container and general roles; a future custom agent appears through the
same mechanism. Cards contain no prompt bodies, skill bytes or history. Existing
runs retain their original evidence. Authentication and cloud changes are outside
scope. Selection details must retain the user's chosen policy.

## Chosen help policy

The user asked for broad team awareness, concrete help requests back to an
assigner and prevention of repeated ownership handoffs. All top-level roles and
nested workers now receive compact awareness. The planner may select only a
research-template advisor within the existing once-per-job, 1–6-question research
phase. Other specialist roles can be selected before creation or recommended in
the plan. Builders/validators return specific requests in their existing records;
they never recursively dispatch helpers. Explicit assignments and prior dispatch
pins remain frozen. No ongoing role is automatically reassigned.

No semantic agent releases are changed: awareness is generated brief context and
the complete dispatch envelope retains it. New catalog entries become discoverable
automatically for future runs; old runs never acquire a newer roster.

## Verification

- `task checks`: engine/web type checks, production build, 14 baseline definitions,
  251 tests passed with 31 optional PostgreSQL tests skipped, and production audit
  with no known vulnerabilities. `task test:pg`: all 282 tests passed, zero skipped.
- Focused tests use real Git fixtures, the actual catalog, engine, HTTP server
  and PostgreSQL. They prove future-agent discovery, compact payloads, frozen
  rosters, role locks, exact advisor identity/version on retries, rejected role
  expansion, return to the original planner, no second research round, blocked
  builder ownership, nested-worker context and durable auxiliary foreign keys.
- The live database contains 19 selectable top-level cards. CLI JSON is 9070
  bytes; the compact prompt roster is 7978 bytes. Azure's four current 1.0.1
  identities expose plan/advice/COMPLEX/EASY capabilities. No semantic releases,
  real run assignments, authentication or cloud resources changed.
- Both driver skill validators passed. Documentation link checking found and
  removed an existing link to unavailable ignored study notes in the development
  guide; current app documentation links are verified. No UI source changed.
- This change has no live model-quality claim: consultation decisions and all
  ownership/permission/boundary behavior were tested through deterministic records.
  The earlier Azure model smokes remain separately recorded evidence.

The CLI module now invokes its entry point only when executed directly, allowing
its real command handler to be tested without starting an unrelated CLI main.
The CLI shim, commands and PostgreSQL end-to-end suites passed through that path.
