# Run records reading plan

Make existing evidence easier to read in the React Run records dialog, retaining exact source through Raw view. Reuse the current record API, asynchronous loading/retry, Radix dialog, Button, fonts, theme tokens and scrollbars.

1. Update the console contract before implementation. Add a lazy-loaded record renderer with GitHub-flavored Markdown, highlighted fenced code (explicit language or bounded detection), JSON and diff records. Unknown languages and large inputs stay readable as plain text. Never execute record HTML or code; external images stay links.
2. Add scoped reader styles using existing light/dark variables. Preserve the current modal and navigation; make code/table overflow independently keyboard scrollable. Keep raw bytes and loading/empty/error/retry behavior.
3. Verify actual rendering, source fidelity, hostile content, unknown languages, large records and navigation in tests and browser; run repository checks. Commit, sync, merge and retire only this completed worktree/branch.

Allowed scope: `sociotechnic/ui/web/src/components/records.tsx`, new `record-content.tsx`, `record-format.ts`, `records.css`, frontend package/lockfile, `sociotechnic/ui/web/tests/render-record.tsx`, `sociotechnic/tests/record-content.test.ts`, and the documentation listed below.

docsImpact: update `CONTRACTS.md` console reading contract, README user guidance, DESIGN.md reader ownership/behavior and development feature-to-code map. No CLI/API or engine/state reference changes: existing record reads, source, validation, gates and persistence are unchanged. This work does not change the legacy reader.

Checks: `task checks`; strict premium audit; component rendering through Vite SSR and node:test; isolated browser fixture for Markdown/JSON/diffs, raw toggle, loading/error/retry, empty/unknown/large content, keyboard and narrow/light/dark layouts.

## Verification

- `task checks`: engine/UI typecheck, production build, agent validation, 196 passing tests (2 optional PostgreSQL tests skipped), production dependency audit with no known vulnerabilities.
- Six rendering regressions exercise real React output through Vite SSR: Markdown/GFM, language labels/detection/fallback, JSON/diffs, raw source and large numeric literals, inert HTML and safe links, empty/large inputs.
- Isolated Chrome fixture exercised the actual Records dialog: selection, formatting/raw toggle, exact source, read failure/retry, empty/unknown/large records, no automatic image requests, Escape/focus restoration, light/dark/reduced-motion and 390px layout. The 374px dialog stayed within the viewport; the reader had no horizontal overflow and a long code block scrolled internally.
- Strict premium audit reports the same five existing `affordance.actionless-button` findings as the committed base, with no new findings. Each is a Radix `asChild` trigger/close control; behavior is supplied by Radix. Browser verification confirms Records closes and restores focus. These are static-detector false positives, not unconnected controls.
- Impeccable detector's neutral blockquote border warning was resolved by using a one-pixel quotation rule. The official `designmd` CLI is unavailable; existing theme tokens and mappings were checked against source and browser. The context tool misidentified the nested package as the repository root; the actual root PRODUCT.md, DESIGN.md and referenced App.tsx exist and were read directly.
- No formatter/linter task is configured. `git diff --check` verifies patch whitespace. CLI/API, legacy console, engine/state and existing agent work remain outside this change.
