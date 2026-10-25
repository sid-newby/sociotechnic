# Testing and workflow acceptance

The independent integration owner owns this inventory, test documentation and the
final combined-revision result. Author checks are supporting evidence; they do
not replace the final required run. [The feature map](development.md#feature-to-code-map)
connects implementation to its behavioral tests.

## Required combined check set

Run from the repository root at a clean, committed combined HEAD. Record the exact
commit, tool versions, environment, exit status, complete logs, failures and skip
reasons outside the checkout so recording results does not change the tested HEAD.

| Required check | Existing command | Evidence |
| --- | --- | --- |
| Engine and web types | `task typecheck` | Engine `tsc --noEmit`; web `tsc -b --noEmit` |
| Production web build | `task build` | Web `tsc -b` and Vite build; retain warnings |
| Initialization seeds | `task agents` | Checked-in seeds validated against role table; no live catalog publication |
| Release tools | `task test:release` | Every `.github/scripts/*.test.cjs` suite; fake external GitHub boundary |
| Application and PostgreSQL | `task test` | Every `sociotechnic/tests/*.test.ts` suite in one Node invocation, with approved fixture URL set |
| Dependency audit | `task audit` | Read-only `pnpm audit --prod --audit-level high`; no installation or upgrades |

`task checks` runs these six stages in order. An equivalent sequence must name
all six results, including a failed stage that prevented later stages. New
application tests stay under `tests/`; fixtures stay under `tests/fixtures/`.
Historical release-tool and scaffold test placement is retained. No coverage
percentage is claimed.

## PostgreSQL safety and required proof

Missing `SOCIOTECHNIC_TEST_DATABASE_URL` skips database tests, so an ordinary green
run without it is insufficient for catalog, restoration and workflow acceptance.
Use an explicitly approved disposable PostgreSQL 17 instance. Application tests
normally start with `SOCIOTECHNIC_DATABASE_URL=off`; only fixture operations
explicitly select their test databases. Never infer authorization to use an
operator's default application database. `task test:pg` hardcodes localhost:5433
and is unsuitable for this isolated proof.

The shared test fixture and direct admin fixtures validate the configured URL
before connecting, creating databases or registering drop hooks. They require a
nonempty explicit host and valid explicit port, reject duplicate host/port query
parameters and never fall back to libpq/pg default endpoints. The backup/restore
fixture uses that same validation when constructing `pg_dump`/`pg_restore`
environments, including encoded Unix socket host paths. An absent opt-in may
skip; malformed configured URLs fail. [Offline safety tests](../tests/postgres-environment.test.ts)
cover missing, empty, invalid and duplicate endpoints, ambient PGHOST/PGPORT,
URL/query precedence, cleared ambient PGSERVICE/PGSERVICEFILE/PGHOSTADDR routing
and a real fixture call rejected before its connection.
These tests are test infrastructure, not a production helper framework.

For this integration the approved resource is the installed Homebrew PostgreSQL
17.10 binary, a separate `task/flow-pg/data` directory, private Unix socket
`/tmp/sociotechnic-flow-pg-20261025`, port 55439 and disabled TCP listening. The
coordinator independently reviews endpoint changes, starts/verifies only that
owned cluster, supplies the explicit URL, and stops it after the run. Fixtures
create/drop only `sociotechnic_test_*` databases there. The shared fixture,
`dbpg`, remote-merge and legacy-import tests all preserve the configured endpoint
when replacing the database pathname. Dump/restore, canonical state, immutable
catalogs, locks, notifications, driver recovery and binary record retention must
execute; required database skips remain a blocker.

Run the complete suite once with this approved URL enabled, rather than running
the suite again just to enable PostgreSQL. Repeat only after a material failure,
fix or unresolved concern. Fixture HTTP listeners use ephemeral ports and fake
provider transports; preserve the user's services on 4747, 5173 and 4748.

The port-cleanup tests start only their own ephemeral listeners. A validated IPC
message carries each assigned port; stdout is diagnostic output and may contain
blank lines or startup banners. Startup errors retain bounded stdout/stderr,
and fixture cleanup waits for the owned child to exit. Regression cases cover
noisy/split stdout, startup failure and malformed IPC without weakening the real
graceful/forced cleanup or unrelated-listener preservation checks.

## Focused acceptance cases

| Card or integration concern | Behavioral proof |
| --- | --- |
| A1 failed checks | [check-repair.test.ts](../tests/check-repair.test.ts): real temporary Git and harmless checks cover failure, signal, timeout, full-suite completion, zero red-round reviews, one repair, passing all applicable reviews/approval, stale HEAD, dirty tree, changed plan, missing/empty suite, caps and comment structural proof |
| A1 + B1 handoff | Same test asserts actual generated report path, exact checked commit, command/name, exit/signal/timeout and exactly one fenced output tail per failure |
| A2 lifecycle | [check-repair-lifecycle.test.ts](../tests/check-repair-lifecycle.test.ts): checked/reviewed holds, stop during checks/repair, retained edits, reopen/reload, interruption, malformed/timeout retry bounds, BLOCKED/round exhaustion, override, old review waves, owner/input/replay protection and all-started-sibling waiting |
| Comment cleanup regression | [comment-inventory.test.ts](../tests/comment-inventory.test.ts) distinguishes the red-proof repair builder from reviewers with exact agent/record/empty-review assertions |

Mocks cover external provider/GitHub/Sandbox boundaries. Temporary Git, actual
parsers, the real engine/guards/staging/storage and harmless check processes carry
workflow proof. No live model calls, provider spend, Docker launch, service restart,
live catalog mutation or publication is required or performed by this verification.

## Compatibility and limits

Optional C3 reader-recovery concurrency is deferred. Native Impeccable execution
is separately opt-in via `SOCIOTECHNIC_TEST_IMPECCABLE_SKILL`; an unrun opt-in is
reported explicitly and does not establish live model or skill availability.
Browser fixture journeys and UI screenshots belong to the independent console
workstream and are not claimed as part of these workflow source changes.

No changelog version is reserved: repository release preparation is a separate
operator action. No push, pull request, merge, release or deployment is included.
Final acceptance is pending until every required stage, including PostgreSQL and
dependency audit, has an exact-revision result. Missing resources are named
blockers; skipped verification is never converted into PASS.
