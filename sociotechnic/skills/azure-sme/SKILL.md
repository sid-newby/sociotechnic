---
name: azure-sme
description: Examine Azure architecture and incidents, plan verifiable changes, or implement authorized Azure fixes using pinned Microsoft workflows. Use for Azure platform, identity, infrastructure, deployment and operational work.
metadata:
  version: "1.0.1"
---

# Azure SME

Work from the question and evidence. Choose examination, diagnosis, a plan for
another builder, or a small direct fix according to the assigned role and scope.
Do not turn every Azure question into a deployment project. A reader returns
findings or a plan; a builder can remediate within the approved scope. Preserve
the role's required output record, tier rubric and human gates.

Read the matching Microsoft skill and its relevant references. Relative links in
each upstream document resolve from that document's directory. These eight
complete directories are pinned to the revision in [UPSTREAM.md](UPSTREAM.md).

| Work | Read |
| --- | --- |
| Informational advice, optional first-session setup, OAuth, IAM, certificates and credentials | [Identity and session readiness](references/identity-and-session.md), then [Entra app registration](upstream/entra-app-registration/SKILL.md) when relevant |
| Architecture, enterprise requirements and implementation handoff | [Enterprise infrastructure planner](upstream/azure-enterprise-infra-planner/SKILL.md) |
| Locate resources and inspect the intended target | [Resource lookup](upstream/azure-resource-lookup/SKILL.md) |
| Incident diagnosis, logs and evidence for remediation | [Diagnostics](upstream/azure-diagnostics/SKILL.md) |
| Security posture, policy and compliance assessment | [Compliance](upstream/azure-compliance/SKILL.md) |
| Prepare an azd project, when requested or azure.yaml already exists | [Prepare](upstream/azure-prepare/SKILL.md) |
| Validate prepared deployment inputs | [Validate](upstream/azure-validate/SKILL.md) |
| Execute an authorized, prepared and validated deployment | [Deploy](upstream/azure-deploy/SKILL.md) |

Use current Microsoft Learn documentation for service areas outside this bundle,
regional availability, prices, API versions, quotas and changing tool behavior.
Do not fetch or install the whole plugin merely to answer a focused question.

Informational use needs no Azure account or authentication. Prepare identity or
session setup only when the actual task requires it. The user has explicitly
requested readiness, not authentication now: do not log in, connect a tenant,
create credentials or grant permissions as part of installing or checking this
agent. Future execution can use those workflows when explicitly authorized.

## Adapt workflows to the actual assignment

- Before proposing a change, identify the tenant, subscription, cloud, region,
  resource group and environment from available evidence. Ask only for missing
  context that affects the action. Avoid changing global CLI defaults; prefer
  explicit subscription/resource arguments.
- Readers use bounded file reads, web search and Context7 when configured. They
  cannot run Azure CLI, write `.azure/deployment-plan.md`, execute scripts or
  remediate. Draft required deployment-plan content inside the assigned record
  and identify its creation as a builder step. Do not claim it exists or that
  validation ran. A useful handoff names exact files, commands, acceptance,
  rollback and any missing authorization.
- Builders inspect repository instructions and existing IaC before editing.
  Prefer a narrow repair when evidence supports it; otherwise return a scoped
  plan or BLOCKED record with the missing decision. Run available local checks,
  inspect the actual diff and use the scoped commit tool with explicit files.
  A builder may execute an existing approved plan; a research assignment cannot
  promote itself into a build.
- For azd preparation/deployment, preserve the upstream plan, validation-proof
  and deployment checks. Existing approval covers its stated scope; do not ask
  for it again. Missing scope, destructive actions, production provisioning or
  expanded permissions require the corresponding human decision. Return a
  precise blocker through the role record if no interactive question tool exists.
- Upstream tool names are recommendations, not installed capabilities. Use the
  tools actually supplied. Azure CLI is available only to shell-enabled builders;
  check `az version`, relevant help and authentication without printing tokens
  or secrets. Use `azd` only if available and appropriate. Do not silently install
  tools, start interactive login, register MCP servers or run downloaded scripts.
- Reference scripts/templates are inert source material. Read a script before
  explicitly invoking it through an authorized shell; plan and advisor roles
  cannot execute them. Installation itself grants no Azure permissions.
- Keep credentials, connection strings and tenant data out of commits and
  records. Report observed results, unresolved risks and checks that could not
  run. Never equate local IaC validation with a successful cloud deployment.
