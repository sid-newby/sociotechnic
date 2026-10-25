# New run repository setup

Browse an existing local folder from New run, then initialize Git and commit the
starter files when needed as part of starting the run. Reuse POST `/api/jobs`,
engine job creation and the current driver/plan hold.

## Scope and stages

1. Update `CONTRACTS.md` before implementation. Add `ui/repositories.ts`, extend
   `ui/server.ts`, and verify browsing and setup through real temporary Git repos
   in `tests/repositories.test.ts`.
2. Extend `ui/web/src/components/actions.tsx` with
   `components/repository-browser.tsx` and scoped styles in `ui/web/src/index.css`.
   Reuse Radix, Button, form errors, cancellation and duplicate prevention.
3. Update the documents below. Run `task checks`, the premium UI audit, and a
   browser workflow with the fake runner, including failure recovery, keyboard,
   a narrow viewport, and an actual initial commit and planning hold.

## docsImpact and allowed documentation files

- `CONTRACTS.md`: browsing API, explicit initialization and file preservation.
- `docs/cli-reference.md`: new form and HTTP options; CLI remains unchanged.
- `docs/engine-reference.md`: preparation occurs before engine job creation.
- `docs/development.md`: feature-to-code map and verification entry point.
- Root `README.md`: folder selection and one-click setup in the web guide.
- Root `DESIGN.md`: inline browser within the existing New run dialog.
- This plan records scope and validation. No role, driver, record or gate changes.

## Acceptance and risks

An empty directory gets `readme.md` containing `tbd`, a generic `.gitignore`, one
commit and a run worktree. Existing starter contents and committed repositories
are preserved. Never commit unrelated files or create a nested repository inside
an existing checkout. Report invalid paths, staged unrelated content and Git
identity failures; permit a safe retry after interrupted initialization. Browsing
is read-only, cancels superseded requests and uses the server's origin boundary.

## Verification

- `task checks`: typechecks, production build, agent validation and production
  dependency audit passed; 164 tests passed, one optional PostgreSQL test skipped.
- Real-browser verification with the fake runner: folder and parent navigation,
  empty state, invalid-path recovery using Enter, focus restoration, disabled
  controls while starting, retained draft after opting out of initialization, and
  successful retry to the plan hold. Each new target had one commit containing
  only `.gitignore` and `readme.md`. Phone-width rendering stayed within the
  measured 388px viewport without document overflow. No live model run was used.
- Strict premium audit: three existing `affordance.actionless-button` findings,
  identical on the unchanged base. They are Radix `Dialog.Trigger`, `Dialog.Close`
  and `Tooltip.Trigger` children; their handlers are supplied by Radix rather than
  literal `onClick` attributes. The new controls introduce no findings. Inspected
  the wrappers and exercised New run in the browser; the audit exit remains 1.
- `git diff --check` passed. Visual tokens and shared control ownership are
  preserved; DESIGN.md records the new browser behavior without token changes.
