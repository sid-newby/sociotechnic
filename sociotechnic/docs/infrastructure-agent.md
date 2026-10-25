# Infrastructure expert

The library has two optional identities for one domain specialty. Both start at
**1.0.0**, use **gpt-6.1-sol** through Codex with **high** effort, and carry the
same Terraform and container instruction skills. They are separate identities
because Sociotechnic fixes each identity to one role and record contract.

| Identity | Template | Responsibility | Budget |
| --- | --- | --- | --- |
| `sociotechnic-infrastructure-planner` | `sociotechnic-planner` | Research existing infrastructure, draft Terraform/Docker configuration and produce an executable, verifiable plan | 120 tool calls, 35 minutes |
| `sociotechnic-infrastructure-builder` | `sociotechnic-builder` | Implement approved infrastructure plans, run available checks and commit evidence | 250 tool calls, 60 minutes |

## Use in the console

Open **Agent library** and search for `infrastructure` to inspect the instructions,
model, tools, skills and releases. In **New run → Agents and versions**, select
infrastructure-planner for the planner role, infrastructure-builder for the
builder role, or both. New runs pin the chosen identities and releases. Creation
and installation do not change existing runs or the default assignments.

The infrastructure builder fills the COMPLEX builder slot. EASY, BULK and
COMMENTS use their corresponding separate slots. The planner must use the actual
tier rubric rather than inflate complexity to select this expert. Other builders
can implement its plans, with the same checks, reviews and human oversight.

For API creation, the assignments are:

```json
{
  "agentAssignments": {
    "sociotechnic-planner": "sociotechnic-infrastructure-planner",
    "sociotechnic-builder": "sociotechnic-infrastructure-builder"
  },
  "agentVersions": {
    "sociotechnic-planner": "1.0.0",
    "sociotechnic-builder": "1.0.0"
  }
}
```

Supply these along with the ordinary New run request fields. Do not start a run
merely to install or inspect the expert. `db init` applies the committed catalog
bundle to another installation; the catalog remains database-owned.

## Skills and sources

`terraform-skill` vendors Anton Babenko's skill v1.17.2 at commit
`9c1e92d962a5407c227e5566416e962a2f057240`, including all eight references and its
Apache-2.0 license. Its source is
[antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill).
[Provenance](../skills/terraform-skill/UPSTREAM.md) records the exact import.
No upstream Docker-based MCP server, plugin, global installation or executable
was installed. Terraform MCP and terraform-ls are optional suggestions in the
upstream text; the expert must disclose when unavailable and use authoritative
documentation. Runtime and provider versions must be verified for the target;
Terraform and OpenTofu feature floors cannot be assumed identical.

`container-technologies` v1.0.0 covers image authoring, Docker Compose service
lifecycle, Buildx/Bake build graphs, SBX management, v3 workloads/mixins/kit sets,
credentials, network/capability boundaries and future CI/CD work. The
[entrypoint](../skills/container-technologies/SKILL.md) routes to two focused
references, each with the official sources checked on October 24, 2026:
[Docker local sandboxes](https://docs.docker.com/ai/sandboxes/get-started/),
[v3 kits](https://docs.docker.com/ai/sandboxes/customize/),
[kit authoring](https://docs.docker.com/ai/sandboxes/customize/author/),
[Bake](https://docs.docker.com/build/bake/), and
[Compose](https://docs.docker.com/compose/intro/features-uses/).

The v3 guidance distinguishes explicit v3 workloads from currently-v2 built-in
agent shortcuts. It also separates Docker Compose, kit-set composition and Bake
HCL. The expert must inspect the current repository's sandbox implementation;
it does not assume the parallel SBX feature branch has merged.

## Tools and boundaries

The planner has bounded file readers, live web search and Context7 when configured.
It returns the plan through the existing record adapter and cannot run shell or
edit target files. The builder additionally has shell and file-edit tools under
workspace-write in the assigned linked worktree. Its shell network setting follows
the pinned network permission. Missing local binaries/daemons/credentials are
reported rather than silently installed or treated as verified execution.

A branch/HEAD-bound `commit_changes` MCP tool stages explicit files and commits;
it adds no shell-writable Git metadata roots. It refuses outside paths, staged
changes, changed branches/HEAD and clean filters that would execute on the host.
Host-side Git disables repository hooks, fsmonitor and signing helpers. This tool
supports local code commits only; configured engine checks and human gates remain
mandatory. There is no push/merge/deployment tool or provider fallback.

This adapter is local Codex execution, distinct from Docker microVM isolation.
Available host credentials and services remain consequential for shell tools.
Infrastructure mutation, registry publication, data deletion and wider permissions
need explicit task scope and authorization. Plan approval for code changes does
not itself authorize production provisioning.

Skills are stored as complete Markdown resources in immutable releases. Both
providers load their entrypoints and read reference snapshots on demand. Publishing
without a `skills` field preserves them; an explicit selection snapshots current
bundled bytes into the new release. Updating source files cannot change pinned
runs. Catalog export/import retains every resource and its content digest.

## Verification

The [live smoke evidence](evidence/infrastructure-agent-smoke.json) captures a real
Sol/high run through the adapter, with the builder prompt body used by this release
and a smaller smoke budget. The first probe returned BLOCKED when shell Git staging
was denied. The corrected probe used the scoped commit tool and returned READY at
`be6ba5b2dc59ea6a3c14c8ff6779846ea6f6e103` with exactly four files committed and a
clean worktree. Independent host checks confirmed the files, commit and status,
and repeated Compose config and Bake print successfully.

Terraform was unavailable, so Terraform init/validate/fmt were not run. The Docker
daemon was unavailable in this smoke; configuration parsing does not establish an
image build or running service. No sandbox, cloud resource, deployment, image build
or registry publication was performed. The smoke ran outside canonical job history
and is not a measured deployment, comparative-quality claim or production approval.

Focused tests cover snapshot creation/preservation, content integrity and catalog
round trips, Claude skill loading/cleanup, Codex reference reads, builder tool
budgets, reader isolation and scoped Git behavior against real linked worktrees.
The Git tests prove explicit-file staging, base-branch preservation, hook/filter
non-execution, traversal/symlink rejection, and refusal of stale branch/HEAD or an
already-staged index. Repository gate and PostgreSQL results are recorded in the
implementation plan after final verification.

The frontend change only updates the existing shared settings/tool descriptions.
Its static premium audit reports four existing actionless-button findings owned
by Radix Dialog/Tooltip/Collapsible triggers in unchanged files; these require
runtime inspection, not extra click handlers.
