# Docker Sandboxes and v3 kits

Research baseline: 2026-10-24. Verify against the installed sbx release.

## Runtime and workspace

Docker Sandboxes isolate agents in microVMs with their own Docker daemon. A shared
workspace remains writable on the host; use an isolated worktree or clone mode
when parallel agents must not share edits. Inspect mounts, ports and network
policy before launching. Keep authentication on the supported secret/auth path.
Inspect `sbx ls` and `sbx policy ls`; use targeted stop/removal only for resources
owned by the task. A sandbox persists beyond the agent process, and removing an
in-sandbox clone discards its unexported work. Preserve that work first.

Source: [local get started](https://docs.docker.com/ai/sandboxes/get-started/).

## Compatibility and role selection

V3 requires sbx >=0.45; capabilities may require more. All components in a v3
sandbox must be v3. Built-in agent shortcuts such as `codex` and `claude` currently
select v2; choose an explicit verified v3 workload image/path/Git reference when
adding v3 mixins. A workload provides the environment and launch command; mixins
supply tools or configuration through `--kit`. A kit set bundles these choices.
An environment file (`sbxenv.yaml`) selects kits, workspace, credentials and
resources for a specific environment. Confirm the installed schema before editing.

Source: [kits overview and compatibility](https://docs.docker.com/ai/sandboxes/customize/).

## Authoring

Descriptors begin with `# syntax=docker/sandbox-kit:3`. Use the upstream v3 schema
for `schemaVersion`, kind, requirements and capabilities. A descriptor can pair
with a Dockerfile sharing its filename stem. Build with the descriptor as `-f`:
`docker buildx build -f my-kit/my-kit.yaml -t my-kit:dev my-kit/`.
Image software and runtime capabilities have different owners: installing a
program does not grant its network or credentials. Capability `@1` versions are
independent of kit schema v3. Install hooks run at creation; startup hooks run
on each start and can overlap the agent. Put required pre-launch work in the
entrypoint and make startup tasks repeatable. Generated-file expressions use
`${{ kit.env.NAME }}`; plain shell variables are not substituted in file content.
Check capability support for local versus cloud environments.

Source: [author kits](https://docs.docker.com/ai/sandboxes/customize/author/).

## Kit sets

A source `kind: set` lists published components under `kits: [{ ref: ... }]`.
Components must use registry references, not local paths or Git URLs. A set has
no Dockerfile or `build:` block: add software in a workload/mixin. It may contain
at most one workload; with a workload it publishes as a workload, otherwise as a
mixin. Inspect file and capability conflicts. Published sets record component
digests; review them when upgrading. A successful image build alone does not
prove runtime capabilities, authentication, agent startup or readiness.

Source: [compose a kit set](https://docs.docker.com/ai/sandboxes/customize/author/kit-sets/).
Authoritative grammar/examples: [docker/sandbox-kit-spec](https://github.com/docker/sandbox-kit-spec).

## Sociotechnic integration

Find the current checkout's sandbox implementation and contracts. Work on another
branch may not be present here. Never claim SBX support or its schema from memory,
start a parallel driver, weaken a human gate or silently switch execution modes.
When kits package this expert, include both skills and all referenced files,
verified tools and provider authentication, and specify the selected model/effort.
