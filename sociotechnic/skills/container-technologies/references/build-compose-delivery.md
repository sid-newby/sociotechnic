# Images, Compose, Bake and delivery

## Images

Use the repository's base-image policy, minimal build contexts, `.dockerignore`
and multi-stage builds where useful. Separate dependency installation from source
copies for cache reuse. Prefer a non-root runtime when the workload supports it,
explicit writable paths and appropriate health/readiness checks. Check target
architectures and native build dependencies before promising multi-platform images.
Pin release inputs and report the resulting digest; do not reuse an unverified
example tag as a claim of current compatibility.

Build secrets use BuildKit secret/SSH mounts; pass them at build invocation and
consume with `RUN --mount=type=secret` or SSH mounts. `ARG`, `ENV` and copied
credential files are not safe secret transport into an image.
Source: [build secrets](https://docs.docker.com/build/building/secrets/).

## Docker Compose

Reuse `compose.yaml` and existing overrides/profiles rather than generating a
second stack. Check configuration with the project's explicit `-f` and `-p`
choices (`docker compose ... config --quiet`) without printing interpolated
secrets. Make services ready through healthchecks and appropriate dependency
conditions; startup order alone is not readiness. Check port collisions, volumes,
service DNS and environment interpolation in the intended host/sandbox context.
Use `up`, `ps`, scoped logs and service smoke checks as appropriate; shut down
only the task's project and preserve named volumes unless deletion is authorized.
Compose supplies multi-container application lifecycle; it is not a kit descriptor.
Sources: [Compose uses](https://docs.docker.com/compose/intro/features-uses/),
[Compose services](https://docs.docker.com/reference/compose-file/services/).

## Buildx and Bake

Bake describes build targets, groups, variables, inheritance, platforms, caches,
outputs and tags. It can read HCL, JSON and Compose input. Select files explicitly
when repeatability matters; default discovery can merge Compose and Bake files.
Use `docker buildx bake -f docker-bake.hcl --print` to inspect the effective
configuration, then the intended target build. `--print` is not a build test.
Review cache export scope, secret references, tags and outputs before executing;
`--push` publishes externally and needs the brief's authorization. Keep Compose
runtime settings and image-build configuration consistent rather than duplicating
image identities. Inspect Buildx builder/context, platform support and cache
behavior when diagnosing host/CI differences.
Sources: [Bake](https://docs.docker.com/build/bake/),
[Bake reference](https://docs.docker.com/build/bake/reference/).

## CI/CD and ownership

Keep pull-request validation separate from trusted publication/deployment. Pin
workflow dependencies and runtime inputs, use scoped short-lived credentials and
protected environments, and prevent untrusted PRs from reaching release secrets.
Run lint/config checks, tests and image builds; promote a tested image by digest.
Retain the build evidence, provenance/SBOM or scan outputs required by the project.
For Terraform, hand the exact reviewed plan artifact to the authorized apply job,
with backend locking and narrowly scoped identities; do not re-plan during apply.
Use the attached Terraform CI/CD reference for implementation details and verify
against the selected provider and CI platform. Explain rollback limitations:
rolling an image back does not reverse database migrations or Terraform state.

Commands proposed for another agent are a validation plan until actual output
exists. Do not install tools, create billable infrastructure or publish an image
merely to make a configuration-only task look complete.
