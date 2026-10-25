# Run wizard folders and new repositories

Extend the existing repository browser and initialization path. New repository
is a UI setup preset that requires local Git tracking; it uses feature planning,
the existing initial commit helper and the existing human plan hold.

## Stages and allowed scope

1. Update `CONTRACTS.md`, then extend `ui/repositories.ts` and `ui/server.ts`
   with default/fallback browsing and single-child directory creation. Cover real
   filesystem behavior and the same-origin boundary in `tests/repositories.test.ts`.
2. Extend `ui/web/src/components/repository-browser.tsx` with remembered Go
   paths and inline folder creation. Extend `components/actions.tsx` with the
   New repository preset, using existing Button, Radix dialog and form styling.
   Any layout adjustment belongs in `ui/web/src/index.css`.
   Extend the generated planner/designer briefs in `src/brief.ts` and
   `src/design-brief.ts` to recommend the house special for requested UI work
   without a UI scaffold, reusing design interviews and human stack choice.
   Verify this contract in `tests/design.test.ts`; clarify the existing stack
   choice in `components/design.tsx` and the new repository form.
3. Update the documents below. Verify with `task checks`, a strict UI audit and
   an isolated browser workflow, including session persistence, invalid saved
   paths, validation/retry, keyboard, narrow viewport and the Git/plan hold.
   Keep the repeatable, fake-runner browser proof in
   `scripts/verify-run-wizard.mjs`, using the existing optional Playwright capture
   tooling and disposable filesystem/database fixtures.
   Supplementary demo screenshots and capture provenance belong in
   `assets/run-wizard/`. Reserve the minor release and notes in root `CHANGELOG.md`.

## docsImpact

- `CONTRACTS.md`: browser preference, folder creation endpoint and setup preset.
- `docs/cli-reference.md`: HTTP options and web behavior; CLI is unchanged.
- `docs/engine-reference.md`: new preset reuses preparation before job creation.
- `docs/development.md`: update the feature map and verification coverage.
- Root `README.md`: the user's folder and repository setup flow.
- Root `DESIGN.md`: existing browser/form owners and persistence behavior.
- `docs/scaffolds.md`: conditional house-special recommendation and human choice.
- This plan: scope and actual verification. No changes to roles, records,
  database schema, scaffold selection or driver/human gate policy.

## Verification

- `task checks` passed: engine/frontend typechecks, production build, agent and
  release tooling checks, 263 application tests passed with 31 optional tests
  skipped, and no known production dependency vulnerabilities. No database
  schema changes or live model calls were made.
- `scripts/verify-run-wizard.mjs` passed against real Chrome and the HTTP server:
  default and saved paths, a new browser context, changing the preference,
  invalid saved-path fallback, invalid Go recovery, unavailable storage,
  folder creation and duplicate/name validation, offline retry, in-flight
  disabling, required Git tracking, one real starter commit, and a planned job.
  Keyboard Enter/Escape and focus, run type selection, a narrow viewport and the
  sibling agent library were exercised. The OS-owned select popup could not be
  visually captured in headless Chrome; option contents and selection were tested.
- Reviewed the desktop/new-repository and narrow screenshots. Runtime visual
  tokens remain unchanged. `designmd lint DESIGN.md` reported zero errors and
  44 warnings about existing token metadata; only prose changed in DESIGN.md.
- Strict premium audit reports four existing actionless-button findings on
  Radix wrappers in unchanged files. A fresh HEAD snapshot produced the exact
  same findings; no new findings were introduced. The audit still exits 1.
- `git diff --check` and browser script syntax check passed.
