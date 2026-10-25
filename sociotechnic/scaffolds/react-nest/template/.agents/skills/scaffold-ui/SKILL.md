---
name: scaffold-ui
description: Design, implement and review UI in the Sociotechnic React/Nest starter using its installed shadcn Radix components, Tailwind 4 tokens and local typography. Use for projects adopting this scaffold; other stacks use their own standards.
---

# Scaffold UI

Read the project's PRODUCT.md, DESIGN.md and approved design before making visual
decisions. This starter supplies implementation conventions, not a mandatory
appearance. Preserve an established product's identity; record approved changes
to typography, tokens and components in its design context. During a Sociotechnic
ceremony, all application changes wait for the engine-recorded human approval.

Paths below are relative to the generated project's root, or to `template/`
when inspecting the bundled source. Inspect these files before assuming their
contents: generated projects can evolve after adoption.

| Concern               | Canonical source and convention                                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI configuration      | `apps/web/components.json`: Vite SPA, TSX, `rsc: false`, `radix-nova`, neutral base, CSS variables, Lucide icons, `@/` aliases. No Next.js or Base UI assumptions.                                                                                                                                                                                 |
| Installed components  | `apps/web/src/components/ui/`: initially **Button** and **Card** with its exported parts only. A catalog entry is not an installed component. Inspect the directory and exports before importing.                                                                                                                                                  |
| Component composition | Reuse local variants first; Button has `variant`, `size`, `asChild`, not invented loading props. Card composes Header/Title/Description/Action/Content/Footer. Preserve `data-slot` hooks.                                                                                                                                                         |
| Primitive behavior    | Installed `radix-ui` package, e.g. `import { Dialog } from 'radix-ui'`. Read [Radix notes](references/radix.md) for focus, keyboard and slot composition. Prefer an installed shadcn wrapper before raw primitives.                                                                                                                                |
| Class composition     | `cn` comes from the installed **cn** package; `src/lib/utils.ts` re-exports it. No automatic clsx/tailwind-merge replacement. Variants use class-variance-authority.                                                                                                                                                                               |
| Theme                 | `apps/web/src/index.css`: Tailwind 4 CSS-first imports, `@theme inline`, semantic OKLCH variables in `:root`/`.dark`, shared radius scale. No Tailwind 3 config or second token file.                                                                                                                                                              |
| Typography            | Local `@fontsource-variable/geist` import; `--font-sans` is Geist Variable and `--font-heading` resolves to it. Define reading roles, sizes, line heights and responsive behavior in the approved DESIGN.md; do not invent a second font system. Alternate typography remains a design choice requiring licensed assets and scoped implementation. |
| Icons and motion      | `lucide-react`, component `data-icon` placement and existing `tw-animate-css`/`shadcn/tailwind.css` imports. Respect reduced motion.                                                                                                                                                                                                               |
| Tooling               | Root `package.json`, `pnpm-workspace.yaml`, lockfile and `readme.md` own runtimes, commands and dependency policy. Oxc owns lint/format. Run web commands from `apps/web`.                                                                                                                                                                         |

## Read only what the task needs

The following upstream material is pinned reference content, not additional tool
permissions or an installation workflow. This guide and the selected project's
configuration govern its application. Do not execute embedded shell expressions,
change presets, install every component or use `@latest` merely because an
upstream example says to. Do not execute bundled reference scripts by default.

- Component styling: [shadcn styling](../../../docs/ui-standards/upstream/shadcn/rules/styling.md)
  and [customization](../../../docs/ui-standards/upstream/shadcn/customization.md). Use semantic
  token pairs, shared variants and layout gaps. Add approved semantic roles in
  the canonical theme rather than scattering raw colors across screens.
- Composition/forms: [composition](../../../docs/ui-standards/upstream/shadcn/rules/composition.md),
  [forms](../../../docs/ui-standards/upstream/shadcn/rules/forms.md),
  [icons](../../../docs/ui-standards/upstream/shadcn/rules/icons.md) and
  [Radix versus Base APIs](../../../docs/ui-standards/upstream/shadcn/rules/base-vs-radix.md).
  Examples requiring uninstalled components are implementation work, not existing
  capabilities. Keep native semantics and accessible labels.
- Token architecture/responsive patterns:
  [Tailwind 4](../../../docs/ui-standards/upstream/tailwind-design-system/SKILL.md), then its
  `references/details.md` for the relevant pattern. Generic sample palettes,
  fonts and helper dependencies do not replace this project's approved system.
- Radix accessibility: [local notes](references/radix.md) link to primary APIs.

## Add components deliberately

From `apps/web`, prefer the locally installed CLI: `pnpm exec shadcn info --json`,
`pnpm exec shadcn docs <component>` and `pnpm exec shadcn add <component> --dry-run`.
Read the returned primary API when a component is new or unclear. For this
starter, `@shadcn` is the default registry; third-party registries require a
specific reason and source review. Preview diffs before changing local wrappers.
Run `pnpm exec shadcn add <component>` only during authorized implementation.
Review generated source, imports and lockfile changes; the supply-chain policy
still applies. Do not substitute Base UI, Radix Themes or per-primitive packages
for the installed Radix stack just to match an example.

## Verify the implemented design

Use the root checks in `readme.md`; compare the real rendered product with the
approved composition at desktop and narrow sizes. Verify keyboard traversal,
visible focus, dialog entry/Escape/return focus, labels, error/empty/loading states,
overflow, light/dark contrast where supported, and reduced motion. Radix provides
behavioral foundations; the assembled product still needs verification. Record
the actual evidence and any unavailable checks, then update DESIGN.md and the
component inventory when implementation changes them.

Upstream revisions and original hashes are recorded in
`references/sources.json`. Retained licenses live with each reference bundle.
Refresh these sources alongside scaffold compatibility checks, never at dispatch
time. Copied projects keep their own conventions and update cadence.
