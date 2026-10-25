# Run console redesign brief

Draft for the owner's confirmation, October 25, 2026. Product truth lives in
[PRODUCT.md](../PRODUCT.md). There is no visual authority: DESIGN.md was retired
today and the replacement world is chosen in the next step, not here. Line
references point at `sociotechnic/ui/web/src/` unless another path is given.

## 1. Job and audience

One developer supervising coding agents from a desktop browser, usually while
a run is working. Mode: **Operate**. Three moments carry the whole surface:

1. **Something needs me.** Find it instantly, read the exact document, see the
   legal actions, know what I am being asked to decide.
2. **What is happening right now, and can I intervene.** Which agent, which
   model, how long, how many tokens, and the controls to pause, stop, step or
   raise a bound without leaving the page.
3. **Why did it stop, and where did the tokens go.** Reason, evidence and cost,
   each one click from the number to the record that produced it.

Everything else is history and lives somewhere else, read through charts with
drill-down. Color means state or role, nothing else.

## 2. What the current console gets right

| Keep | Why it earns its place | Where it moves |
| --- | --- | --- |
| Human-gate actions and their status rules (`components/actions.tsx:74-92`) | Complete and correct for every gate | Into a decision bar at the top of the run page, with instructions |
| Records viewer: formatted/raw, GFM, JSON and diff highlighting (`components/record-content.tsx`) | Reading evidence works | Opens inline beside the decision and from every ledger row; gains download |
| Agent library: deployments, errors, median duration, tokens, feedback categories, versions, Add agent (`components/agent-library.tsx`) | The strongest view in the app | Becomes the only agents surface; the in-run Agents tab folds into it as a filter |
| Design conversation: messages, native questions, previews, approval (`components/design.tsx`) | It is the live surface during a design run | Stays the body of the run page while status is design-input |
| SSE connection, active dispatch cards with elapsed, deadline and budget meter, driver log (`components/technical.tsx:62-66`) | This is the real-time kernel the owner wants first | Promoted from a collapsed block under a tab to the top of the page |
| Token breakdown by cache category (`components/technical.tsx:118-119`) | Honest measurement | Live on the run page; history with charts elsewhere. Cost is already computed and never shown (`telemetry.ts:33,38`): show it |
| Sandboxes capacity and inventory (`components/sandboxes.tsx`) | Real control over slots | A settings surface, not a dialog |
| Run list search, project and status filters, archive (`App.tsx:72-82`) | Needed | Regrouped as an inbox: Needs you, Working, Done; sorted by last update |

## 3. What goes

| Cut or merge | Evidence |
| --- | --- |
| The four tabs as navigation | Overview is the conversation on design runs and evidence otherwise; Activity hides the live kernel; Analysis is empty until dispatches finish; Agents duplicates the library (`App.tsx:98-106`, `components/technical.tsx:129-151`) |
| The 7-to-8 card workflow strip | Reads only the current round with no round switcher; mixes whole-run cards (Plan) with per-round cards; Approve is never marked good; the Human card changes meaning by status (`components/experience.tsx:25-41`) |
| "What the evidence says" as a separate section | The gate card, blockers and record shortcuts belong next to the decision they inform (`components/experience.tsx:52-71`) |
| Four routes to the same plan.json | Plan card, Plan shortcut, "The plan" section and "Read the complete plan" (`components/experience.tsx:70,74-78`; `App.tsx:105`) |
| The in-run Agents tab | Every field overlaps the library and it goes stale during a run (`components/technical.tsx:134-139`) |
| "Not reported" tiles as a live view | Analysis fills only after dispatches finish; it is history (`components/technical.tsx:118-124`) |
| Duplicate Stop run and Manage sandboxes entries | Actions, Sandboxes dialog, New run (`components/actions.tsx:82,90`; `components/sandboxes.tsx:36`) |
| The raw status reason string | `retry-bound:design (1 + 0 overrides): ...` is shown verbatim with no instruction (`App.tsx:96`); the decision section links to no record (`components/actions.tsx:74-92`) |

## 4. Defects found while reading

- Reopen never sends the discard flag; the body falls through to `{note}` (`components/actions.tsx:62`). Only the legacy console offers discard.
- The PR action always pushes; local PR text is unreachable from React (`components/actions.tsx:62`).
- At design-input the decision text says "below" but the conversation renders above (`components/actions.tsx:17`; `App.tsx:101,103`).
- The Stop dialog has no note field, so human decisions read "No note recorded" (`components/actions.tsx:114`).
- Every SSE event refetches the run list, the run, checks and build.md after 250 ms (`use-console.ts:46-50`); the driver log is not streamed and is capped at 200 lines (`sociotechnic/ui/driver.ts:54,95`). This is the "cannot scale" feeling.
- The Agents tab fetches only when the job changes (`components/technical.tsx:134-139`).
- Docs disagree with code in four places: `sociotechnic/docs/cli-reference.md:160,173,246,568-571` and `sociotechnic/CONTRACTS.md:1739`.

## 5. Parity: what the engine can do versus what the console reaches

| Capability | Exists today | Console today | New console | Work beyond UI |
| --- | --- | --- | --- | --- |
| Accept, rework, stop, pause, reopen, archive, push and PR, merge locally, merge on GitHub, finish | CLI + API | Yes | Decision bar | None |
| Override a bound at needs-human | CLI + API | Yes | Decision bar | None |
| Raise a bound before it trips | API (`POST /override`, any non-terminal status) | No | Inline on the bounds card | None |
| Hold after any status | CLI `run --hold`, API `/run {hold}` | Only `planned` | Driver controls | None |
| Single-step | CLI `step`, API `/step` | No (legacy only) | Driver controls | None |
| Restore without continuing | CLI `restore` | No | Driver controls | Small API route |
| Reopen with discard, local PR text | API | Wired wrong | Decision bar | None |
| Record download | `GET /records/*` returns JSON | No | Every record | Content-Disposition or client blob |
| Live log streaming | SSE `/events` triggers refetch | Collapsed, 200 lines | Streamed pane | Driver emits log events; raise the cap or page it |
| Interrupt one dispatch, keep the run | Nowhere; one AbortController per job (`sociotechnic/ui/driver.ts:65,145,280-288`) | Stop kills everything | Per-dispatch control | Driver work |
| Concurrency cap on local runs | Nowhere; `Promise.allSettled` with no limit (`sociotechnic/ui/driver.ts:190`) | No | Driver controls | Driver work |
| Change budgets or execution on a running job | Nowhere; jobs pin agent versions | No | Not promised | Engine work, later |
| Sandbox slots, per-run CPUs, memory, workers | API | Yes | Settings and New run | None |

## 6. The reimagined structure

Where each feature lives, what it takes in and what it writes.

**Shell.** Sidebar: Runs inbox (Needs you, Working, Done), Agents, History,
Sandboxes, Settings. Header: run title, status, live indicator, theme switcher,
New run, and a command palette that lists every engine command with its CLI
equivalent, so the console teaches the CLI instead of hiding it.

**Run page, live.** Four regions, no tabs.

1. **Decision bar.** Present only when the run waits on you. One plain
   sentence: what happened and what you are asked to decide. The document to
   read rendered inline (plan, HANDOFF.md, gate blockers, approval). The legal
   actions. Inputs: note, tested checkbox, bound choice, merge method. Outputs:
   the existing job action routes.
2. **Now.** Active dispatches as cards: role color, agent and version, model
   and effort, elapsed against deadline, turns, tokens and cost so far. Bounds
   with round, dispatches and retries against caps, each with a raise control.
   Driver controls: pause after dispatch, stop with a note, step, hold after a
   status, interrupt this dispatch. Inputs: those controls. Outputs: `/pause`,
   `/stop`, `/step`, `/run {hold}`, `/override`, and a new per-dispatch route.
3. **Ledger.** One table for the run: every dispatch, record, check, review
   verdict and gate decision, newest first, round switcher at the top. A row
   opens its record in a side sheet with formatted, raw and download. The
   workflow milestones survive as a compact progress rail above the ledger.
4. **Log.** The driver log streamed line by line, visible whenever a dispatch
   is running, filterable by dispatch.

During a design run the conversation is region 1 and 2 together: the question
and composer where the decision bar sits, the live dispatch card beside it.

**History.** Per run and across runs. Tokens by role per round, cost over time,
elapsed per dispatch, errors and wins by category. Every bar drills to the
round, the dispatch and the record. Chart colors come from the active theme's
five chart tokens; role colors stay fixed per agent.

**Agents.** The library as it is, plus an "in run" filter that replaces the
old tab, and provenance links on every count: deployments, errors and feedback
categories open the run, round and dispatch that produced them.

**Sandboxes and settings.** Capacity, retained sandboxes, theme, default
holds, local concurrency cap once it exists.

**New run.** The existing form, rebuilt on the same components. Agent
assignment and version pinning stay.

## 7. Stack and theming

This is not a migration. The console already is the bay01 scaffold's web app:
same React 19.3.1, Vite 8.3.5, Tailwind 4.3.3, radix-ui 1.8.1, lucide,
Geist and an identical `components.json` (style `radix-nova`). What it lacks is
the scaffold's CSS contract and real components: `index.css` defines five
hex variables and only `button.tsx` exists under `components/ui`. The scaffold
imports `tw-animate-css` and `shadcn/tailwind.css`, maps the full token set in
`@theme inline`, and depends on `shadcn` 4.22.1
(`sociotechnic/scaffolds/react-nest/template/apps/web/`). The NestJS half of
the scaffold is irrelevant here; `sociotechnic/ui/server.ts` stays.

- Adopt the scaffold's `index.css` contract in place and add `shadcn` and
  `tw-animate-css` to the console workspace.
- Pull components through the CLI: sidebar, card, table, tabs, badge, button,
  sheet, drawer, dialog, select, dropdown-menu, command, input, textarea,
  checkbox, toggle-group, separator, tooltip, sonner, chart, progress,
  scroll-area, skeleton. The `dashboard-01` block is the shell donor: sidebar,
  site header, section cards, interactive chart, data table.
- Charts through the shadcn chart wrapper over Recharts; data tables through
  TanStack Table.
- Themes: vendor all 42 TweakCN presets from `https://tweakcn.com/r/themes/<key>.json`
  (Apache-2.0; add the notice to THIRD_PARTY_NOTICES.md). Runtime switcher
  sets the preset's light or dark variables on the root. Neo Brutalism is the
  proposed default. Presets name Google fonts; PRODUCT.md keeps assets local,
  so each preset's font variables map to the locally bundled faces unless the
  owner chooses to vendor font files.
- A second theme source: the owner shared two shadcnthemer.com registry items
  (`registry:style`, same variable contract, 35 variables per scheme, 0.625rem
  radius, system font stack). "Fork of Twitter" is black with a blue primary,
  the look of the shadcn example cards; "My Theme" is the same frame with a red
  primary. Both load through `pnpm dlx shadcn@latest add <url>`; their license
  is unverified (the site shows Terms of Service only), so vendoring waits on
  that check.
- Conventions follow the scaffold's own UI skill
  (`sociotechnic/scaffolds/react-nest/template/.agents/skills/scaffold-ui/SKILL.md`):
  `pnpm exec shadcn add <component>` from the web workspace, `` as the
  default registry, third-party registries only with source review, `cn` from
  the installed package, variants through class-variance-authority, one font
  system, reduced motion respected. TweakCN is that third-party case: its theme
  JSON is vendored and reviewed, never pulled at build time.

## 8. States and ranges

Runs from zero to hundreds, filtered and grouped. Dispatches per run from one
to roughly fifty across rounds. Log output beyond the current 200-line cap.
Token totals into the millions with cost beside them. Round zero runs with no
plan. Design runs with an open native question. Runs owned by another console.
Stale or unavailable API with the last loaded state shown and actions disabled.
Sandboxed and local execution. Narrow viewports must stay usable; desktop
leads.

## 9. Decisions

Confirmed by the owner on October 25, 2026:

1. Stack: adopt shadcn and TweakCN in place on the existing Vite console. No
   workspace rebuild, no NestJS move; `sociotechnic/ui/server.ts` stays.
2. First pass: the live surface first. Shell, run inbox, run page with
   decision bar, now cards, ledger and streamed log, theme switching. History
   charts, the agents merge and settings follow in later waves.
3. Driver work is in scope: per-dispatch interrupt, a local concurrency cap and
   streamed log events ship with the UI, behind the existing contracts and
   tests.

Still open, proposed defaults in force until the owner says otherwise:

4. Default theme: proposed Twitter (shadcnthemer), after the owner shared the
   shadcn example look and three Twitter-family themes on October 25; Neo
   Brutalism stays in the switcher as a preset. Awaiting the owner's word.
5. Fonts: preset font variables map to the locally bundled faces.
6. Chrome comes from the theme, never from custom CSS: 1px borders, the
   theme radius and shadow variables, 24px card padding, muted secondary text,
   primary color reserved for actions and the current selection. The banner
   does not appear in the console shell; the wordmark does.

## 10. Locked structure

The concept round dealt three structures (Memo and Board, Cockpit, Spine) and
one challenger (Departures) on October 25, 2026. The owner rejected all four
after clickable samples and pinned the form instead: the run page is the
shadcn `dashboard-01` block, played straight.

- **Sidebar**, collapsible off-canvas with a header trigger and ⌘B: the
  wordmark as text (lowercase, 800 weight), New run plus the command palette
  button, Runs, Agents, History, Sandboxes, an Inbox group (Needs you, Working,
  Done with counts), the runs in the selected group, Settings, Get help,
  Search, and the user footer.
- **Header**: sidebar trigger, breadcrumb Runs / run title, status badge.
- **Decision bar**, only when the run waits: one bold sentence, one muted
  line, Read the document (opens a side sheet), the primary action, the rest
  quiet.
- **Four section cards**: Agent time, Tokens, Estimated cost, and the fourth
  is the moment (Plan when planned, Checks when building or parked). Each
  card: label, big number, trend badge, one bold line, one muted line. A card
  that means something opens its sheet on click.
- **Token burn chart**: total tokens and cache reads as two areas with a range
  toggle (This dispatch, This round, Whole run), live while a dispatch runs.
- **Tabs and one table**: Dispatches, Records, Log, Decisions, with Customize
  columns and Download. Rows open a side sheet with the detail and the record;
  the live dispatch sheet carries Interrupt dispatch.
- **Progressive disclosure is the rule**: the page shows what a number means;
  the sheet shows why. Nothing is a wall of text on the page.

Theme: the shadcn default neutral by default, the owner's Twitter preset and
the TweakCN presets in the switcher, dark first. The prototype lives in this
session's scratchpad as `proto/index.html`; the structures round stays at
`proto/structures.html` for reference.

## 11. Process from here

The locked structure becomes the direction contract in the surface brief. The
build runs in waves: shell, theme and run page; history and charts; agents
merge; driver parity work. Each wave is verified in the browser against the
demo store and a real run, and the README, CLI reference and contracts are
updated where console behavior changes.
