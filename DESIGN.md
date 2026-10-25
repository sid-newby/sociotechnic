---
version: alpha
name: Sociotechnic console
description: A local agent-work dashboard grounded in recorded evidence and human decisions.
colors:
  background: "oklch(0.145 0 0)"
  foreground: "oklch(0.985 0 0)"
  card: "oklch(0.205 0 0)"
  primary: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.205 0 0)"
  muted: "oklch(0.269 0 0)"
  muted-foreground: "oklch(0.708 0 0)"
  border: "oklch(1 0 0 / 10%)"
  input: "oklch(1 0 0 / 15%)"
  ring: "oklch(0.556 0 0)"
  destructive: "oklch(0.704 0.191 22.216)"
  chart-1: "oklch(0.488 0.243 264.376)"
  chart-2: "oklch(0.696 0.17 162.48)"
  chart-3: "oklch(0.769 0.188 70.08)"
  chart-4: "oklch(0.627 0.265 303.9)"
  chart-5: "oklch(0.645 0.246 16.439)"
  status-working: "oklch(.78 .12 250)"
  status-attention: "oklch(.82 .13 75)"
  status-completed: "oklch(.78 .12 155)"
typography:
  body:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  utility:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "0.8125rem"
    lineHeight: 1.4
  metric:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
spacing:
  page-narrow: "1rem"
  section-card: "1.5rem"
  page-wide: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
  section-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "{spacing.section-card}"
---

# Design System: Sociotechnic

## Overview

**Creative North Star: "shadcn dashboard-01, played straight."**

This is an operating console for a developer supervising coding agents. The
approved [direction contract](sociotechnic/ui/web/.impeccable/surfaces/sociotechnic-ui-web-src-app-tsx.md)
uses familiar dashboard composition: a quiet inbox sidebar, one decision at a
time, summary cards, recorded usage and a ledger that opens its evidence in
sheets. Its signature is the path from a summary to the exact supporting record.
Precision and readable state carry the identity.

Dark neutral is the default; light and selectable presets remain supported.
Preserve the incumbent Geist typography, restrained borders, rounded controls
and progressive disclosure. The owner selected this direction after declining
the earlier concepts recorded in the [redesign brief](dox/console-redesign-brief.md#10-locked-structure).
Do not reopen that choice during a finish pass.

**Key Characteristics:**

- The next human decision is apparent before its supporting detail.
- Numbers retain coverage, absence and provenance; color reinforces text.
- Shared primitives and semantic tokens keep every retained surface related.
- Documentation and captures identify what was actually inspected.

**Status and ownership.** This is a source-derived design record from application
base `1eb0a89d3c32319c3be5e530caf5605f1e0cecf3`, with the finish pass's shared
Textarea resize default reconciled from integrated source. Final rendered and
interaction verification remains pending the finish plan's P4 batch. Source declarations
below do not establish computed appearance, contrast, keyboard operation or a
passing finish review. The [product record](PRODUCT.md) retains the unresolved
formal accessibility target and narrow-viewport support commitments.

The existing runtime token system remains canonical (ownership model B).
Frontmatter mirrors the neutral-dark baseline; radius and spacing values assume
the neutral preset and the normal 16px root. It does not generate CSS or override
other presets. Change an approved runtime owner first, then reconcile this record
in the same change. [The builder guide](sociotechnic/docs/console-ui.md) traces the
implementation and checks. [CONTRACTS.md](sociotechnic/CONTRACTS.md#canonical-ui-map)
owns workflow, gates, navigation and feedback behavior.

## Colors

Neutral dark puts near-white content on near-black ground, with raised tones
for cards and popovers. Use semantic roles throughout; a matching current value
does not make two roles interchangeable.

### Primary

The near-white primary marks the main action against the dark ground. Pair it
with primary foreground. Secondary and ghost treatments keep supporting actions
quiet. Destructive color marks errors and consequential actions through the
shared variants, with an explicit label and confirmation where required.

### Neutral

Background is the page ground; card is the next tonal layer. Foreground carries
essential text, muted foreground carries supporting copy, and muted backgrounds
identify quiet groups and hover states. Border, input and ring have separate
roles for divisions, fields and focus. Sidebar and popover tokens retain their
own semantic aliases in the runtime map.

### Role, status and chart meaning

The five chart tokens supply role-family hues through
[role-colors.ts](sociotechnic/ui/web/src/role-colors.ts): plan/research uses
chart-1, build uses chart-2, review/conformance uses chart-3, design uses chart-4,
and approval uses chart-5. Unknown families use muted foreground. The same
mapping follows role chips and data views; do not assign new hues per screen.

Run and dispatch badges use the separate working, attention and completed
status variables, plus destructive and muted states. Their icons and labels
remain present. A role hue is not a verdict. Charts describe recorded usage and
its missing coverage; they do not invent a smooth live measurement.

### Themes

The runtime ships neutral plus 42 vendored TweakCN presets. Each preset remaps
semantic variables for light and dark; the provider applies theme values, then
light values, then dark overrides when selected. Geist stays in force because
vendored presets omit font variables. Scheme and preset persist in this browser;
storage failure leaves a page-local choice. Settings retains theme access when
the header controls are hidden below 1500px.

**The semantic color rule.** Consume the active tokens. Keep status labels,
icons and coverage text understandable when the palette changes.

## Typography

Geist Variable is installed locally and supplies headings, body and controls.
Heading aliases point to the same sans family. Code, paths and raw records use
the runtime monospace stack; no second display face or remote font is needed.

Body and designer conversation text use the body role in the frontmatter.
Utility metadata uses the utility role. Metric totals use the metric role with
tabular numerals; headings, labels and supporting copy establish hierarchy with
the existing shared size and weight variants. Sentence case and literal action
verbs suit an operating console. Preserve full identifiers through details,
record content or another explicit means when a compact view truncates them.

The approved utility floor is **13px**. The shared `text-xs` token implements it
at a 16px root. The shared Button `sm` variant now uses that canonical token instead of
`0.8rem`. Computed button typography in the eight primary capture states met
the floor. The finish review retains the source and runtime proof boundaries.

## Layout

Use the shared sidebar and header around the active content. The run screen
places its decision bar before summary cards, token chart and activity ledger.
History and Agents are separate destinations with run-scoped entry points.
New run, Settings and retained management forms use the existing dialogs or
sheets. The designer conversation stays in the run while samples and previews
open separately.

The neutral layout uses 16px page padding, 24px from the small breakpoint and
32px on large screens. Summary cards use 24px internal spacing, with a one-,
two- and four-column grid at 650px and 1360px. This is specific to section cards:
the generic Card primitive defaults to four spacing units, or three for its
small variant. Preserve the current component distinction. Two presets
(sage-garden and violet-bloom) override the spacing unit, so remapped utility
spacing must be inspected rather than assumed to remain a fixed pixel value.

The sidebar is off-canvas on narrow screens, with a visible trigger and the
existing Command/Ctrl+B shortcut. The command palette also has a visible button
and Command/Ctrl+K shortcut. Below 850px the run status moves into the content;
the header preserves room for the title and controls.

Keep scrolling with its content owner: the page carries the dashboard, tables
have horizontal overflow, record sheets have an internal content scroller, and
long forms stay reachable inside the bounded form dialog. The designer thread
owns its conversation viewport; its header and composer occupy separate grid
rows. Reading earlier messages must remain independent of incoming text.
Do not constrain the shared page merely to make one table fill a viewport.
The global stylesheet supplies thin token-colored scrollbars; their non-default computed color was confirmed in the primary capture states.
Forced-color/device coverage beyond the recorded fixtures remains unverified.

## Elevation & Depth

Tonal surfaces and fine outlines provide the resting hierarchy. Cards use a
foreground-derived ring, while sheets use the installed shadow and a dimmed,
optionally blurred overlay. Dialogs and popovers retain their shared primitive
treatments. Do not add decorative depth to ordinary evidence rows.

Preset JSON contains shadow variables, but the current Tailwind utilities do
not consume them through the token map. A preset's shadow metadata is therefore
not a promise that the rendered shadows change. The runtime component classes
remain the source for elevation.

Transitions explain opening, closing, focus and state. Active indicators may
animate through motion-safe utilities. The global reduced-motion rule removes
animations, transitions and smooth scrolling; preserve that behavior for new
components rather than adding a parallel motion system.

## Shapes

The neutral radius is 10px. Runtime aliases derive small, medium, large and
extra-large corners by factors of 0.6, 0.8, 1 and 1.4, mirrored in the
frontmatter. Buttons and fields use the large control radius; cards and dialogs
use the extra-large container radius. Presets can change the base radius.
Status and role badges retain their compact shared shape and accompanying text.

Borders separate controls, table groups and overlay surfaces. Preserve
`data-slot` hooks and component composition instead of painting a new outline
or corner treatment at every call site.

## Components

### Buttons and fields

Use the installed Button's default, outline, secondary, ghost, destructive and
link variants. Primary uses the paired semantic colors; ghost and outline states
use muted/input tones. Shared focus-visible and invalid treatments use ring
and destructive roles. Preserve disabled semantics and busy feedback. Compact
size variants retain the same utility floor.

Fields use the installed Input, Textarea, Input Group, Label and authored Radix
Select. Compose retained forms with Field, InlineError, FormSelect and
FormDialogContent. Labels, help and correction text must remain associated with
their fields. Textarea supplies a shared non-resizable default while consumers
retain their sizing. Popup alignment, collision handling, keyboard operation and focus
return require browser proof; the existence of a wrapper is insufficient.

### Cards, charts and evidence

SectionCards exposes agent time, tokens, cache reads and the current moment.
Values open their supporting metric or record. Preserve unavailable and partial
measurements. The TokenBurnChart uses the existing shadcn/Recharts wrapper and
dispatch/round/run ranges; RunTable uses TanStack column visibility, search and
filtered CSV export. Its four tabs are Dispatches, Records, Log and Decisions.

Record, dispatch, metric and evidence sheets disclose the supporting detail.
Use the canonical record viewer for formatted/raw content and original-byte
download. Keep earlier rounds, exact source links and the distinction between
current, stale, skipped and missing evidence.

### Navigation, overlays and feedback

Reuse AppSidebar, SiteHeader, command palette and existing run controls. Modal
composition comes from the installed Radix wrappers, with named content and
explicit opener/focus-return handling. Do not create competing modal focus
traps when moving between a dispatch and its record. Inline alerts keep
actionable errors visible; the shared Sonner system acknowledges confirmed
outcomes. Loading skeletons, empty states and stale-data retry belong to the
existing owner for each surface.

### Designer conversation

Preserve the separate thread-scroll owner, human-turn anchoring, live-edge
following and Return to latest control. Markdown remains readable at body size,
with bounded code/table scrolling and image attachments. Drafts, attachment bytes
and retry identifiers survive a failed send. IME and Shift+Enter remain part of
the composer contract. Native questions stay in the conversation; previews and
artifacts open separate tabs. Return work remains an explicit lifecycle action.
The final fixture journey exercised these interactions with fake SDK messages
and the actual installed native preview command, with zero model calls. It
does not establish live model access or creative skill quality.

### Runtime mapping

| Recorded token or rule | Canonical runtime owner | Adapter and consumers |
| --- | --- | --- |
| Neutral colors and radius baseline | [neutral preset](sociotechnic/ui/web/src/theme/presets/shadcn-neutral.json), [index.css](sociotechnic/ui/web/src/index.css) | [provider](sociotechnic/ui/web/src/theme/provider.tsx) applies variables; `@theme inline` maps semantic utilities to shared primitives |
| Other palettes and scheme composition | [presets.ts](sociotechnic/ui/web/src/theme/presets.ts), preset JSON | ThemeProvider; [ThemeSwitcher](sociotechnic/ui/web/src/theme/theme-switcher.tsx); no per-view palette copies |
| Typography, status, radius aliases and scrollbars | [index.css](sociotechnic/ui/web/src/index.css) | Shared [UI components](sociotechnic/ui/web/src/components/ui/), status badges and all owned scrollers |
| Summary spacing and metric type | [section-cards.tsx](sociotechnic/ui/web/src/components/run/section-cards.tsx) | Card parts; spacing derives from the active unit |
| Role-family hues | [role-colors.ts](sociotechnic/ui/web/src/role-colors.ts) | Role chips and data views consume chart tokens |
| Conversation geometry and reading measure | [design.css](sociotechnic/ui/web/src/design.css), [design-thread.tsx](sociotechnic/ui/web/src/components/design-thread.tsx) | Designer thread and composer; no global typography replacement |

## Do's and Don'ts

- **Do** preserve the approved dashboard direction and shared semantic owners.
- **Do** put the current decision and summary before the supporting evidence.
- **Do** keep a label, icon and source behind status and measurements.
- **Do** verify light/dark, narrow layouts, open popups, keyboard, long content
  and reduced motion against the same frozen application build.
- **Don't** restore the removed Overview/Activity/Analysis experience or stage
  strip as the React console's navigation.
- **Don't** turn missing usage into zero, stale checks into a pass or fixtures
  into claims about an active run.
- **Don't** introduce a new font, palette, component system or token generator
  during a finish pass.
- **Don't** broaden fixture evidence into a claim about live providers, every
  device, or a clean static audit. Preserve the recorded finish limitations.
