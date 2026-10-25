# Azure subject matter expert

Add optional Azure specialist identities at v1.0.0 using gpt-6.1-sol/high.
Reuse the infrastructure expert's role templates, skill snapshots, bounded Codex
readers, workspace builder and scoped commit tool. Do not add a parallel runner,
change defaults or alter existing run assignments.

## Stages and scope

1. Package an Azure routing skill with seven complete Microsoft skill directories
   pinned to f3b512517ed86feceebfee480a46c971f6c6aff4 and its MIT license.
   Preserve text templates/scripts as inert references; expand the existing
   snapshot validator's safe-path and size bounds without enabling execution.
   Files: `skills/azure-sme/**`, `src/agent-skills.ts`, `tests/agent-skills.test.ts`,
   `tests/azure-sme.test.ts` and `CONTRACTS.md`.
2. Publish planner, advisor/researcher, builder and EASY builder identities through
   the existing catalog API, all v1.0.0/Sol/high. Instructions retain each role's
   record contract and distinguish examining, planning, handoff and authorized
   remediation. Export the complete immutable catalog and check coverage.
   Files: a new `seeds/agent-releases/20261024-azure.json` bundle and
   `docs/azure-sme.md`.
3. Verify packaged bytes, unsafe paths, materialization permissions, catalog
   import/pinning, live bounded local remediation, library visibility and run
   choices. Run `task checks`, `task test:pg`, catalog export/check and diff review.
   Files: focused tests, `docs/evidence/azure-sme-smoke.json` and this plan.
4. Commit and publish this branch, merge after verification, synchronize main and
   remove the completed feature branch. Preserve other active worktrees.

`docsImpact`: update the behavioral contract's packaged-skill limits, README's
library usage, CLI/API and engine references, development feature map and the
new Azure guide. Shared runtime/provider behavior already merged with the
infrastructure expert is reused. No new route, record kind, UI control, layout,
token or visual behavior: DESIGN.md, PRODUCT.md and UI source need no edits.
CLAUDE.md remains the short navigation entry point; its existing catalog guidance
still applies. No Docker sandbox branch changes are included.

## Acceptance and risks

- Four optional identities appear in the database library with v1.0.0,
  gpt-6.1-sol/high and the same immutable Azure skill snapshot.
- The planner and advisor remain readers; builders can inspect, edit, test and
  commit in assigned worktrees. EASY fixes do not require a COMPLEX tier.
- Another builder can execute the Azure planner's plan. Research is requested
  through the existing bounded research loop; no automatic specialist routing
  or human-gate bypass is claimed.
- Pinned text resources survive export/import and cannot traverse paths, become
  executable on materialization, or automatically register hooks/MCP servers.
- Live verification uses disposable local files only. It does not prove Azure
  tenant access, deployment, infrastructure apply or production remediation.
- Source skills contain conditional approval/workflow rules and host-specific
  tool names. The wrapper adapts these to actual role tools and existing gates.

## Verified outcome, October 24, 2026

- Reused the runtime and snapshot mechanism merged in infrastructure PR #6.
  Azure added no runner, route, record kind or UI source change.
- Published all four v1.0.0/Sol/high profiles and exported a complete 22-release
  catalog. `db catalog-check` reports no missing or absent releases. Earlier
  committed releases and existing run settings remained unchanged.
- The seven upstream directories contain 347 files. Independent comparison with
  the pinned source checkout passed for every byte; the snapshot SHA-256 manifest
  and materialization checks also passed, including script/template permissions.
- Official skill validation passed. PyYAML was installed only under a temporary
  directory because neither available Python runtime included it; no repository
  dependency or global skill installation was added.
- `task checks` passed engine/web type checks, build, 14 baseline agent checks,
  227 tests (30 optional PostgreSQL tests skipped) and the production dependency
  audit with no known vulnerabilities. `task test:pg` passed all 257 tests with
  zero skipped, including the exported Azure catalog round trip. An earlier
  sandbox-only run was blocked by local socket restrictions; the complete run
  with local test access passed.
- A real gpt-6.1-sol/high EASY executor read the pinned compliance guidance and
  a reference, changed only allowBlobPublicAccess in a disposable local template,
  ran Node checks and committed exactly that file through the shared commit tool.
  Independent checks confirmed property-only changes, an unchanged base branch,
  clean worktree and passing diff validation. The record parsed READY at the
  observed HEAD. [Smoke evidence](evidence/azure-sme-smoke.json) retains the result
  and CLI-reported usage (44.1 seconds, 17 calls, 172691 tokens including cache).
- Browser verification showed all four profiles, Sol/high/v1.0.0, azure-sme skill,
  reader versus executor tools, and each eligible choice under New run. Closed
  that dialog without starting a job. The idle console was restarted from the
  current checkout so its parser supports the larger Azure resource snapshots.

Limits: no Azure tenant access, login, cloud scan, apply, deployment or production
remediation was tested. Azure CLI is present; azd was absent. Context7 was not
configured for the live smoke. The test did not need Azure CLI. Azure/Foundry MCP
servers are not registered. Planner/advisor contracts and selection were tested
deterministically; live model verification exercised the EASY executor.

## Identity and onboarding follow-up

The user clarified that the SME should be prepared for OAuth, IAM, certificates,
credentials and permission questions, while performing no authentication now.
Added the complete pinned Entra app-registration skill and a focused local
identity/session reference. The current package contains eight upstream workflows
and 364 upstream files. Initial immutable 1.0.0 releases retain the original seven
workflows; all four profiles publish 1.0.1 with the additional guidance.

Allowed scope expands to `.gitignore` and `.gitattributes`, the new identity
reference, eight imported skill directories, the provenance/hash manifest,
`seeds/agent-releases/20261024-azure-onboarding.json`, relevant tests and docs.
`docsImpact` additionally includes codex-integration.md's now-stale Markdown-only
wording. The import keeps upstream whitespace intact; the narrow Git attribute
exempts only those imported bytes from whitespace lint. Ignore exceptions preserve
12 upstream recipe documents under directories named source. All staged resource
bytes must match the manifest, including those exceptions.

This is readiness only: no tenant connection, login, consent, app registration,
credential creation, permission grant or cloud access is authorized or performed.

Follow-up verification: official skill validation and final `task checks` passed
again (227 passing, 30 optional PostgreSQL cases skipped). The targeted PostgreSQL
and Azure catalog tests then passed all five cases with zero skipped, including
both 1.0.0 and 1.0.1 snapshots and the full 26-release export. All 364 imported
files were independently hashed from the Git index, not just the working tree.
`git diff --cached --check` passed with the narrow upstream whitespace attribute.
The model-selection overview's stale reader-only claim was repaired as part of
the documentation review; its dated verification remains historical evidence.

A second live Sol/high check exercised the v1.0.1 advisor on an informational
React SPA / future CI identity question. It read five local resources, returned
a valid DONE record, explained public-client PKCE, API consent versus RBAC,
workload identity and certificate handling, and required no tenant selection or
login to answer. The [advisor evidence](evidence/azure-advisor-smoke.json) records
29.95 seconds and 112180 CLI-reported tokens including cache. Its reader adapter
provided no shell or Azure tools. No authentication or cloud access occurred.

## Concurrent Docker integration

PR #7 merged while the Azure PR was being prepared. Synchronized origin/main and
preserved both Docker sandbox ignores and Azure imported-source exceptions.
Added a direct worker-transport check for all four Azure identities, including
their complete skill snapshots and definitions. No Azure-specific sandbox
runtime was added and no Azure/Docker live execution is claimed by that test.
The synchronized gate passed engine/web type checks, build, baseline agents,
244 non-PostgreSQL tests (30 optional cases skipped) and the dependency audit.
The full PostgreSQL run passed all 274 tests with zero skipped. The added Azure
transport assertions also passed independently, and type checks passed again.

## Consolidate Azure Builder across tiers

The separate Azure Builder Lite uses the same model, effort, skills, tools and
output contract. Keep EASY's scope and smaller execution budget as a tier
profile of Azure Builder instead of maintaining a second specialist identity.
Default Claude builders, BULK/COMMENTS, human gates and historical pins retain
their existing behavior.

Stages and allowed file scope:

1. Extend immutable releases with explicit ordinary-builder budget profiles and
   superseded custom identities. Derive and verify configurations by assigned
   slot, and include the actual tier in build briefs. Scope: `src/agent-version-data.ts`,
   `src/agent-catalog.ts`, `src/agent-versions.ts`, `src/agent-roster.ts`,
   `src/agent-library.ts`, `src/brief.ts`, `src/engine.ts`.
2. Publish Azure Builder 1.1.0 with both tiers and the unchanged Azure skill
   snapshot. Preserve every prior release in a complete catalog export at
   `seeds/agent-releases/20261024-azure-builder-tiers.json`. Reuse the existing
   New run selectors and Add agent peer review, offering only compatible
   versions and active identities. Scope: `ui/web/src/components/version-overrides.tsx`
   and `ui/web/src/components/add-agent.tsx`; no new UI primitives or visual tokens.
3. Verify EASY/COMPLEX dispatches, budget and tier tampering, publication,
   restoration, legacy selection and HTTP choices, using disposable Git repos
   and PostgreSQL databases. Scope: `tests/builder-profiles.test.ts`,
   `tests/azure-sme.test.ts`, `tests/agent-discovery.test.ts`,
   `tests/agent-library.test.ts` and the documentation below.

`docsImpact.required: true`. Allowed documentation scope is root `README.md`,
`DESIGN.md`, `sociotechnic/CONTRACTS.md`, and `docs/azure-sme.md`,
`docs/azure-sme-plan.md`, `docs/cli-reference.md`, `docs/engine-reference.md`,
`docs/development.md`. Update the behavior contract, profile selection examples,
release versions, selector behavior and feature-to-code map together. Product
scope is unchanged; the existing controls and native select ownership remain.

Acceptance: one Azure Builder appears for both ordinary build slots; EASY uses
160 calls / 40 minutes and COMPLEX uses 250 / 60. Only 1.1.0 and later compatible
releases appear in the EASY selector. Old Azure/Lite releases, frozen rosters,
dispatches and explicit legacy assignments remain valid. Retired identities
with deployments remain available in library history. No tenant access, model
execution or cloud changes are needed to verify this consolidation.

Verification: `task checks` passed (257 tests, 31 optional database skips), then
`task test:pg` passed all 288 tests with zero skips. The dependency audit found
no known vulnerabilities. Catalog coverage matched all 27 releases; all 26
previous release rows and the Azure skill snapshot were independently compared
unchanged. An isolated Chrome session verified both selectors, incompatible
legacy-version exclusion, independent overrides, native popup/keyboard behavior,
390px layout, library search, Add agent peer review, and loading/error recovery.
The strict UI static audit reported four existing wrapper-driven controls as
actionless; their handlers belong to Radix Dialog/Tooltip primitives, not literal
button `onClick` props. No unrelated control changes were made for those heuristic
findings. The live console was gracefully reloaded after verifying zero active
drivers; its API then confirmed three Azure identities, the combined 1.1.0
builder, both preserved Lite versions and all nine existing runs.
