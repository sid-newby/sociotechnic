# Agent model selection

Add agent and Manage versions share model choices and provider-aware settings.
Planning, research, review, conformance and approval templates can use Claude or
OpenAI models through the existing isolated Codex reader runner. Ordinary build
templates now also support Codex through the shared worktree tools added with
the [infrastructure expert](infrastructure-agent.md). Design and Agent-worker
templates retain Claude. The [Azure SME](azure-sme.md) uses the same settings and
execution model; it adds no parallel runner. The dated implementation and
verification below describe the earlier reader-model selection change.

## Implementation plan

1. Update the behavioral contract, then centralize supported model IDs and role
   eligibility. Validate provider changes against the template's permissions and
   retain existing immutable releases and dispatch snapshots.
2. Extend existing Codex routing to eligible reader templates, including custom
   identities. Enable network tools only when present in the pinned tool list.
3. Reuse AgentSettings in both forms, group models by provider, and update effort,
   tool and budget presentation when the selected model changes.
4. Verify catalog creation, publication, pinning, restore, provider routing,
   rejected permissions, and both running forms. Run the repository checks.

Allowed files: `src/{agent-models,agent-version-data,roles}.ts`,
`ui/{runner,codex-runner}.ts`, `ui/web/src/components/{agent-settings,add-agent,
agent-versions}.tsx`, focused tests, and the documentation listed below.

`docsImpact`: update `CONTRACTS.md`, `AGENTS.md`, the CLI/API reference,
engine/state reference, development feature map, Codex integration guide and the
root README's agent-library guidance. No visual tokens or layout change, so
`DESIGN.md` needs no update. Existing runtime records and catalog releases are
outside this change. Listed models are supported configuration choices, not a
claim of account entitlement or completed live inference.

## Verification, October 24, 2026

`task checks` passed engine/web type checks, the production build, baseline agent
validation, 190 tests, and the production dependency audit. Two optional PostgreSQL
tests were skipped. Catalog tests use the real in-memory store and verify creation,
provider changes in both directions, immutable releases and frozen run settings.
The subprocess tests route all seven OpenAI IDs and each compatible template
through the fake Codex executable and real bounded MCP server; they also reject
permission expansion. These tests do not establish live inference or model access.

Chrome verification used a disposable in-memory catalog: published a planner
release with GPT-6 Astra and created a custom planner with GPT-6 Luna. Both review
steps named the selected model and tool-call limit, and the resulting profiles
showed Codex settings. Builder version editing explained the Claude requirement.
The narrow-viewport version dialog remained within the page without horizontal
overflow. The mechanical UI detector reported no findings.

The broader premium static audit still reports nine missing native-select
ownership declarations and five actionless-button findings on existing Radix
trigger wrappers. The changed workflows were exercised directly; this audit is
not a clean result and does not supersede browser verification. Impeccable also
reported a stale surface-brief target reference; no design-context repair was
included in this model-selection change.

The idle console was restarted with its owning CLI. Both the API on 4747 and
the existing development proxy on 5173 then returned all seven OpenAI choices.
The existing editor tab showed both provider groups. Real catalog releases and
run assignments were not changed; browser publications used only the disposable
catalog.
