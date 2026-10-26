# Team writing implementation plan

Give the runtime team and this repository's development assistant a shared writing
standard through existing immutable instruction skills. Keep publication and live
catalog rollout separate from implementation.

## Allowed scope

- Root `AGENTS.md`, `CHANGELOG.md` and `dox/THIRD_PARTY_NOTICES.md`.
- `sociotechnic/CONTRACTS.md`, `src/agent-skills.ts`, `src/agent-versions.ts`,
  `ui/design-session-runner.ts`, and `skills/team-writing/`.
- Focused tests in `tests/agent-skills.test.ts`, `tests/agent-versions.test.ts`,
  `tests/codex.test.ts`, `tests/design.test.ts`, `tests/sandbox.test.ts` and catalog
  migration tests if a missing behavior requires coverage, plus their provider fixtures.
- This plan and the CLI, engine, development, comment-cleanup and design-ceremony
  technical references. Optional preview-only rollout tooling belongs in
  `sociotechnic/scripts/` or the external audit directory.

No frontend changes, live catalog writes, agent publication, service restarts,
pushes, merges or changes to the separate comment-cleanup branch.

## Stages

1. Update the behavioral contract before code. Copy the prepared compact skill,
   original writing references, license, notice and blob provenance. Add the local
   assistant instruction and third-party attribution.
2. Add the bundle selection and mutually exclusive `addSkills` publication option.
   Snapshot additions only, validate the combined resources, retain prior bytes and
   native skill names, and preserve the existing replacement API and metadata.
3. Materialize the designer's pinned resources for initial and resumed native
   queries outside its artifact workspace. Clean them in `finally`. Reuse ordinary
   Claude/Codex delivery and coordinator-owned nested-worker inheritance unchanged.
4. Exercise publication, old pins, combined limits and provider/reference delivery.
   Verify native design flow, resume, failure/cancellation cleanup and saved artifacts.
5. Update affected references and run focused tests, skill validation, `task checks`
   and `task test:pg` when the disposable local PostgreSQL fixture is available.
   Inspect the final diff and commit the reviewable implementation.

## docsImpact

- `CONTRACTS.md`: additive resource publication, pinned designer delivery, writing
  semantics and unchanged role/record/human gates.
- `docs/cli-reference.md`: `addSkills`, bundled IDs, replacement versus addition.
- `docs/engine-reference.md`: immutable writing resources and provider coverage.
- `docs/development.md`: feature map, source ownership and verification limits.
- `docs/comment-cleanup.md`: coordinator-owned nested-worker writing resources.
- `docs/design-ceremony.md`: pinned resources outside the native artifact workspace.
- Root `AGENTS.md`: development assistant adoption. `CLAUDE.md` already imports it.
- Root `CHANGELOG.md`: prepare the minor release notes without publishing.
- `dox/THIRD_PARTY_NOTICES.md` and `skills/team-writing/`: licensed source attribution.

## Verification and rollout boundary

Tests use fake provider events/subprocesses and disposable memory/PostgreSQL stores.
They prove byte preservation and policy delivery, not model writing quality. Live
paired evaluation and any authorized publication belong to the operator's separate
rollout. Preserve complete current settings and use `expectedLatest` plus `addSkills`;
reconcile every eligible identity with the live catalog before publication. Select
an older release for fresh runs to roll back; never rewrite old releases or pins.
