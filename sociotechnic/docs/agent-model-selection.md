# Agent model selection

Add agent and Manage versions share model choices and provider-aware settings.
Planning, research, review, conformance and approval templates can use Claude or
OpenAI models through the existing isolated Codex reader runner. Ordinary build
templates now also support Codex through the shared worktree tools added with
the [infrastructure expert](infrastructure-agent.md). Design and Agent-worker
templates retain Claude. The [Azure SME](azure-sme.md) uses the same settings and
execution model; it adds no parallel runner. The dated implementation and
verification below describe the earlier reader-model selection change.

## Model-specific effort selection, October 24, 2026

Add agent and Manage versions use the same native Effort select and capability
map in `src/agent-models.ts`. The map covers every listed model and is shared with
version validation. Claude choices are low, medium, high, xhigh and max. OpenAI
choices add ultra, except GPT-6 Luna and GPT-5.6 Luna, which stop at max. Unknown
models and unsupported effort pairs are rejected. Model switching retains a
supported effort, otherwise uses high. Codex still restores its fixed tool list.

Sources checked on October 24: [Claude effort and alias resolution](https://code.claude.com/docs/en/model-config#adjust-effort-level),
[OpenAI models](https://learn.chatgpt.com/docs/models), the installed Claude Agent
SDK 0.3.310 effort types, and the installed Codex model catalog. Claude aliases
follow the current direct Anthropic models; provider overrides, older SDKs and
organization limits may constrain actual access. The capability table should be
reviewed when models or SDK versions change. No discovery call or inference is
needed to open the editor.

The selected effort is stored in the immutable semantic release, copied into new
run pins, and forwarded to Claude session/agent options or Codex's
`model_reasoning_effort`. Existing releases, legacy choices and running jobs keep
their saved values. Selecting ultra does not enable child agents in the bounded
Codex adapter or change its tools, sandbox, deadlines or human gates.

Implementation stages: update the release contract; extend the shared model
capabilities, version validation and adapters; update the shared editor; verify
accepted/rejected pairs, publication and pinning, both transports and both forms.
Allowed scope: the model/role/version-data modules, the shared settings component,
the existing provider runners, focused model/version/Codex tests and fake CLI,
the documents listed below and demo screenshots under `docs/evidence/`. No runtime catalog or release seed edits.

`docsImpact`: update `CONTRACTS.md`, the driver contract, CLI/API and engine/state
references, this guide, the Codex integration guide and development feature map.
The existing shared native control, layout and tokens are retained, so there is
no design-system change. Root README guidance remains accurate and needs no
command or implementation detail added.

### Effort verification

`task checks` passed engine/web type checks, the production build, bundled agent
validation, 259 tests and the production dependency audit; 31 opt-in tests were
skipped. The model tests accept every supported pair and reject invalid effort
values. Publication tests preserve latest, legacy and already-pinned settings.
Claude option tests inspect both session and programmatic agent effort. The fake
Codex executable checks the actual CLI effort argument across all model ranges;
these are transport tests, not live inference or account-entitlement checks.

Isolated Chrome with a disposable in-memory catalog verified all 12 model ranges,
supported-value retention, ultra fallback for Luna and Claude, keyboard focus and
Tab navigation, two version publications, copied legacy settings, immutable pins,
and Add agent creation. A rejected duplicate-instructions submission retained the
effort through correction and successful creation. Desktop dark and 390px light
layouts were checked; the narrow dialog stayed within the viewport. Native popup
keyboard selection could not be established reliably through headless Chrome.
Screenshots show the [desktop form](evidence/agent-effort-desktop.png) and
[narrow form](evidence/agent-effort-mobile.png) using disposable demo data.

The changed-component detector found no issues. The premium strict static audit
reported four existing actionless-button findings on Radix trigger wrappers;
Manage versions and Add agent were exercised directly. This is not a clean
static-audit result. No real catalog releases or active runs were changed.

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
