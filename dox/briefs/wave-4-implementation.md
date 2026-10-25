# Wave 4 implementation decisions

Base: PR #28 merged as 11d1a1b; branch codex/console-history.

The contract addition in sociotechnic/CONTRACTS.md owns query, coverage, navigation, browser defaults and restore-only semantics. History reuses bounded database reads and agent-library projections. Defaults belong to this browser at creation and the database-pinned run afterward. No schema migration is needed.

Stages: projection/API and interrupted evidence; History and scoped Agents with shared drawers; Settings and restore-only; retained-surface cohesion and database/browser verification.

Allowed scope/docsImpact follow wave-4-history-agents-settings.md: contracts, README, CLI/API reference, engine reference, development map, redesign plan, handoff and CHANGELOG. Final DESIGN.md, console-ui.md, screenshots and minor release remain wave 5.

The owner additionally authorized including their README edits and nine image files (st4/st5 replacements and fog1/fog2/fog4–fog8). These are supplied assets, separate from the final wave 5 screenshot refresh. The requested future design-chat upgrade is captured in [its brief](design-chat.md), with the supplied source retained verbatim.
