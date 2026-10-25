---
version: 1
slug: "sociotechnic-ui-web-src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/experience.tsx", "src/components/technical.tsx", "src/experience.css", "../index.html"]
---

# Run console

Mode: Operate. Extend the existing Sociotechnic console for the owner supervising local
coding agents. Use the bay01 React/Vite scaffold with Sociotechnic's existing API. The
CLI and legacy console retain the broader command surface.

## Direction contract

THESIS: Make the run understandable through distinct working views, prominent
measurements, and expandable evidence. Keep the gate and human decision together.

OWN-WORLD: Preserve Sociotechnic's slate surfaces, blue actions, Geist typography, and
local assets. Amplify that identity with cyan Activity, violet Analysis, amber
Agents and attention states, and large tabular numerals. Runtime CSS remains
canonical (Model B): index.css owns the base theme; experience.css owns the
added accents and view composition. Both support system light and dark themes.

STORY: Select a job, inspect the workflow's recorded milestones, understand the
gate, inspect original records, test locally, and take the legal human action.
Choose Activity to follow dispatches, Analysis to compare measurements and round
evidence, or Agents to inspect current configuration and historical dispatches.

FIRST VIEWPORT: Compact job rail at left; run title and metadata above a seven-stage
workflow strip. Each stage opens its meaning and available evidence. The strip
stays compact and factual; it is not a percentage-complete visualization. Four
view buttons lead to different compositions:

- Overview pairs a tonal gate statement with check/review counts and labeled
  meters, then record shortcuts and human actions. Worktree details, the plan
  brief, and numbered plan steps disclose below. Steps expose acceptance
  criteria, files, and risks; numbering describes pinned scope only.
- Activity uses a cyan driver surface and collapsible log, then a newest-first
  dispatch timeline. A Technical grid toggle exposes sortable start, agent, and
  elapsed columns. Agent/outcome filters and original-record access remain.
- Analysis leads with reported spend and measured deadline compliance. Relative
  cost bars and the full usage grid share a sort selection: cost, median duration,
  or agent. Numbered round disclosures expose build, checks, reviews, conformance,
  blockers, and flags; the current round starts open.
- Agents uses a selectable roster beside a role profile with large deadline and
  turn budgets, tool tags, a record-contract disclosure, and sortable history.
  Current configuration remains distinct from the model and effort used earlier.

FORM: The owner requested more color coding, buttons, collapsible sections,
stylized plan stages, tooltips, progress indicators, sortable grids, and four
distinct experiences. This extends the established identity. No raster assets
were created. Details use native disclosures; tooltips explain measurements;
Radix retains tab and modal semantics. At narrow widths the workflow wraps,
evidence and Analysis stack, and the roster moves above its profile.

FINISH: Independent review returned ship with no material findings after the
four views at desktop and mobile widths plus the owner's wide viewport. Evidence
and verification notes are in `.impeccable/review/expressive-run-views/`.
`DESIGN.md` and `.impeccable/design.json` record the implemented additions.

Constraints: Preserve engine authority and human gates; missing or stale
evidence is explicit. Meters represent labeled counts, deadline budget used,
or cost relative to the highest reported agent cost. No progress indicator
establishes task completion, acceptance, or publishing. Missing usage is not
zero. Requests cannot overwrite another selected job. Confirm publishing, merge,
stop, and discard. Keyboard focus survives record updates. Keep the existing
localhost host/origin guards. No Nest migration.
