# Building the web console

[App guide](../../README.md) · [Design system](../../DESIGN.md) ·
[Development and feature map](development.md#feature-to-code-map) ·
[Behavioral contracts](../CONTRACTS.md#canonical-ui-map)

The React console lives in `sociotechnic/ui/web/`. Extend its current dashboard,
retained forms and designer conversation through their existing owners. The
approved [surface direction](../ui/web/.impeccable/surfaces/sociotechnic-ui-web-src-app-tsx.md)
and root DESIGN.md describe the visual system; CONTRACTS.md owns behavior.
The [CLI/API reference](cli-reference.md) describes available operations. Reuse
those boundaries before adding a control or endpoint.

This guide was reconciled against application base
`1eb0a89d3c32319c3be5e530caf5605f1e0cecf3` and the finish pass's integrated
capture-script repair and shared Textarea resize default. It records source
facts, not a new runtime verification result. Final visual and interaction
verification remains
pending the console finish plan's P4 batch. Recheck the inventory after source
integration; historical handoff results do not prove the final build.

## Stack and installed components

The [web package](../ui/web/package.json) is a Vite SPA with React 19,
TypeScript 7, Vite 8 and Tailwind 4. Radix primitives come from `radix-ui`;
icons from `lucide-react`; class composition from `cn`; variants from
`class-variance-authority`. Geist Variable is packaged locally. Recharts and
TanStack Table supply chart and table behavior through the installed wrappers.
`cmdk`, `vaul` and `sonner` support commands, drawers and toasts. Markdown,
GFM and code highlighting use the existing record formatter dependencies.
Exact versions belong in the manifest and frozen pnpm lockfile.

[components.json](../ui/web/components.json) configures `radix-nova`, neutral
base colors, CSS variables, Lucide, TSX and `@/` aliases. This is not a Next.js
or Base UI application. The shadcn CLI is not an installed app dependency.
The shadcn 4.22.1 Tailwind rules are inlined in index.css; `tw-animate-css` and
the local font package are imported normally. Keep the existing adaptations
and supply-chain policy described in the
[workspace notes](development.md#web-console-workspace).

There are **29 installed UI modules** in
[components/ui/](../ui/web/src/components/ui/):

| Group | Modules |
| --- | --- |
| Actions and entry | `button`, `checkbox`, `input`, `input-group`, `label`, `radio-group`, `select`, `textarea`, `toggle`, `toggle-group` |
| Structure and data | `avatar`, `badge`, `breadcrumb`, `card`, `chart`, `progress`, `scroll-area`, `separator`, `skeleton`, `table`, `tabs` |
| Navigation and overlays | `command`, `dialog`, `drawer`, `dropdown-menu`, `sheet`, `sidebar`, `sonner`, `tooltip` |

A registry component is not installed merely because it exists upstream.
Inspect exports before importing. Preserve `data-slot`, `asChild`, forwarded
props, Radix trigger/close composition and the `cn` package import. Prefer
existing variants; do not invent component props or replace `cn` with another
class-merging stack. New dependencies or generated components require their
own authorized scope; this guide does not authorize installation.

## Tokens and themes

The runtime owns tokens; DESIGN.md mirrors the accepted system and explains
its use. There is no DESIGN.md export step or generated token file. The path is:

```text
index.css + selected preset JSON
  -> ThemeProvider variables, data-theme and .dark
  -> @theme inline semantic utility aliases
  -> shared primitives and composed views
```

| Concern | Owner |
| --- | --- |
| Semantic color, sidebar/chart aliases, radius scale, typography, status colors, scrollbars, reduced motion | [index.css](../ui/web/src/index.css) |
| Preset discovery, labels, loading and scheme merging | [theme/presets.ts](../ui/web/src/theme/presets.ts) |
| Persistence and document-root application | [theme/provider.tsx](../ui/web/src/theme/provider.tsx) |
| Preset and scheme controls | [theme/theme-switcher.tsx](../ui/web/src/theme/theme-switcher.tsx) |
| Role-family chart-token mapping | [role-colors.ts](../ui/web/src/role-colors.ts) |
| Provider composition | [main.tsx](../ui/web/src/main.tsx) |

The inventory is **43 JSON presets**: `shadcn-neutral` and 42 TweakCN presets.
Neutral is bundled eagerly; the others load on demand. Default is neutral dark.
The provider merges `cssVars.theme`, `cssVars.light`, then dark overrides for
dark mode. It sets inline custom properties and `data-theme` on `<html>`, plus
the `dark` class. Operating-system color preference does not select the scheme.

Choices use `localStorage` keys `sociotechnic.theme` and `sociotechnic.scheme`.
Invalid saved values fall back to defaults. Storage errors leave a choice
page-local; a failed lazy preset load resets the preset to neutral. Settings
contains the controls at every width; the header copy appears only from 1500px.

Preset filenames are keys; labels derive from those keys. The shape is `name`
plus `cssVars.theme`, `cssVars.light` and `cssVars.dark`. Keep fonts out of
presets so Geist remains stable. Preserve the
[vendored license](../ui/web/src/theme/presets/LICENSE-tweakcn) and
[third-party notices](../../dox/THIRD_PARTY_NOTICES.md) when an authorized change
adds or updates one. Do not introduce unverified shadcnthemer assets.

Presets can change color, radius, tracking and the spacing unit. Sage Garden
and Violet Bloom currently override spacing. Their stored shadow variables do
not drive the existing Tailwind shadow utilities. Never describe preset
metadata as a rendered effect without tracing a consumer.

Use semantic utilities and paired foreground/background roles. Role hues map
once to chart tokens; status colors remain separate with labels and icons.
The body is 16px and `text-xs` is 13px at a 16px root. The approved utility floor
is 13px; Button `sm` uses the canonical `text-xs` token; the finish captures also
check computed button type against that floor. Summary cards use six spacing units (24px in
neutral); generic Card defaults to four, or three for `size="sm"`.

## Source ownership

Use the [feature-to-code map](development.md#feature-to-code-map) for the full
implementation/test inventory. These are the console entry points:

| Area | Existing owner |
| --- | --- |
| Composition, active view, run/dispatch/record hash selection | [App.tsx](../ui/web/src/App.tsx) |
| Jobs, detail refresh, SSE connection and driver log subscriptions | [use-console.ts](../ui/web/src/use-console.ts), [hooks/use-run-log.ts](../ui/web/src/hooks/use-run-log.ts) |
| HTTP requests, errors and record URLs | [api.ts](../ui/web/src/api.ts) |
| Parsed evidence, labels and projections | [model.ts](../ui/web/src/model.ts), [run-model.ts](../ui/web/src/run-model.ts), [telemetry.ts](../ui/web/src/telemetry.ts) |
| Sidebar, header, commands, Settings and execution controls | [components/shell/](../ui/web/src/components/shell/) |
| Decision, summary, token chart, table and supporting sheets | [components/run/](../ui/web/src/components/run/), [run-table-model.ts](../ui/web/src/run-table-model.ts) |
| History and agent inspection | [history.tsx](../ui/web/src/components/history.tsx), [history-model.ts](../ui/web/src/history-model.ts), [agent-library.tsx](../ui/web/src/components/agent-library.tsx), [library-model.ts](../ui/web/src/library-model.ts) |
| Creation and management forms | [new-run.tsx](../ui/web/src/components/new-run.tsx), [add-agent.tsx](../ui/web/src/components/add-agent.tsx), [agent-versions.tsx](../ui/web/src/components/agent-versions.tsx), [sandboxes.tsx](../ui/web/src/components/sandboxes.tsx) |
| Shared form composition | [field.tsx](../ui/web/src/components/field.tsx), [form-select.tsx](../ui/web/src/components/form-select.tsx), [form-dialog.tsx](../ui/web/src/components/form-dialog.tsx) |
| Formatted/raw records and source downloads | [records.tsx](../ui/web/src/components/records.tsx), [record-content.tsx](../ui/web/src/components/record-content.tsx), [records.css](../ui/web/src/records.css) |
| Designer session display, thread scrolling and images | [design.tsx](../ui/web/src/components/design.tsx), [design-thread.tsx](../ui/web/src/components/design-thread.tsx), [design-images.tsx](../ui/web/src/components/design-images.tsx), [design.css](../ui/web/src/design.css) |
| Opener tracking and focus fallback | [lib/focus.ts](../ui/web/src/lib/focus.ts) |

The Node [server](../ui/server.ts) serves built assets and existing HTTP routes.
The engine decides transitions and gates; the driver executes those decisions.
UI code requests an operation and displays committed results. It must not
simulate completion, manufacture records, repin releases or advance a human
gate locally. `/legacy` remains the separate original HTML interface.

## Adding or changing a view

1. Read the relevant contract and source-map row. Trace a comparable control
   from its component through api.ts to the existing route. Reuse its state,
   ownership checks and legal-action logic before proposing new behavior.
2. Compose through App and the shell owners. Current top-level views are Runs,
   Agents and History; selected run, dispatch and record identities live in
   hash parameters. Preserve exact source navigation and reload behavior.
   Document any new navigation state with its owning model.
3. Use shared UI primitives and form helpers. Keep visual changes within the
   semantic tokens and DESIGN.md direction. Put reusable behavior in its
   existing owner rather than copying a second modal, select or formatter.
4. Cover loading, empty/no-results, partial/stale data, error/retry, pending
   mutation and confirmed success. Keep last-loaded data labeled as stale and
   prevent mutations when the current state cannot be trusted. Follow sibling
   request-cancellation and draft-recovery patterns.
5. Assign scrolling to the active content. Keep long forms reachable and tables
   horizontally scrollable. Preserve the existing designer thread's independent
   scrolling. A table's viewport constraint must not clip a sibling form.
6. Assess `docsImpact` before implementation: contracts for changed behavior;
   CLI/API references for changed operations; feature map for moved owners;
   README for changed user flows; DESIGN for durable visual decisions. Update
   only the documents whose claims change, in the same change.

### Forms, overlays and feedback

Use Field/Label and explicit help/error associations, `noValidate` and the
existing validation flow. Use FormSelect over the authored Radix Select for
ordinary single-choice fields. The popup is app-owned; keyboard behavior,
collision, trigger alignment, option wrapping and bounded scrolling must be
verified while it is open. A native `<select>` would change that ownership.

Keep entered values on failure, block duplicate submission synchronously where
needed and announce pending/error state. Use the actual input's disabled state;
a disabled Send button alone must not dim an editable composer. Textarea now
supplies `resize-none` in its shared default; callers retain their existing
sizing and resize declarations. Review changes in that owner while keeping long
input usable. Input guidance belongs at the decision point, not repeated in
every row.

Compose modals with the installed Dialog/Sheet wrappers and FormDialogContent
for retained forms. Supply names, descriptions where needed, close controls
and an opener. Existing focus helpers return to the opener or sidebar trigger.
Coordinate record/dispatch overlays through their owner to avoid competing
focus traps. Preserve drafts on failed mutations and explicit discard behavior
where implemented. Do not introduce browser `alert`, `confirm` or `prompt`.

Inline errors carry correction/retry information; Sonner acknowledges confirmed
outcomes. Show success only after the request succeeds. Keep consequential
confirmation text, legal status/driver ownership guards and the separate
accept, publish, local merge and remote merge meanings intact.

### Evidence and conversation

Preserve unknown usage and partial coverage, skipped versus passed checks,
commit freshness, earlier rounds and exact contributing records. Use the
canonical record viewer for Markdown, JSON and diffs; raw/source download must
retain the original bytes. Dispatch CSV is a separate export of the filtered
table and visible columns. It must not masquerade as a record download.

Designer changes reuse the existing session transport and native questions.
Thread scrolling belongs to design-thread.tsx: anchor new human turns, follow
the live edge, permit reading history during streaming and offer Return to
latest. Keep IME-safe sending, Shift+Enter, image validation, failed-send draft
and byte retention, retry identifiers, interruption/resume, separate-tab
previews and explicit Return work. [The design guide](design-ceremony.md) owns
the workflow; this guide does not add a parallel designer or approval path.

## Checks and evidence

Run commands from the repository root. Read [Taskfile.yml](../../Taskfile.yml)
and the relevant verification script first. Use installed tools and a disposable
fixture home; do not borrow a live console or another worker's mutable proof.
Missing dependencies mean a blocked or skipped check, not permission to install
them or a passing result.

| Check | Command and boundary |
| --- | --- |
| Documentation/patch whitespace | `git diff --check`; separately check newly created untracked files |
| DESIGN format | `designmd lint DESIGN.md` when the official CLI is already installed; report unavailable tooling without fetching it |
| Capture-script syntax | `node --check sociotechnic/scripts/console-screenshots.mjs`; does not launch a browser or prove captures |
| Engine and web types | `task typecheck` |
| Built console | `task build`; produces local assets and is not a server launch |
| Agent-seed validation | `task agents`; does not publish agent releases |
| Release tooling tests | `task test:release`; does not publish a release |
| Fake-agent suite | `task test`; keep database test opt-ins absent and use disposable state |
| Registry dependency audit | `task audit`; needs network and separate authorization when networking is restricted |
| PostgreSQL integration | `task test:pg`; creates/drops test databases and requires explicit permission in a database-restricted task |

`task checks` includes the network dependency audit. Do not run a partial subset
and report the aggregate as passed. Development/runtime commands such as
`task dev` and `task ui` start or reuse services; follow the
[lifecycle guide](cli-reference.md#run-console) and the active task's permissions.

For an authorized visual batch, freeze the integrated source and finish its
build first. Reuse [verify-run-page.mjs](../scripts/verify-run-page.mjs),
[verify-console-history.mjs](../scripts/verify-console-history.mjs),
[verify-run-wizard.mjs](../scripts/verify-run-wizard.mjs),
[verify-console-ownership.mjs](../scripts/verify-console-ownership.mjs) and
[verify-interactive-design.mjs](../scripts/verify-interactive-design.mjs) for
their respective fixture journeys. The run-page and History scripts require
`--stable`; inspect their output/checkout options before execution. Preserve
isolated ports, disposable stores/repositories, runner guards and cleanup.
Native preview verification uses the explicitly installed skill/runtime; it
must not trigger a download or live model call implicitly.

Inspect desktop and 390px layouts, light/dark, reduced motion, long content,
loading/empty/stale/error states, keyboard/Escape/focus return, opened selects,
draft/retry and duplicate-submit behavior. Check designer anchoring, live-edge
following and history reading during streaming separately. A static detector
cannot establish these interactions or certify accessibility compliance.

The [capture script](../scripts/console-screenshots.mjs) and
[screenshot manifest](../../assets/console/README.md) own reproducible README
captures. Keep scenario, fixture, source commit/tree, date, viewport, scale,
preset/scheme, locale/timezone, motion and command provenance together. Inspect
every final image at native size; fixture screenshots do not show a live run.
The repaired harness was executed against the integrated build and refreshed
the eight primary images. It records image/source/build hashes and checks
computed typography, textarea resize, select geometry/Escape focus and isolated
sandbox UI recovery. The manifest separates current supplemental fixtures from
historical images. Future source repair still requires new capture evidence.

Report exact commands, exit codes, source/build identity, proof paths and
limitations. Keep static findings, fixture transport/native executable proof,
PostgreSQL proof and live provider proof distinct. P1 documentation work does
not close wave 5 or authorize a release.

## Recorded provider usage

The dashboard and History show Cache reads instead of API-dollar estimates.
Metric and dispatch sheets share `components/usage-breakdown.tsx`; History
keeps full-cohort and per-row details collapsed. `src/token-usage.ts` owns the
nullable projection, scope labels and per-field coverage. Main-agent `usage`
excludes auxiliary calls; per-model `modelUsage` may include them. Select the
existing preferred source rather than adding both. Preserve historical totals.

Uncached input, output, cache reads and cache creation are counted once.
Thinking is an explicitly reported output subset; image counts are unreported
because no retained mapping is verified. Codex creation is unavailable even
if a historical normalization stored synthetic zero. Use the provider envelope
or pinned configuration, not a model-name guess, to establish provenance.
Unknown differs from measured zero. Cohort summaries carry field-by-field
coverage before pagination and count report scopes. Recorded snapshots may be
cumulative; sums are not deduplicated session usage or a per-turn timeline.
No request hit percentage, cache expiry or current warm status is inferred.

The dispatch table offers optional input/output/cache/thinking/scope columns;
CSV labels identify thinking as a subset and missing values as Not reported.
Designer retains only its last recorded aggregate, with category/per-turn gaps
explicit. Raw cost fields and legacy API filters remain compatible; the UI
does not translate usage into dollars. New tests belong in `tests/`, separate
from source; fake providers bound verification without paid/live calls.
