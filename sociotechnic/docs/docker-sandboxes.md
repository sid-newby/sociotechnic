# Docker Sandboxes (experimental)

[App guide](../../README.md) · [CLI/API](cli-reference.md) · [Engine/state](engine-reference.md)

Choose **Docker Sandbox — experimental** in New run to put a run's agents and
repository checks in one local Linux microVM. Local execution is still the
default. The host console, PostgreSQL store, driver lease, record validation and
human approval controls stay outside the VM. There is no fallback to local
execution when provisioning, authentication or a check fails.

## Runtime and recipe

Install the standalone `sbx` CLI and sign in. Docker Desktop is not required.
Sandboxes use their own image store and Docker daemon, separate from Desktop's
containers. See Docker's [installation guide](https://docs.docker.com/ai/sandboxes/install/).

The maintained recipe is [sandbox-kit/sbxenv.yaml](../sandbox-kit/sbxenv.yaml).
It selects a published **v3 shell workload** and **v3 Claude/Codex mixins**, pinned
by release tag and immutable registry digest.
The environment-file schema is version 1; that is independent of the kit schema.
Do not replace the workload with the v2 `claude` or `codex` shortcuts. Docker
requires all kits in a v3 environment to use v3. Published kits avoid a local kit
builder VM. A future source-built kit can create Docker's shared builder and
additional build cache; account for that separately before adopting it.

The run snapshots the recipe on first provisioning. Later edits do not silently
recompose an existing VM. Tools added with package managers stay in that VM;
repeatable tool, skill and MCP configuration belongs in setup or additional v3
mixins. Adding kit capabilities can require recreating the environment. Credential
and host-access grants remain explicit. The planner's existing role and tool
limits still apply; a request alone cannot grant a new capability.

For custom image production, Docker Buildx Bake can describe repeatable build
targets and build several targets together. Bake builds images; the sandbox
recipe composes and runs them. The published-kit trial requires no Bake build.
See [kit authoring](https://docs.docker.com/ai/sandboxes/customize/author/) and
[Bake](https://docs.docker.com/build/bake/).

## First-time setup

```bash
sbx login
# Choose your own first-time Docker Sandbox network default:
sbx policy init allow-all   # Open; alternatively balanced or deny-all
sbx secret set openai --oauth
```

For Claude, run `claude auth login` or `/login` inside the prepared VM. Local
`sbx secret set --oauth` supports OpenAI only. Composed kits may also require
explicit OAuth-domain bindings in `~/.config/sbx/credentials.yaml`; approve those
interactively during operator setup, or create the OAuth-only bindings after
reviewing the exact domains. Sociotechnic does not silently create global
credential policy. A browser account sign-in alone is not proof that Docker
captured an OAuth credential; verify with the agent's auth status and a live call.

Network policy is an operator decision, not something Sociotechnic changes.
Open permits unrestricted outbound traffic. Balanced permits common development
services; other registries and MCP endpoints may need explicit allow rules.
Neither setting affects ordinary agents running outside Docker Sandboxes.

Provider bindings and model entitlements must work in sbx before a live agent
run. Existing host login files are not copied. OAuth is required for these
subscription adapters; an API-key binding does not silently become a paid API
fallback. Codex uses Docker's host OAuth proxy through its declared sentinel;
its isolated reader tools and disabled shell remain unchanged.
Ordinary Codex builders retain their workspace-write tools and scoped
`commit_changes` bridge inside the VM. Infrastructure agents' pinned skill
resources are validated and materialized there, with the same recorded bytes as
local execution; maintained packaged references are also in the runtime snapshot.
The optional [infrastructure agents](infrastructure-agent.md) can be selected
independently of this execution setting; choosing Docker does not change defaults
or the run's pinned agent versions.

The VM must have Node 24+, Git and Codex. The published workload supplies common
CLI/build tools and its own Docker engine. Provisioning installs the exact pnpm
version in Sociotechnic's package manifest and installs the control runtime with
its frozen lockfile. Target dependencies are installed by builders in the VM.
Project-specific services and browser tooling may need additional setup/mixins.
Host credentials, PostgreSQL URLs, user configuration, SSH sockets, host workspaces
and the host Docker socket are not mounted or copied. The shared host skill store
is disabled; approved project skills are included in the control runtime snapshot.

## Start a run

In **New run**, select **Docker Sandbox — experimental**, then choose CPUs,
memory in GiB and simultaneous top-level agents. Defaults are 4 CPUs, 8 GiB and
2 agents. Choose 1 for sequential execution. Nested comment workers share the
same VM resources and their existing coordinator bounds; the top-level limit
does not separately schedule those nested workers.

From the CLI:

```bash
sociotechnic/bin/sociotechnic new /path/to/repo 'Describe the change' \
  --execution docker-sandbox --cpus 4 --memory-gib 8 --parallel-agents 2
```

Omit `--execution` for local execution. The setting is immutable after creation.
The same option works for feature, design and comment-cleanup runs. The console
Activity view identifies the environment and its configured resources.

## Git, checks and human decisions

The host job worktree remains a **review mirror**, retaining the existing local
merge, rework and publishing flow. Agents work in a separate full Git repository
inside the mountless VM. No host Git metadata is exposed. A private bare
repository owns a linked worktree entirely in the VM, separating Git metadata
from the shell-writable checkout. It starts at the mirror's exact commit and
assigned branch; its source remote is removed.

Successful dispatches return a bundle and assigned reports. Import verifies a
clean assigned branch, a clean host mirror, matching bundle HEAD and a descendant
commit. Only commits enter the mirror; sandbox hooks, Git configuration and
dependency directories do not. Inputs are compared after execution and output
symlinks are refused before ordinary staging validation and database ingestion.
Checks run inside the VM at that same commit. The gate rechecks the VM against
the host mirror before approval; local acceptance, publishing and merges remain
human actions.

The runtime does not turn the agent into a trusted reviewer of its own isolation.
Agents sharing a VM also share its filesystem. Role guards remain necessary;
the VM is the host isolation boundary, not per-agent isolation or certification.
Model providers can receive repository content through ordinary model requests.

## Capacity, storage and cleanup

The default admission limit is **one retained sandbox per Sociotechnic home**,
including stopped VMs. A database lock serializes provisioning. Names include a
hash of the canonical home and the job ID; unrelated sandboxes are not removed.
New provisioning requires at least **15 GiB** of host free space. Operator knobs:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `SOCIOTECHNIC_SANDBOX_MAX_RETAINED` | `1` | Maximum owned VMs, including stopped ones |
| `SOCIOTECHNIC_SANDBOX_MIN_FREE_GIB` | `15` | Host free-space floor before provisioning |
| `SOCIOTECHNIC_SBX` | `sbx` | Operator-selected sbx executable |

These are positive integers, except the executable path. CPU/RAM are explicit.
The internal Docker store is requested at 6 GiB for new sandboxes. Other VM data,
provider state and cached image layers also consume space; the free-space floor
is admission control, not a total disk quota. Cached images may survive VM
removal. Sociotechnic never runs global prune/reset commands.

When the driver settles at a plan hold, pause, human gate or failure, it stops its
owned VM to release compute. Stopping retains files. **Finish locally** after
acceptance removes the VM, worktree and job branch. **Remove sandbox and worktree**
on a stopped run verifies that the clean VM HEAD is preserved on the host before
removal. Failed removal is reported and can be retried. Remote merging preserves
local resources; clean them explicitly after verifying their disposition.

## Recovery

```bash
sbx ls
sbx exec <sandbox-name> bash
sbx stop <sandbox-name>
```

Dirty work blocks successful completion and automatic deletion. Inspect it inside
the VM, then commit or deliberately discard it there. Reopen normally to retain
the VM and continue within existing bounds. `reopen --discard` is refused for
sandbox runs because discarding only the host mirror would misrepresent the VM.

Partial setup keeps an ownership manifest and the VM, if created. Retry can
finish setup without overwriting its repository. Automatic removal refuses an
uninitialized VM because setup may have left useful files. Inspect it first;
after preserving anything needed, explicitly remove that named environment with
sbx. A missing initialized VM is not silently recreated: it could have contained
unexported work. The database backs up records, not sandbox files or Git commits.

## Verification tools

`tests/sandbox.test.ts` drives the real worker protocol and Git bundles through a
fake sbx executable. It does not prove virtualization or provider authentication.

```bash
node --test sociotechnic/tests/sandbox.test.ts
node sociotechnic/scripts/sandbox-smoke.ts
```

The smoke script provisions a real VM against a disposable repository, checks
Linux execution, imports a commit and removes only its owned VM and fixture on
success. It makes no model calls. Failure preserves the fixture and stops the VM
for inspection. Live Claude/Codex runs require separate authentication and model
access verification. The [trial verification](docker-sandbox-plan.md#verification)
records a successful Claude subscription build and Codex subscription read against
the same real VM commit. This feature remains experimental; that trial does not
establish enterprise isolation, portability to every machine or every MCP setup.
