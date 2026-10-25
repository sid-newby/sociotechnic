# Agent library verification — 2026-10-24

The implementation follows [the library plan](agent-library-plan.md), including
the later requests for categorized feedback, role colors, editing and semantic
releases. Repository definitions remain the v1.0.0 baseline. Test publications
were confined to disposable homes; no real agent model or permission was changed.

## Automated evidence

- `task checks`: typecheck, production build, baseline definition validation,
  168 passing tests, one optional PostgreSQL integration test skipped, and no
  known production dependency vulnerabilities.
- `agent-library.test.ts`: history paging, missing timing/tokens, valid negative
  results versus execution/record errors, revision/model/workflow/tier cohorts,
  checked-commit feats, feedback attribution, local-over-mirror precedence,
  unreadable local snapshots and database fallback.
- `agent-versions.test.ts`: semantic ordering, immutable releases, stale edits,
  tool/provider/limit validation, corruption detection, new-run pinning, legacy
  overrides, file/store snapshot preservation, actual write-guard allow/deny,
  coordinator/worker tool separation, origin checks, pre-creation validation and
  historical profiles with a missing local preset. The focused suite also passed
  after the final restored-profile fix.
- Official DESIGN.md lint: zero errors. Orphan-token warnings remain advisory.
- The strict premium static audit returns five actionless-button findings, all
  on Radix `asChild` Trigger/Close wrappers (including the existing New run,
  tooltip and record close controls). Those controls receive their behavior from
  Radix. New run, version open/close and unsaved-draft confirmation were exercised
  in the browser; these findings do not establish missing product actions.
- Identity color contrast against normal, surface and hover surfaces: minimum
  4.88:1 in the light palette and 6.18:1 in the dark palette. Runtime tokens remain
  canonical; DESIGN.md mirrors the approved new identity colors.

## Browser evidence

Chrome and an isolated fixture console exercised roster search/no-results/clear,
zero deployments, checked-build feats, history orders, evidence navigation,
keyboard navigation, loading states, version publication, legacy inspection and
New run overrides, unsaved-edit discard, and failed-publication recovery. A 390px
Chrome viewport had no horizontal page overflow and used the two-column bounded
roster above the profile. Dark mode was visually inspected; light colors were
checked numerically against all documented surfaces, without a light-mode browser
capture. The README screenshot is the committed demo run, not private project data.

The user's running console initially retained the previous server module while
the frontend had refreshed. After verifying no active runs, its owning CLI stopped
and restarted it. Both `4747/api/agents` and the user's `5173/api/agents` proxy
returned 200 and fourteen agents; the existing Chrome tab visibly recovered.
Real history pagination was exercised on the thirteen code-review deployments,
then the view was returned to the planner.

## Limits

These checks establish application behavior, provenance and adapter configuration.
They do not establish live model quality or comparative accuracy. Local release
presets are not PostgreSQL-synchronized; selected dispatch snapshots are mirrored
with job history. Nested comment workers remain v1.0.0 and lack independent engine
deployment counts. Historical check failures without category metadata remain
general check failures. Repeated work is inspectable; automatic planner policy
changes or model selection are not implemented.

## Concurrent New run integration

The repository-browser feature landed on main while this work was being finalized.
Both HTTP route groups and both New run payload fields (`initialize` and
`agentVersions`) are retained. Version overrides validate before repository
initialization. The integration regression checks that an invalid version cannot
initialize an empty directory, and that an existing repository can initialize
idempotently while selecting a legacy release. The combined repository suites
passed before merging this branch: 176 tests passed, one optional PostgreSQL
test skipped; typecheck, build, agent validation and dependency audit passed.
