# Design ceremony verification

This is historical evidence for the retired packet workflow. Current session
integration evidence is recorded in [Interactive design verification](interactive-design.md).

Verified on 2026-10-24 in isolated jobs and disposable target repositories.
The tests exercised real engine state, Git worktrees, HTTP handlers, the shared
driver and browser UI. Automated fixture previews are labeled as such; they are
not evidence of live Fable creative quality.

| Check | Observed result |
| --- | --- |
| `task checks` | Engine/console type checks, console build and 14-role validation passed. 157 tests: 156 passed, zero failed, one optional PostgreSQL test skipped. Production audit found no known vulnerabilities. |
| Ceremony integration | Interview, optional stack, directions, compositions, same-job revision, explicit approval and digest-bound final planning passed. Waiting does not redispatch. Ordinary feature behavior remains covered. |
| Approval boundaries | No selection/confirmation, stale preview bytes, scaffold changes, missing context receipt, prior-round writes, symlinks and traversal are rejected. Stop/reopen and bounded retries are covered. |
| Context isolation | Each atelier receives target product/design context; later previews receive confirmed selected product truth. Application source remains untouched during design. |
| Browser journey | Real browser interaction with fixture agents reached held `planned`, round zero, without a build dispatch. Selected stack was React/Nest. The worktree stayed clean and base HEAD unchanged. |
| Responsive/keyboard | Desktop and a real 390×844 application iframe show three/stacked previews. Expanded HTML inspection accepts keyboard focus and scrolling; Shift+Tab, Escape and return to the trigger were verified. |
| Live provider/tool smoke | Canonical `claude-fable-5-1` connected, called the real installed Impeccable context tool and wrote a valid guarded packet with a current receipt. No permission denials. This was a bounded tool smoke, not the full creative ceremony. |
| Mechanical design detector | Run once against the changed UI: no findings. |
| Premium static audit | Same three `affordance.actionless-button` findings as the baseline. These are Radix `asChild` trigger/close patterns with delegated behavior; no new findings. The strict audit therefore remains nonzero. |
| UI finish handoff | Reviewer verified the two material fixes: modal layering above the overlay and keyboard access to expanded HTML. `ship` scores those fixes only. |
| Portable UI standards | The scaffold-ui skill passed its validator. Tests copy the template, verify pinned upstream hashes and prove guide changes alter the selected scaffold digest. Source/license files travel with generated projects. |
| Updated scaffold checks | Disposable frozen install, typecheck, lint, format check, eight API unit tests, one API e2e test, builds and production audit passed. No application dependencies or policy restrictions changed. The existing Ping API browser smoke predates this documentation-only scaffold update. |

The browser journey exercised validation focus, a direction revision, selecting
a direction, three composition previews, an intentionally edited preview and
stale-response rejection, regeneration with retained steering, and separate
composition/confirmation approval. Failed requests retained the same-packet
selection. Approval continued the same job to final planning, held for human
review before building. See [recorded journey](design-ceremony/browser-journey.json).

The live smoke established provider/tool access and the scoped write path.
It did not establish the quality of a live interview, three live directions or
image comps. `OPENAI_API_KEY` was not configured for the Impeccable image path;
self-contained HTML prototypes remain available and visibly labeled. Rendered
application verification against an approved design remains the builder's job.
The binary-preview database-backup limitation is documented in the
[workflow guide](../design-ceremony.md).

Evidence:

- [Desktop showcase](design-ceremony/showcase-desktop.png) and
  [390px showcase](design-ceremony/showcase-390px.png).
- [Desktop expanded inspection](design-ceremony/inspect-desktop.png) and
  [390px expanded inspection](design-ceremony/inspect-390px.png).
- [Live tool smoke](design-ceremony/live-tool-smoke.json),
  [mechanical detector](design-ceremony/mechanical-detector.json) and
  [static audit/baseline comparison](design-ceremony/static-audit.json).
- [Scoped finish review](design-ceremony/finish-review.md) and
  [documentation handoff](design-ceremony/documenter.md).
