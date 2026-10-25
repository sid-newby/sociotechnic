---
name: container-technologies
description: Design, compose, implement, troubleshoot and maintain Dockerfiles, Docker Compose services, Buildx Bake builds, Docker Sandboxes with SBX v3 kits, and container CI/CD workflows.
metadata:
  version: 1.0.0
---

# Container technologies

Choose the tool by its responsibility: Terraform manages infrastructure resources;
Dockerfiles define images; Buildx/Bake builds them; Compose manages application
services; SBX runs agent environments; v3 kits package workloads and mixins.
Do not conflate Docker Compose with composing a kit set, or Bake HCL with Terraform.

Read the assigned repository's instructions and existing container setup before
creating another workflow. Discover installed CLI versions and the active Docker
context/daemon. Distinguish commands on the host, inside the sandbox, and in CI.
A missing binary, daemon, credential, tool or provider is a stated limitation;
writing configuration does not establish runtime success.

For Docker Sandboxes, read [references/sandboxes-v3.md](references/sandboxes-v3.md).
For images, Compose, Bake and delivery, read
[references/build-compose-delivery.md](references/build-compose-delivery.md).
Recheck the linked official documentation and installed `--help` before relying
on version-sensitive syntax or capability support. The research baseline is
2026-10-24, with local sbx v0.49.2; do not pin future projects to that version.

## Operating boundaries

Honor the role and brief: a planner supplies scoped files, configuration drafts,
verification and rollback steps; a builder implements the approved plan and runs
available checks in its worktree. Preserve Sociotechnic's record format, commit
binding, review and human gates. Other agents may execute these plans.

Prefer an explicit sandbox name, Compose project name and scoped image tags.
Inspect existing resources before changing or removing them. Avoid broad prune,
volume deletion, host Docker socket mounts, privileged containers, wide workspace
mounts and blanket network permissions unless their concrete need is authorized.
Use BuildKit secret mounts for builds, runtime secret references for services and
SBX's credential facilities; never bake credentials into image layers, build args,
source files, reports or command output. Preserve data volumes during ordinary
cleanup. Registry publication, production changes and destructive cleanup need
explicit scope and authorization; capability alone is not approval.

## Evidence

Name the exact files, CLI/runtime versions and daemon/context used. Start with
configuration checks, then build/run/service smoke checks appropriate to the
brief. Report observed commands and results, readiness checks, remaining gaps,
cleanup ownership and recovery. Do not call `compose config`, Bake `--print`,
Terraform `validate`, or a mocked test proof of a running deployment.
