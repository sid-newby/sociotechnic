# Console screenshots

These are direct captures of the built React console, using the committed
`sociotechnic/ui/seed/demo-job/` snapshot and agent release catalog in an isolated
in-memory store. They are demonstration views, not an active run. The Add agent
image shows an unpublished draft. No agents are dispatched and no live database
or catalog is changed.

The set was refreshed on October 24, 2026 against application commit `e831dea`.
Every image in that set is a lossless PNG at **1600 × 1000**, with dark color scheme, 1×
device scale, reduced motion, local fonts, English labels and UTC timestamps.
Captures use the app's real layout and native scrolling, without CSS overrides,
stitched pages, retouched content or resized exports.

| Image | Subject |
| --- | --- |
| [overview.png](overview.png) | Workflow stages and current gate evidence |
| [start-a-run.png](start-a-run.png) | Complete New run form with an example request |
| [activity.png](activity.png) | Completed dispatch history, verdicts and elapsed times |
| [round.png](round.png) | Build commit, checks, reviews and gate details |
| [analysis.png](analysis.png) | Token totals, unavailable breakdowns and per-role effort |
| [agent-library.png](agent-library.png) | Current specialist roster, versions and planner evidence |
| [agent-creation.png](agent-creation.png) | Add agent form with an unpublished release-planner draft |
| [records.png](records.png) | Formatted Markdown plan and original-record navigation |

For refresh instructions, see [Console screenshots](../../sociotechnic/docs/development.md#console-screenshots).

## Version header

The v0.1.5 header captures use the same isolated demo data and built console,
captured directly from `.app-header` at desktop (1440 px) and narrow (390 px)
viewport widths, dark theme and 1× device scale. They show the shared title
typography and wrapping actions; the original full-console set above is retained.

- [Desktop header](version-header-desktop-dark.png)
- [Narrow header](version-header-mobile.png)

## New repository publishing

[New repository publishing](new-repository-publishing.png) is a targeted capture
from `sociotechnic/scripts/verify-run-wizard.mjs` on October 25, 2026, after rebasing
the publishing fix onto `2007ea4`. It uses disposable folders, an in-memory store,
fake agents and a local fake GitHub transport. The direct dark-theme capture is
1440 × 1100 at 1× scale with reduced motion. It shows the destination and explicit
publish action; no user repository or production run appears in the image.
