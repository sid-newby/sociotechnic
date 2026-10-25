# Console redesign plan

The run console is rebuilt as the shadcn `dashboard-01` block on the existing
Vite workspace, with the driver and API work that makes its controls real.
Brief: [console-redesign-brief.md](console-redesign-brief.md). Product truth:
[PRODUCT.md](../PRODUCT.md). Conventions: the scaffold's
[UI skill](../sociotechnic/scaffolds/react-nest/template/.agents/skills/scaffold-ui/SKILL.md),
[AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md).

## How the work runs

| Role | Who | Does |
| --- | --- | --- |
| Coordinator | The supervising session | Writes briefs, reviews every PR, handles authorized merges and cleanup, keeps docs honest |
| Builders and reviewers | GPT-6.1 Sol at high effort, selected by the owner for this continuation | Work in isolated worktrees with explicit file ownership, implement, check and report back |
| Owner | Sid | Chooses release labels, merges the design-session PR, tests live runs |

Cadence per wave: branch in a worktree, build, run the checks, commit, push,
open a PR with the repository template, commander review, fixes, merge, then
`main` synchronized and the branch and worktree removed. No wave merges its
own PR. Each PR names its `docsImpact` and carries its changelog notes.

Checks that count: `task typecheck`, `task build`, `task test` (fake agents),
`task test:release`, `task audit`. `task test:pg` when storage changes. The
browser verification scripts and a screenshot refresh when the console changes.

## Completion rules across the console

The approved prototype supplies composition, not application data or working
controls. Its sample totals, narrative, navigation links and table buttons are
not implementation. Every visible control must perform its named action with
real data, and every displayed result must reflect the evidence actually held
by the engine. A passing check from a different commit cannot become a PASS
headline; missing usage remains unknown.

Wave 2 removes the repeated run-page explanations with the old stage strip,
Overview, Activity, Analysis and in-run Agents views. The decision bar says what
needs doing; cards summarize recorded evidence; sheets hold the supporting
details. Preserve access to earlier rounds and their checks and reviews.

Wave 4 owns the same content cleanup in the retained Agent library, New run,
Add agent, Manage versions, Sandboxes and Settings surfaces. Remove repeated
instructions about attribution, configuration, sandbox retention and capacity
from the normal reading path. Put the explanation at the relevant setting or
behind help once. Keep input guidance and consequential confirmation text where
the user makes the decision. This is a content and interaction pass within the
approved design, not another visual redesign.

Wave 5 verifies every retained surface against these rules. For each control,
record the route or local action, a successful interaction, and the relevant
failure state. For each unfinished capability, name its remaining work here;
omit decorative controls that imply it already works. Development wave numbers
do not belong in product copy. Empty histories, missing records and unavailable
measurements remain explicit data states, not material to fill with sample data.

docsImpact: the wave 2 and wave 4 source scopes include their retained forms,
dialogs and views; the README, console UI guide, CLI parity table, behavioral
contracts and development feature map must describe the implemented behavior.
The prototype remains a design reference and is not promoted to runtime code.

## Waves

### Wave 0: land the branch

Commit the product-context reset and the brief on
`codex/interactive-design-session`, push, open the PR to `main`. The owner
merges. Everything after branches from there.

### Wave 1: foundation

Worktree branch `console/foundation`. Scope: `sociotechnic/ui/web/` only.

- Dependencies at exact versions under the pnpm policy: `shadcn`,
  `tw-animate-css`, `recharts`, `@tanstack/react-table`. The 24-hour release
  quarantine decides the exact numbers; record them in the PR.
- `src/index.css` adopts the scaffold's contract: `tw-animate-css` and
  `shadcn/tailwind.css` imports, the full `@theme inline` map, the shadcn
  neutral `:root` and `.dark` values, `.dark` driven by a class on `<html>`.
- Theme module: presets as data (`shadcn-neutral` plus the TweakCN presets,
  vendored from the registry JSON with the Apache-2.0 notice added to
  `THIRD_PARTY_NOTICES.md`), a provider that sets `data-theme` and the `dark`
  class, persistence in `localStorage`, dark by default. The shadcnthemer
  presets wait until their license is confirmed.
- Components through the installed CLI from `sociotechnic/ui/web`:
  `pnpm exec shadcn add sidebar breadcrumb separator card badge button sheet
  drawer dialog tabs table select dropdown-menu command input textarea checkbox
  toggle-group tooltip sonner chart progress scroll-area skeleton avatar label`.
  Review the generated files; keep `cn` from the `cn` package.
- The existing views keep compiling and rendering on the new tokens. No
  layout changes yet.
- Done when `task typecheck`, `task build`, `task test` and `task audit` pass,
  the console serves with the neutral dark theme, and the theme switcher is
  reachable from the header.
- docsImpact: `sociotechnic/docs/development.md` (web workspace dependencies
  and theme module), `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md` Unreleased.

### Wave 2: the run page

Worktree branch `console/run-page`. Starts after wave 1 merges.

- `AppSidebar` (collapsible off-canvas, ⌘B): wordmark text, New run, command
  palette button, Runs, Agents, History, Sandboxes, Inbox counts, runs in the
  selected group, Settings, Get help, Search, user footer.
- `SiteHeader`: trigger, breadcrumb, status badge, theme switcher.
- `DecisionBar`: one sentence, one line, Read (sheet), primary action, the
  rest quiet. Status rules come from the existing action logic in
  `components/actions.tsx`; keep every gate and ownership check.
- `SectionCards`: Agent time, Tokens, Estimated cost, and the moment card.
- `TokenBurnChart`: shadcn chart over Recharts, stacked areas per dispatch,
  cache reads, range toggle, tooltip. Data from recorded usage; live from the
  SSE refresh.
- `RunTable`: TanStack table with tabs Dispatches, Records, Log, Decisions;
  rows open sheets with the record viewer (formatted, raw, download).
- Customize columns changes the actual dispatch table and remains usable by
  keyboard. Its Download action exports the currently filtered table with
  visible columns; record Download returns the original record bytes. Exercise
  both with real fixture data; do not retain the prototype's decorative buttons.
- Stop accepts an optional note and persists it in human history. The supporting
  API and engine change must land before the UI claims to save the note; sending
  a field the server ignores does not satisfy this requirement.
- Remove the Overview, Activity, Analysis and Agents tabs and the stage strip.
  New run, Agent library and Sandboxes keep working on the new primitives.
- Done when the demo store renders every status, the browser verification
  scripts pass, `task checks` passes, and the three states (planned, working,
  needs-human) match the prototype.
- docsImpact: `README.md` web guide and screenshots, `development.md` feature
  map, `sociotechnic/CONTRACTS.md` console section, `cli-reference.md`
  console lifecycle, `CHANGELOG.md`.

### Wave 3: driver and API parity

Worktree branch `engine/parity`. Can run beside wave 2; touches
`sociotechnic/ui/server.ts`, `sociotechnic/ui/driver.ts`,
`sociotechnic/ui/runner.ts`, `sociotechnic/src/cli.ts`, tests and contracts.

- Per-dispatch interrupt: an AbortController per dispatch, a route that
  cancels one dispatch and records it, the run keeps its place.
- Local concurrency cap: a configurable limit over the dispatch fan-out, a
  setting the console can change, default equal to today's behavior.
- Log streaming: driver log lines as SSE events; the 200-line cap becomes a
  paged buffer.
- Record download: `Content-Disposition` on the record route.
- Fix the reopen discard flag and the PR-text-without-push path in the
  console client; expose step, hold-after-status and raise-bound-early through
  their existing routes. Restore-without-continue still needs a separate API
  operation and is assigned to wave 4 below; `/resume` starts the driver and
  must not be presented as restore-only.
- Done when the contract tests cover each new route and the driver behavior,
  `task test` and `task test:pg` pass, and `cli-reference.md` and
  `CONTRACTS.md` describe the routes.

### Wave 4: history, agents, settings

Implemented on `codex/console-history`, following merged PR #28. The next handoff
is [wave 4 delivery](console-wave-4-handoff.md). History uses an explicit bounded
cohort, Agents shows pinned run configuration and exact provenance, Settings pins
browser defaults per new run, and Restore worktree has a guarded API operation.
Verification and PR status are recorded in that handoff; wave 5 remains open.

Worktree branch `console/history`. After waves 2 and 3.

- History view: per run and across runs, tokens by role per round, cost over
  time, elapsed per dispatch, errors and wins by category, drill-down to the
  dispatch and record.
- Agent library absorbs the old in-run Agents tab as an "in run" filter;
  provenance links on every count.
- Settings: sandbox capacity, theme, default holds, local concurrency cap.
- Restore without continuing: add a dedicated API operation around the existing
  engine restore command, preserving ownership and recovery guards, before
  offering a restore-only control. Prove that it restores the worktree without
  dispatching an agent or changing a human gate. The CLI remains available until
  this is implemented; the console parity table must continue to say so.
- Complete the retained-surface content pass described above. Agent metrics and
  feedback counts open their actual source run, dispatch or record; explain
  unavailable provenance without inventing links or repeating caveats per row.
- docsImpact: retained console components, restore route and tests, console
  contracts, CLI/API reference, engine recovery reference, development feature
  map, README and changelog. Update these with the implementation.

### Wave 5: finish

- Impeccable finish review against the direction contract; fixes.
- `DESIGN.md` written by the Impeccable documenter from the shipped console.
- Screenshot set refreshed; README, feature map, contracts and references
  checked against the code.
- A builder guide at `sociotechnic/docs/console-ui.md`: stack, tokens, theme
  presets, installed components, how to add a view, how to run the checks.
- `CHANGELOG.md` release notes and the next version.

## Risks

- The pnpm quarantine can refuse the newest releases; pin what it allows.
- `shadcn add` fetches from the registry; the worktree needs network once.
- The shadcnthemer license is unverified; those presets stay out until known.
- Per-dispatch interrupt changes recorded outcomes; the contract must say how
  an interrupted dispatch counts against retries.
- The legacy console at `/legacy` keeps its controls until wave 3 lands.
