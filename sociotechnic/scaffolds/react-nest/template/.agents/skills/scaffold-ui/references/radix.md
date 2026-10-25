# Radix in this scaffold

Use installed shadcn wrappers first. For a missing interaction, the installed
`radix-ui` package exposes namespaces such as `Dialog`, `DropdownMenu`, `Select`
and `Tooltip`. Check the primitive's primary API before composing it.

- Preserve the primitive's keyboard and focus behavior. Use `asChild` when a
  custom trigger supplies the actual interactive element; avoid nested buttons.
  The child must pass through received props and refs. Keep an accessible
  element and name; changing the element does not create those automatically.
  [Composition](https://www.radix-ui.com/primitives/docs/guides/composition).
- A modal needs its documented root, trigger, portal/overlay, content, title and
  close behavior; provide a meaningful description when appropriate. Verify Tab,
  Escape and focus return in the product. Use one controlled or uncontrolled
  state model consistently. [Dialog API](https://www.radix-ui.com/primitives/docs/components/dialog).
- Menus/selects/tabs have different selection semantics. Preserve documented
  grouping, labels, disabled states and keyboard navigation rather than treating
  every option list as a menu. [Select](https://www.radix-ui.com/primitives/docs/components/select),
  [Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu),
  [Tabs](https://www.radix-ui.com/primitives/docs/components/tabs).
- Theme through this project's semantic tokens and wrappers. Radix Primitives
  are unstyled; Radix Themes is a separate styled system and is not installed.
  [Styling](https://www.radix-ui.com/primitives/docs/guides/styling).
- Radix follows WAI-ARIA patterns, but content, contrast, composition and custom
  triggers remain application responsibilities. Browser verification is required.
  [Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility).

Reviewed against primary documentation on 2026-10-24. Local package versions and
generated source remain authoritative; recheck the primary API for new behavior.
