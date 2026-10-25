# Azure SME

The resident Azure specialist has four optional library profiles, each starting
at **1.0.0** on **gpt-6.1-sol / high**, with the same `azure-sme` skill snapshot.
The latest **1.0.1** release adds optional identity and session guidance; initial
1.0.0 releases remain available unchanged. This follows the [infrastructure expert](infrastructure-agent.md) pattern: each
identity retains one role's permissions and output record.

| Identity | Role slot | Use | Limit |
| --- | --- | --- | --- |
| `sociotechnic-azure-planner` | planner | Architecture, investigation and an executable plan for any builder | 120 calls / 35 minutes |
| `sociotechnic-azure-advisor` | researcher | Bounded research, escalation analysis and recommendations | 80 calls / 25 minutes |
| `sociotechnic-azure-builder` | builder | Execute an approved COMPLEX plan, investigate or remediate | 250 calls / 60 minutes |
| `sociotechnic-azure-builder-lite` | builder-lite | Handle a scoped EASY investigation or fix directly | 160 calls / 40 minutes |

Open **Agent library**, search `azure`, and inspect each profile's instructions,
model, tools, skills and versions. In **New run → Agents and versions**, select
the profile for its matching role. Select both builder profiles when the SME
should execute either COMPLEX or EASY work. Keep the tier honest; BULK and
COMMENTS retain their separate builders. Other builders can execute plans from
the Azure planner without using the Azure executor.

The planner can request research through the existing bounded research loop;
assign azure-advisor to the researcher slot for Azure-specific questions. This is
an escalation resource within that loop, not automatic specialist routing or an
ad hoc chat endpoint. A specialist cannot change frozen assignments or promote
a reader dispatch into a build. Small fixes still follow the approved plan and
existing checks, reviews and human decisions.

The corresponding API maps, alongside the ordinary New run request fields, are:

```json
{
  "agentAssignments": {
    "sociotechnic-planner": "sociotechnic-azure-planner",
    "sociotechnic-researcher": "sociotechnic-azure-advisor",
    "sociotechnic-builder": "sociotechnic-azure-builder",
    "sociotechnic-builder-lite": "sociotechnic-azure-builder-lite"
  },
  "agentVersions": {
    "sociotechnic-planner": "1.0.1",
    "sociotechnic-researcher": "1.0.1",
    "sociotechnic-builder": "1.0.1",
    "sociotechnic-builder-lite": "1.0.1"
  }
}
```

Profiles are available without changing default assignments or existing runs.
`db init` imports the committed catalog on another installation. Publish a higher
semantic version to revise instructions, model, budgets or skill contents; old
releases and run snapshots remain immutable. Export/check the catalog afterward.

## Skills and tools

The [local entrypoint](../skills/azure-sme/SKILL.md) routes to eight complete
Microsoft workflows: enterprise infrastructure planning, preparation, validation,
deployment, diagnostics, compliance, resource lookup and Entra app registration. Their 364 source files,
including reference scripts/templates, are copied verbatim from
[microsoft/azure-skills](https://github.com/microsoft/azure-skills) revision
`f3b512517ed86feceebfee480a46c971f6c6aff4`. The MIT license, provenance and a SHA-256
manifest accompany them. This is a focused package; other upstream skills are
outside it and current Microsoft documentation remains necessary for changing
service facts. Upstream README paths were stale at this revision; the actual
skills are under `skills/`, not the README's `.github/plugins/` paths.

The wrapper is loaded with the prompt; Microsoft workflows and references are
read on demand. Full UTF-8 bytes travel inside immutable catalog releases, run
pins and backups. Snapshot paths, count and byte limits are validated, and files
materialize read-only without executable bits. Merely packaging a helper script
does not run it or give a reader permission to execute it.

Planners/advisors have bounded reference readers, live web search and Context7
when configured. Builders additionally use the shared Codex shell/edit tools
under workspace-write and its branch/HEAD-bound `commit_changes` tool. The
builder can inspect Azure through CLI commands when the actual task authorizes
that access. See the [shared execution boundaries](infrastructure-agent.md#tools-and-boundaries).

Azure CLI is installed on the current host; availability and tenant permissions
must be checked at execution time. Azure Developer CLI was absent during setup.
Use `azd` only for appropriate workflows when installed/authenticated. No login,
subscription switch, credential grant or tool installation is part of adding the
agent. Follow the upstream plan → validation → deployment workflow for azd;
do not claim a reader created deployment files or ran validation.

The Microsoft plugin also advertises Azure MCP. Its servers, hooks and plugin
manifests are not installed or registered by this package; the isolated runner
does not inherit global plugins. Do not claim Azure/Foundry MCP tools exist.
For a future structured MCP integration, explicitly configure and version it;
the actual [Microsoft server documentation](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/tools/)
describes credentials and read-only mode. Current execution uses Azure CLI,
ordinary repository tools, and the shared web/documentation tools.

Installing the SME authorizes no cloud change. Confirm target cloud, tenant,
subscription, region and environment from the task's evidence. Preserve existing
authorization without repeated prompts, and surface missing decisions through
the existing BLOCKED/research/plan records. Never log secrets or confuse local
configuration validation with a successful Azure deployment.

## Identity readiness without connecting now

The [identity/session reference](../skills/azure-sme/references/identity-and-session.md)
prepares the SME to guide a future authorized session or remain informational.
It distinguishes human login from workload identity, OAuth flows and MSAL, API
consent from Azure RBAC and directory roles, and public certificate registration
from private-key handling. It covers least-privilege scoping, credential storage,
rotation and expiry, redacted error diagnosis, and user/administrator handoffs.
Advice requires no Azure account. No login, credentials, permissions, app
registration, tenant connection or cloud operation was performed during setup.

## Verification

The implementation and verification record is in [the plan](azure-sme-plan.md).
Focused tests inspect all imported bytes, materialized permissions and bounds,
then restore and select all profiles through the actual catalog machinery.
Live verification uses a disposable linked worktree and local files only. No
Azure tenant access, resource mutation, deployment or production remediation is
established by the setup checks.
