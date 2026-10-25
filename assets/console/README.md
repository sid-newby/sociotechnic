# Console screenshots

The current set was refreshed after the recorded-usage package on October 25, 2026 from the integrated finish
worktree based on `bc09db86f346939b1a8ddb697d984b08241eedc0`. It shows the built
React console with disposable in-memory data, not an active user run.

## Primary set

All eight primary images are direct, lossless **1600 × 1000** PNG captures:
1× scale, shadcn neutral dark, reduced motion, local fonts, English labels and
UTC timestamps. They use the committed `sociotechnic/ui/seed/demo-job/` snapshot
and bundled agent catalog. The Add agent view is an unpublished draft. No
agent is dispatched, no production database is contacted, and browser write
requests are refused.

| Image | Current subject |
| --- | --- |
| [overview.png](overview.png) | Dashboard, recorded approval, summary cards and token burn; cache reads are unreported in this demo |
| [start-a-run.png](start-a-run.png) | New run form with a demonstration request; not submitted |
| [activity.png](activity.png) | Dispatch ledger with recorded models, effort, timing and source records |
| [round.png](round.png) | Evidence sheet with the demo gate and commit-bound review results |
| [analysis.png](analysis.png) | History cohort with measured tokens/time and explicit missing cache-read measurements |
| [agent-library.png](agent-library.png) | Current specialist roster and demo deployment evidence |
| [agent-creation.png](agent-creation.png) | Add agent draft with adapted planner instructions |
| [records.png](records.png) | Formatted Markdown plan and original-record controls |

[Machine provenance](capture.json) records the exact source/build/script digests,
image hashes, timestamp and geometry. The source digest includes the integrated
working tree, not just its base commit. Capture checks confirmed button text at
least 13px, non-resizable textareas and themed scrollbars. The Run type select
matched its trigger at 1600px and 390px and restored focus after Escape. Separate
sandbox UI checks intercepted every inventory response, exercised invalid/empty
recovery and canceled removal; no sandbox operation ran.

The actual capture command was:

```bash
SOCIOTECHNIC_PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node sociotechnic/scripts/console-screenshots.mjs
```

Use an existing local Playwright installation or separately authorize setup.
Freeze and build the source before capturing. Inspect every image at native
size and verify links before integrating it. The script owns an OS-assigned
loopback port and a new headless Chrome profile; its cleanup closes only its
own browser/server and disposable home. It does not invoke port cleanup,
`task dev`, `task ui`, or the user's console PID/stop machinery.

## Supplemental current fixtures

These **1440 × 1000** dark captures use the same built application with their
own deterministic fixture scenarios. They are not additional views of the
committed demo run. [Supplemental provenance](supplemental-captures.json) gives
hashes, dimensions and source scripts.

| Image | Fixture and proof |
| --- | --- |
| [settings.png](settings.png) | Browser-owned run defaults; verify-console-history.mjs |
| [designer-chat.png](designer-chat.png) | Designer conversation and composer; fake SDK messages, no provider call |
| [commands.png](commands.png) | Legal commands for a synthetic needs-human run; verify-run-page.mjs |

The [finish review](../../sociotechnic/docs/evidence/console-finish/finish-review.md)
records desktop/narrow, light/dark, error, missing-evidence, focus and fixture
verification. Source and browser reports do not establish live provider/model
success or a universally clean accessibility audit.

## Historical images

`analysis-ov.png`, the v0.1.5 header crops and
`new-repository-publishing.png` are retained historical assets. Their dimensions
and layouts differ from the current primary set; they are not current captures.
Owner-provided `assets/fog*.png` files also remain preserved, with the README now
using the coherent current set. Earlier capture metadata is available in Git
history. See [development instructions](../../sociotechnic/docs/development.md#console-screenshots)
for the maintained capture workflow.

Current captures include the merged orchestration base and the uncommitted UI patch. See [combined verification](../../sociotechnic/docs/evidence/console-finish/combined-verification.json); earlier finish reports remain historical checkpoints.
