# Design ceremony documentation handoff

Ordinary extension of the established Operate console. No design-system files
were rewritten or regenerated in this pass. The new durable behavior is
substantially documented, and runtime token ownership remains consistent.

Compared `PRODUCT.md`, `DESIGN.md`, the existing console surface brief,
`sociotechnic/CONTRACTS.md`, `sociotechnic/docs/design-ceremony.md`, the README
ceremony entry, and the development/CLI/engine reference entries against
`components/design.tsx`, `App.tsx`, `components/actions.tsx`, `index.css`,
`experience.css`, and the shared `components/ui/button.tsx`. Paths in this
paragraph are relative to the repository root or the console's `src/` directory
as appropriate. Read-only stylesheet diffs showed no added theme primitives.

The recorded interview → direction → composition → explicit approval → final
planning sequence matches the console source. Stack selection is separate from
visual direction; preview inspection makes no decision; the approval checkbox
is separate from radio selection. Pending requests prevent duplicate submits,
failed requests retain same-packet drafts, and revisions use the same job.
Contracts and the workflow guide preserve acceptance, publication and merge as
separate human gates. These are source/document comparisons, not an independent
live engine or provider verification.

Inspected `showcase-desktop.png`, `showcase-390px.png`, `inspect-desktop.png`, and
`inspect-390px.png` in this directory. They show the incumbent dark console,
three alternatives at desktop width, stacked alternatives in the actual 390px
app iframe at the left of the narrow captures, and enlarged modal inspection.
The HTML contents are explicitly automated fixtures, not live Fable creative
work. The finish review's `ship` disposition scores only modal layering and
keyboard inspection resolved; it does not establish whole-surface approval or
image-generation quality. Source confirms modal z-index 50 above overlay 40,
focusable expanded HTML and thumbnails outside the tab sequence.

Five-line system summary:

1. Palette: existing slate neutrals, blue actions and semantic status/view colors retain system light/dark alternatives; previews do not define console colors.
2. Type: local Geist, the existing 15px body and compact labels remain; technical records retain monospace. Preview titles are local composition details, not a new global type role.
3. Ownership: `index.css` owns base runtime tokens, `experience.css` owns existing accents/view composition, and `Button` owns variants; DESIGN.md frontmatter mirrors that Model B source of truth.
4. Surfaces: flat bordered sections, native labeled fields/selects, shared buttons and Radix modal semantics continue; the three-column showcase stacks below 1100px without introducing tokens.
5. Named rules: Semantic Color, Reading Role and Flat Surface remain the incumbent rules; no ceremony-local sizing or fixture styling was promoted into a global rule.

Bounded documentation recheck: both reported discrepancies are resolved.
DESIGN.md's “Explicit cleanup scope in New run” paragraph now includes Design
ceremony, and the workflow guide links to the existing
`sociotechnic/docs/evidence/design-ceremony.md`. That evidence summary explicitly
separates automated fixtures, bounded live-tool smoke and the finish verdict's
two-fix scope. No documentation discrepancy remains in these two checked items.
The separate scaffold UI standards addition was outside this recheck and was
not reviewed or scored here; the UI was unchanged after the captures above.

Not canonized or repaired: the reported pre-existing `.impeccable/design.json`
drift remains outside this report's write boundary; the launcher's
missing-root-context/orphaned-brief findings
came from nested app path resolution, while root PRODUCT.md/DESIGN.md and the
named App.tsx exist. No new defect was converted into a design-system rule.
