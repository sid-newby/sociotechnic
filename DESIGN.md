---
version: "alpha"
name: "Sociotechnic"
description: "A local run console for inspecting coding-agent evidence and making human decisions."
colors:
  primary: "#225ec0"
  primary-foreground: "#ffffff"
  background: "#f8fafc"
  foreground: "#182337"
  surface: "#ffffff"
  muted: "#e9eef5"
  muted-foreground: "#52637a"
  border: "#cbd5e1"
  input: "#cbd5e1"
  secondary: "#e9eef5"
  secondary-foreground: "#182337"
  destructive: "#b42332"
  positive: "#167040"
  ring: "#3378e3"
  primary-dark: "#7eafff"
  primary-foreground-dark: "#101c31"
  background-dark: "#101722"
  foreground-dark: "#e7edf7"
  surface-dark: "#151f2e"
  muted-dark: "#202e42"
  muted-foreground-dark: "#a4b3c9"
  border-dark: "#34445b"
  input-dark: "#34445b"
  secondary-dark: "#202e42"
  secondary-foreground-dark: "#e7edf7"
  destructive-dark: "#ff9eaa"
  positive-dark: "#77d8a1"
  ring-dark: "#8cb7ff"
  amber: "#905006"
  violet: "#6847b5"
  cyan: "#006a7a"
  amber-dark: "#f2bd6d"
  violet-dark: "#bdabff"
  cyan-dark: "#7ed4e2"
  agent-copper: "#95521a"
  agent-teal: "#08736e"
  agent-olive: "#626915"
  agent-indigo: "#5555b3"
  agent-rose: "#a43c70"
  agent-orchid: "#9046a4"
  agent-brick: "#a7453b"
  agent-steel: "#4a688a"
  agent-forest: "#287145"
  agent-copper-dark: "#eeb383"
  agent-teal-dark: "#69cfc5"
  agent-olive-dark: "#c0cc78"
  agent-indigo-dark: "#b1b0ff"
  agent-rose-dark: "#eda0c5"
  agent-orchid-dark: "#d8a1ed"
  agent-brick-dark: "#f3a79c"
  agent-steel-dark: "#a3bedf"
  agent-forest-dark: "#91d3a3"
typography:
  headline:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontWeight: 650
    lineHeight: 1.22
    letterSpacing: "-0.7px"
  dialog-title:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
  body:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  measurement:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontSize: "38px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-1px"
  tokenTotal:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  sequence:
    fontFamily: "\"Geist Variable\", system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 650
  technical:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  field: "6px"
  button: "8px"
  dialog: "10px"
  evidence: "12px"
  badge: "5px"
  meter: "2px"
spacing:
  8: "8px"
  12: "12px"
  16: "16px"
  20: "20px"
  24: "24px"
  28: "28px"
  40: "40px"
  48: "48px"
  64: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "36px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "36px"
  button-destructive:
    backgroundColor: "color-mix(in oklab, #b42332 10%, transparent)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.button}"
    padding: "0 10px"
    height: "36px"
  field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  run-navigation-selected:
    backgroundColor: "color-mix(in srgb, #225ec0 10%, #ffffff)"
    textColor: "{colors.foreground}"
    padding: "17px 22px"
  evidence-ledger:
    textColor: "{colors.foreground}"
    padding: "24px 0"
  button-link:
    textColor: "{colors.primary}"
  view-tab:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.button}"
    padding: "12px 16px"
  view-tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.button}"
    padding: "12px 16px"
  workflow-step:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.button}"
    padding: "12px"
  plan-step:
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    padding: "18px 12px"
  technical-table-cell:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    padding: "12px"
  action-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.dialog}"
    padding: "28px"
---

# Design System: Sociotechnic

## Overview

The header reads `sociotechnic vX.Y.Z` with one space and the existing brand
typography throughout. The version remains visible on narrow screens; header
actions wrap below it as needed. The release guide defines the build-time source.

New run's optional Docker Sandbox environment uses the existing labeled native
select and form fields. The browser owns the select popup. CPU, memory and
concurrency fields appear only for that choice; drafts survive validation errors.
Activity identifies the pinned environment. Stopped sandbox runs reuse the
existing destructive confirmation dialog and name both VM and worktree cleanup.
No visual tokens or shared control ownership change for this experiment.

**Creative North Star: "The Run Console"**

Sociotechnic is a product console for the owner supervising coding agents in local repositories. Its slate surfaces, blue actions, compact labels, and readable evidence keep the current run and the next human decision legible. Color-coded views, prominent measurements, and expandable numbered sequences make the console more expressive without replacing its established identity. The existing console and the owner's React scaffold establish this visual language; this document records that implementation.

Runtime CSS remains canonical (Model B). `sociotechnic/ui/web/src/index.css` owns the base theme and local font loading; `sociotechnic/ui/web/src/experience.css` owns the added view accents, measurement hierarchy, and layout refinements; `sociotechnic/ui/web/src/agent-library.css` owns role identity colors and library/version layouts; `sociotechnic/ui/web/src/components/ui/button.tsx` owns button variants. The frontmatter mirrors accepted values. `PRODUCT.md` supplies product context, and `sociotechnic/CONTRACTS.md` remains the behavioral authority. Surface-specific composition belongs in `sociotechnic/ui/web/.impeccable/surfaces/sociotechnic-ui-web-src-app-tsx.md`.

**Key Characteristics:**

- Slate surfaces and blue actions, with cyan, violet, and amber view accents in system light and dark themes.
- Compact evidence with direct access to original records.
- Sans text for reading; monospace for paths, commits, logs, and structured records.
- Flat sections, tonal evidence surfaces, clear dividers, and elevated modal dialogs.
- Large tabular numerals and expandable sequences with explicit measurement labels.

## Colors

Cool slate neutrals carry the console; blue identifies actions and selection. Frontmatter names without a suffix describe light mode. The matching `-dark` names mirror the same CSS variables under `prefers-color-scheme: dark`; they are theme alternatives, not additional roles. There is no manual theme switch.

### Primary

`primary` and `primary-foreground` pair action fills and action text. `ring` provides the visible keyboard focus outline. Selected run navigation uses a thin primary left border with a lightly tinted primary fill.

### View accents

`cyan` identifies Activity and its driver surface. `violet` identifies Analysis, recorded tokens, comparison bars, and round numbers. `amber` identifies Agents and attention states. These accents inherit light and dark theme alternatives; the base blue remains the Overview and action accent. Color identifies context, while labels distinguish role configuration from warnings or outcomes.

### Neutral

`background` is the page and field canvas; `surface` is the sidebar and modal plane. `foreground` carries primary text; `muted-foreground` carries supporting labels. `border` and `input` share the separator tone. `muted`, `secondary`, and `secondary-foreground` retain the scaffold's semantic aliases.

### Status

`positive` marks recorded passing results and live connectivity. `destructive` marks error text and destructive actions. `amber` marks attention, blocked outcomes, and human-decision states. Neither is decorative.

**The Semantic Color Rule.** Use primary for actions and current workflow stages, positive for supported success, amber for attention, and destructive for errors or destructive controls. View accents identify context. Keep every status and measurement meaning in text as well as color.

### Runtime mapping and drift checks

| Recorded token | Canonical runtime target | Consumers |
| --- | --- | --- |
| `colors.agent-<name>` | `:root --agent-<name>` and dark media query in `agent-library.css`, mapped through `--agent-color` | Shared AgentIcon and AgentName |
| `colors.<name>` | `:root --<name>` in `index.css` or `experience.css` | Page, labels, fields, navigation, status |
| `colors.<name>-dark` | Same variable in the dark media query | Same consumers through semantic remapping |
| `typography.*` | Root/body and records in `index.css`; view headings and measurements in `experience.css` | Console text and record viewer |
| `rounded.*`, `spacing.*` | Literal CSS declarations and Tailwind button utilities | Fields, buttons, dialogs, layout |
| `components.button-*` | Button variants plus the CSS minimum-height override | Shared actions |

Tailwind's `@theme inline` bridges semantic color aliases to the same CSS variables. `surface`, `positive`, `amber`, `violet`, and `cyan` are consumed directly by custom CSS. Mixed accent fills resolve these variables at runtime; frontmatter component fills show the light-theme default. On a system change, compare every recorded light/dark color to these declarations, inspect affected selectors and button utilities, and update both documents in the same change. Run `designmd lint DESIGN.md` when the official CLI is available; generated CSS is not part of this ownership model.

## Typography

Geist Variable is bundled through `@fontsource-variable/geist`; system UI and sans-serif are fallbacks. Technical text uses the system monospace stack recorded above. No remote font service or separate Geist Mono face is configured.

The responsive headline identifies the selected run with `clamp(25px, 2.4vw, 34px)`. The exact fluid expression is kept in sidecar typography metadata because the current official linter accepts only fixed dimensions for that frontmatter field. Dialog titles, section titles, body text, and supporting labels use the recorded hierarchy. Labels stay in sentence case. Prose records use the body family with a looser line height (1.7); structured records use the technical role. At the narrow breakpoint, run headings use a fixed size (25px). Long feature text, paths, and record names wrap; rail feature summaries clamp to three lines.

Measurements use semibold Geist with tabular numerals. Evidence counts use the measurement role, reducing to 32px on narrow screens. Recorded token totals use `clamp(30px, 3.6vw, 48px)`; deadline counts use 38px and configured agent budgets use 40px. Plan and round numbers use the sequence role; workflow numbers use 22px. Counts always retain their unit, denominator, or unavailable label. Fluid token-total sizing and tabular-numeral behavior are recorded in the sidecar.

**The Reading Role Rule.** Use Geist for prose and interface labels. Reserve monospace for technical values and structured records.

## Layout

With no run selected, the detail pane centers a spacious welcome composition.
It uses `assets/sociotechnic-banner-v4-transparent.png` at its full aspect ratio,
with no additional welcome copy or duplicate action. New run remains in the
header. The artwork sits
directly on the dark canvas with no fade or background panel. Light mode uses the
original `assets/sociotechnic-banner-v4.png` with rounded corners to retain
contrast for the white wordmark. The README's original image stays unchanged.
Intrinsic image dimensions reserve its space while loading. Narrow screens
stack the same composition below the run rail with natural page scrolling.

A compact run rail sits beside a flexible detail pane. On desktop the shell fills the viewport, with independent contained scrolling for the run list and detail pane. The rail heading, filters and footer remain visible. The native Show archived checkbox sits below the project and status filters. Each run row pairs its selection button with an Archive or Restore icon button; archived rows carry an explicit label. At 700px the shell returns to page flow and the run list scrolls horizontally in its own region. The desktop rail is 290px wide; the detail pane has a 1320px maximum width and 28px 40px 64px padding. At 1100px the detail padding becomes 28px and view labels lose their supporting descriptions. Below 1000px the rail narrows to 250px. At 700px the rail becomes a horizontal scroll list above the detail, detail padding becomes 24px 16px 40px, and shared buttons have at least 40px height instead of 36px.

Use the observed spacing steps in the frontmatter as a working vocabulary; the source also contains small alignment offsets. Flex action rows wrap, and detail columns use `minmax(0, 1fr)` so technical content can shrink and wrap. Dense technical grids remain inside separately scrollable regions.

The workflow uses seven columns, changing to four at 800px. At that breakpoint evidence becomes a single main column with checks and reviews alongside each other, and the agent roster becomes a two-column grid above its profile. Below 700px Analysis stacks its lead measurements, comparison bars move below their labels, and round evidence and gate lists become single-column. Preserve these distinct responsive compositions instead of forcing every view into the same table layout.

## Elevation & Depth

Ordinary sections are flat, with single-pixel separators and tonal selection fills. Gate evidence, attention disclosures, and the driver area use low-percentage semantic color mixes over the surface. Tooltips use a compact `0 8px 24px #0003` shadow with foreground/background inversion at z-index 80. Modal dialogs use `0 16px 64px #0005` above a `#0009` overlay. The overlay and dialog stack at z-index 40 and 50; the focused skip link sits above them at 60.

**The Flat Surface Rule.** Separate ordinary content with spacing, borders, and muted fills. Reserve the large shadow and dimmed backdrop for modal dialogs.

## Shapes

Fields have modest rounded corners; shared buttons are slightly rounder; modal containers retain their established dialog radius. Evidence groups and navigation rows retain clear section boundaries. Gate, human-action, driver, and round containers use the evidence radius; workflow controls and plan summaries use the button radius. Result badges use compact corners, while hint controls are circular. Thin borders organize information without turning each value into a card. Small circular connection dots accompany text labels.

## Components

### Buttons and fields

Primary actions use the blue fill and matching foreground. Outline buttons use the page canvas and border; ghost buttons gain a muted hover fill. Destructive buttons use a translucent destructive fill with destructive text. Link buttons use primary text and an underline on hover; record links within technical tables have compact padding. Disabled buttons reduce opacity and block pointer interaction. Hover changes color; active buttons can move down one pixel. Shared button utility styles also provide a focus ring; the global keyboard outline remains visible.

Inputs and textareas use the page canvas, border tone, and field radius. Project and status filters intentionally use native selects with accessible labels. Keyboard focus uses a 2px ring-colored outline with 3px offset. Icons come from Lucide as inline SVG and accompany labels where needed.

### Navigation and evidence

The header's Agent library action sits immediately before New run. Live and
Refresh retain their behavior. The library reuses the run detail scroller, slate surfaces and existing typography.
Role identity adds theme-aware icon/name colors through `agent-library.css`. A searchable role roster
and flat profile/evidence column separate configuration from measured history.
At 950px the roster becomes a bounded two-column list above the profile; at
700px the shell retains natural page scrolling. History pages contain ten rows;
configuration comparisons reveal five cohorts at a time.

Role color maps planning to blue, design to violet, research to cyan, builders to
amber/copper, cleanup to green/teal/olive, reviews to distinct indigo/rose/orchid/
brick tones, conformance to steel and approval to forest. These identity colors
never replace status tones. Each icon and agent name uses the same semantic
`--agent-color`; dark variants preserve contrast. Semantic versions accompany
agent names. Older unversioned evidence remains labeled unless the operator
confirms a baseline v1.0.0 backfill. An unrecorded definition revision stays
separate from that semantic version attribution.
The version editor uses the canonical Radix modal, native selects and owned inline
validation, with publication review and unsaved-draft confirmation. New run's
optional overrides retain its normal dialog scrolling and focus behavior.
An explicitly compatible builder appears in both EASY and COMPLEX assignment
selects under one identity. Each slot offers only compatible release versions;
superseded identities remain in deployment history instead of fresh choices.

`components/agent-identity.tsx` owns each role's Lucide icon and display name,
shared by library, run profiles, activity and analysis. Role icons identify agents;
outcome icons identify outcomes. The planner's compass anchors the initial
profile. Measurements use existing type roles, tabular numerals and explicit
coverage. Feedback retains source and attribution text; color never asserts
accuracy. Fingerprints and technical values wrap. Library navigation, search,
role selection, history order and page persist in the URL hash.

The behavioral contract remains `sociotechnic/CONTRACTS.md`, including its Agent
library and Canonical UI Map sections. Buttons, tooltips, native selects,
loading/error states and scrollbars retain their canonical owners.

Run navigation uses full-row buttons. The selected row has a lightly tinted blue fill and a thin blue edge, with `aria-current` identifying it semantically. The selected run begins with its title and an expandable original request; project, status, branch, and round follow as metadata.

The evidence summary pairs a tonal gate statement with large check and review counts, labeled meters, the relevant commit, and record buttons. Attention and policy flags use a disclosure; issues and blockers open it by default. Human actions follow in a bordered surface. Preserve the engine's status names and legal actions.

Numbered workflow buttons expose each stage's meaning and available evidence. Current-stage emphasis is separate from recorded favorable evidence. Pinned plan steps are numbered disclosures containing scope, acceptance criteria, files, and risks; they never claim per-step completion.

The Checks milestone uses a document icon and **Evidence recorded** for current
builder-reported acceptance evidence when repository checks are unconfigured.
Keep the green passing checkmark for engine-run checks at the gate commit.
Overview and the current round in Analysis expose checked and unchecked
acceptance counts and a link to the original build record. Missing or stale
evidence stays explicit; builder reports do not clear policy flags.

**The Measured Progress Rule.** A meter represents its labeled count, deadline budget, or relative reported tokens. Workflow milestones and plan numbering never establish a percentage complete, acceptance, or publication.

### Run views and technical detail

Radix tabs expose Overview, Activity, Analysis, and Agents within the selected run. Overview is the initial view when a run is selected. Tabs use muted labels at rest and a bordered surface with the view accent when active; the active label is semibold. Icons and short descriptions aid desktop scanning; descriptions and then icons drop away as space narrows. Keep their keyboard navigation and semantic selected state.

Activity starts with a cyan-tinted driver area and collapsible log, then a newest-first dispatch timeline with expandable entries. Timeline and Technical grid buttons switch presentation; grid headers sort start, agent, and elapsed values with `aria-sort`. Activity exposes server-owned live output, recorded dispatch timestamps, elapsed time, deadlines, outcomes, record links, and human decisions. Agent and outcome filters use native selects. The expandable dispatch details retain complete UTC timestamps and reported measurements.

Analysis leads with large recorded-token and deadline-compliance values. A four-part breakdown shows uncached input, output, cache reads, and cache writes. Relative token bars compare agents; a native select sorts tokens, median duration, or agent name. Totals measure recorded activity, not subscription billing or remaining allowance. Session counters take precedence over overlapping per-model totals. A disclosure exposes the full timing and usage grid using the same order. Numbered round disclosures keep the current round open initially. Analysis shows per-agent timing, deadline compliance, reported tokens, all recorded rounds, build and check results, reviews and conformance, gate blockers and flags, and bounds and overrides. Missing measurements remain unavailable or unreported. Cumulative agent time may overlap and is not run wall time or generation speed.

Agents pairs a selectable roster with a role profile, large deadline and turn budgets, tool tags, a record-contract disclosure, and sortable dispatch history. Agents shows the selected run's pinned configuration and separately retains each historical dispatch's recorded version, model and effort. Role profiles expose their configured limits, record contract, and allowed tools; the selected agent's history is scoped to the current run.

Technical tables use compact sans text, tabular numerals, surface-backed headings, thin row separators, subtle row hover fills, and monospace identifiers. Their captions explain scope and measurement provenance. Scrollable regions are keyboard reachable. Logs wrap inside bordered, height-constrained surfaces; disclosure controls expose additional values while preserving each view's hierarchy. Radix tooltips explain measurement provenance and exclusions from labeled hint buttons; critical status and limits also remain in visible text. Active views use a brief contrast entrance (180ms), disclosure chevrons rotate (180ms), and progress values update immediately. Reduced-motion preferences disable transitions and animation.

### Dialogs and records

Action dialogs are centered and constrained to the viewport; record dialogs occupy most of the viewport with a record list and reader. On narrow screens, the record list sits above the reader. Radix provides modal semantics and focus containment. Action dialogs choose an appropriate initial focus; both action and record dialogs restore focus to their opener.

New run places Browse beside Repository path. Its inline folder browser reuses
the same fields and Button variants, with a fixed-height scrolling folder list,
parent navigation, a typed location and Use this folder. Loading and errors stay
inside the browser; closing it restores focus to Browse. Selection fills the
repository path. The visible Initialize Git if needed checkbox explains the
starter files and initial commit before Start. No new palette or modal is added.

The record viewer defaults to formatted Markdown with headings, lists, tables and highlighted fenced code. JSON, diffs and recognized code records retain their original text in monospace with syntax colors. `record-content.tsx` owns rendering, `record-format.ts` owns language selection and bounds, and `records.css` owns the scoped reading styles. Syntax colors reuse primary, violet, cyan, amber, positive, destructive and muted-foreground variables in both themes; they identify tokens rather than workflow outcomes. Code blocks and tables scroll independently and remain keyboard reachable. Raw view preserves the exact source and whitespace; Formatted view restores reading. Unsupported languages remain plain code and large inputs bypass formatting. Embedded HTML stays inert and images are explicit links. Loading, empty, stale, and error states use explicit text; retry controls remain available where implemented. Reduced-motion preferences disable transitions and animations.

## Do's and Don'ts

### Do:

- Do resolve theme colors through the existing CSS variables.
- Do pair status color with explicit status text and expose missing evidence plainly.
- Do preserve keyboard focus outlines and modal focus restoration.
- Do keep technical details and original records accessible through progressive disclosure.
- Do keep fonts and assets local.
- Do label counts, deadline budgets, and relative-token bars with their actual meaning.

### Don't:

- Don't substitute a new brand palette or display font for the existing console language.
- Don't turn a passed check or gate into a claim that the human has accepted or published the branch.
- Don't apply the modal shadow to every evidence section.
- Don't invent completion for numbered plan steps or treat missing usage as zero.
- Don't replace the intentional native project and status selects with custom listboxes without a concrete requirement.


### Explicit cleanup scope in New run

The existing New run dialog owns workflow selection. Its native Run type select
chooses Feature or fix, Design ceremony, or Comment cleanup. Cleanup reveals a
labeled multiline
literal-path scope field, keeps the goal optional, and uses Prepare cleanup plan
as the action. The resulting pinned plan is reviewed in the existing run view;
no planning agent starts in this path. General requests retain Start planning.
Use the existing form, dialog, busy state, validation, focus and error patterns.


### Design ceremony in Overview

Overview leads with the current design ceremony while a run is awaiting product
answers, direction choice or composition approval. Build evidence stays below it
once planning or implementation exists. Reuse the console's runtime tokens,
Button primitive, native stack select, labeled fields and Radix preview dialog.

A strategy introduction precedes three equal-salience preview alternatives, each
with a thesis, rationale and honest tradeoff. Radio controls express the chosen
option; a separate explicit checkbox confirms final composition approval.
Inspect preview opens a larger sandboxed view and returns focus to its trigger.
Closing a preview makes no decision. Distinguish HTML prototype from image
composition in visible text. Preview cards stack at narrower widths.

Interview drafts and selection survive failed requests. Pending responses disable
duplicate submits; stale/loading failures remain explicit and expose recovery.
A revision note requests another pass in the same phase. Approved design is a
human decision distinct from a passing build or acceptance. The workflow strip
adds Design only for jobs with ceremony state and marks it from recorded
approval. Do not introduce new theme tokens or overwrite a project's identity.

### Creating and assigning agents

Agent library owns Add agent beside its title. Reuse the version editor's Radix
modal, shared AgentSettings fields, native selects, inline errors, busy protection,
publication review and unsaved-draft confirmation. The form supports plain-text or
Markdown instructions, optional template copying, and an explicit peer review with
a distinct-responsibility note. Imported metadata never changes permissions.
Creation returns to the selected library profile with an announced v1.0.0 success;
New run's Agents and versions section owns explicit role assignment and legacy
release choice. Custom agents inherit their template's icon and identity color
through AgentIdentityProvider across all shared AgentIcon/AgentName consumers.
No new palette, modal primitive or settings owner is introduced.

### Database availability and run recovery

Run identity, archive visibility and evidence come from PostgreSQL. Missing local
agent staging never makes a run absent or hides its records. Worktree recovery
is a separate execution concern and must not be labeled as restoring evidence.
Archive/Restore remains the reversible rail visibility action and does not start
a run or recreate a worktree.

A database outage produces a clear availability error with retry/reconnect
behavior. Keep the selected run and filter context; do not replace unavailable
data with an empty-state invitation or local snapshot. After reconnect, refresh
committed state and resume the event stream. A surviving staged output is not
shown as a completed record until the server commits it. Existing typography,
layout, controls and human-gate meanings remain.
