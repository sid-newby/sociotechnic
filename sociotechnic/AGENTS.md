# Sociotechnic orchestration contract

This file is for whoever drives sociotechnic: the `/sociotechnic` skill in a Claude Code
session, the run console's driver, or a future one. It says how a prompt becomes
a plan, how the plan hands off into the workflow, where a human decides, and
what persistence and merge mean. The engine in `sociotechnic/src` enforces all of it; a driver
that follows this file never has to judge anything.

## Technical references

When developing or extending Sociotechnic itself, start with the repository's
[development instructions](../AGENTS.md). The web-focused README is only the app
guide; the existing tools and their contracts are documented here:

- [CLI and driver reference](docs/cli-reference.md): commands, HTTP API, console
  lifecycle, publishing and driver handoff.
- [Engine and state reference](docs/engine-reference.md): roles, records, gate
  rules, bounds, configuration, migration and recovery.
- [Local setup and development](docs/development.md): source map, tasks and checks.
- [Comment cleanup](docs/comment-cleanup.md): coordinator and worker capabilities.
- [Behavioral contracts](CONTRACTS.md): the specification for behavior changes.

Consult the relevant sections and reuse the existing implementation before adding
new commands, routes or orchestration. These references do not change runtime
permissions: the driver rules and human gates below still apply.

## One rule

The engine decides, the driver executes. A driver runs `step`, spawns exactly
the agents the result names with exactly the prompts it gives, records each
completion with `finish`, and asks again. It never authors code, plans, reviews
or decisions, never edits record prose, never resumes an agent, and never pushes.
The Codex transport may publish an agent's final record verbatim to its assigned
path; that record still passes through the engine parser and gate.

## From prompt to plan

### Team awareness and help

Before creating a run, a session orchestrator reads `sociotechnic roster` for
compact, current capability cards. Choose a matching specialist planner or
builder through New run's existing assignments or CLI `--agent-assignments`;
use `--agent-versions` only for an explicit version choice. These choices pin
and lock those slots. Do not load the whole library's prompts or skills.

The engine freezes a roster for the run and adds it to every dispatch, including
the planner, builders, researchers, reviewers, conformance and approver. Nested
workers receive the roster and send help requests to their coordinator. New
agent publication is automatically discoverable in new rosters; it cannot
change existing runs. `sociotechnic roster <job>` reads a run's recorded cards.

Agents keep ownership and ask for narrow help rather than guess. A help request
names the expert, question, evidence/attempts and result needed to proceed.
The planner can select a research-template advisor per question through the
existing one-time research escape; the engine validates role, frozen release,
explicit assignment locks and normal bounds. Advisors cannot delegate onward.
Other roles return the request in their existing BLOCKED, Findings or ESCALATE
record; they do not spawn helpers or change assignments. A planner may record
`agentRecommendations` in its plan for the assigner, without reassigning work.
The driver reports these records and follows engine decisions, never infers a
new dispatch from recommendation prose. See [agent discovery](docs/agent-discovery.md).

1. The prompt is the feature text as the human typed it. Multi-line is fine.
   A good prompt says what should change, for whom, and how you would know it
   worked. It does not say how; that is the planner's job.
2. `new <repo> <prompt>` commits the job to PostgreSQL, creates a branch
   `sociotechnic/<job-id>` from the base branch's current commit, and creates a
   worktree under `.sociotechnic/worktrees/`. PostgreSQL owns job state and records;
   dispatch input/output files under `.sociotechnic/staging/` are temporary.
   The target repository is otherwise untouched.
3. Explicit `workflow: "comments"` job creation inventories the selected base and
   scope and pins a fixed COMMENTS plan without an agent dispatch, returning
   `planned` for review. Otherwise the first `step` dispatches the planner (Fable, xhigh). It reads the repo
   and writes `plan.json`: title, summary, tier, stages with files and
   acceptance, job-level acceptance, the `touches` globs the build may change,
   docs impact, testing, risks, out of scope. It may ask once for research;
   the engine then runs one Luna researcher per question and dispatches the
   planner again.
4. Before pinning, the planner may request `needs-design` for major UI work.
   Explicit `workflow: "design"` starts with the Fable designer instead. The
   designer interviews through console packets, explores directions and presents
   three composition previews. Human responses continue the same run; only an
   explicit composition approval enables final planning. The engine fingerprints
   the evidence, binds the selected scaffold and requires `designDigest` in the
   final plan. See [design ceremony](docs/design-ceremony.md).
5. The engine validates the plan, pins its digest, and the tier picks the
   builder: COMPLEX on Opus, EASY on Sonnet, BULK on Haiku, COMMENTS on Sonnet.
   COMMENTS uses the comment-cleaner coordinator and fresh Sonnet/high Sicko workers
   inside that build dispatch; only the coordinator commits, between waves.

**Plan hold.** A driver may ask the engine to hold at `planned`. The console
does by default; the skill does when the user asks. At a hold the human reads
`plan.json` and either continues or stops the job and starts a new one with a
better prompt. Plans are not edited in place: the digest is pinned, and a
changed plan blocks the gate.

## The workflow

Each round is: build, deterministic checks, review lenses in parallel,
conformance, gate. The builder commits on the job branch in the worktree and
writes `round-N/build.md`. The engine runs the repository's own checks from
`.sociotechnic.json` and writes `checks.json`. It writes the diff files, skips lenses
whose path guards do not match, and dispatches the rest. The gate is computed
from records alone: every verdict PASS, every COMMIT equal to the worktree HEAD,
checks passing at that HEAD, worktree clean, plan digest unchanged, diff
non-empty. A failing gate opens the next round with a fresh builder that gets
the findings; a passing gate with policy flags parks for a human; a clean pass
dispatches the approver (Opus), whose APPROVE makes the job `ready`.

Bounds: rounds, dispatches per round, retries per step, and a deadline per
dispatch. Past any bound the job parks as `needs-human` with the bound named.
An override lifts one bound by one and is remembered forever.

## Human gates

| Status | What it means | Actions |
| --- | --- | --- |
| `design-input` | the current interview, direction or composition decision is waiting | answer/select/approve/revise through design response, stop |
| `planned` (held) | the plan is pinned and nothing has been built | continue, stop |
| `ready` | approver APPROVED at the gate head; merge locally to test the change in the main checkout | merge (local, worktree kept), accept, rework, pr (local text), stop |
| `needs-human` | parked: a bound, a BLOCKED build, a policy flag, an escalation, or a malformed record past its retries | merge (local), accept, rework, override then run, stop |
| `merged-local` | the job branch is merged into the base branch of the main checkout; the human tests it there | accept, rework, pr (local text), stop |
| `accepted` | the human tested and accepted the change | pr --push (push and open the pull request), merge --remote --confirm (GitHub PR), merge (finish locally), pr, stop |
| `merged` | finished locally, or a confirmed remote merge is recorded | merge --remote --confirm for a published PR not yet merged remotely; clean |
| `stopped` | a human stopped it; plan, history, branch and worktree are kept | reopen (keeps uncommitted edits; `--discard` drops them), then run; clean |

`rework <note>` at a failed round-zero planner with no pinned plan records planning
feedback and grants one retry. Start only the planner and retain the plan hold;
never send that note to a builder without a pinned plan. After a build round,
`rework <note>` is the human's review: it becomes a `[high]` finding in a
`review-human.md` record and opens a new round for a fresh builder. `override
<bound> <note>` adds one to that bound and lets `step` resume where the job
parked. `accept` is the human's signature; nothing after it runs an agent.

No driver may call `finish` for a dispatch it did not run, write a record, or
move a job past a human gate on its own.

## Sync and merge

Agents commit and nothing more. The standard order at the gate is merge
locally, test in the main checkout, accept, then publish. Sociotechnic touches a
remote only on a command the human typed, and only after `accept`, the human's
signature that the change was tested (in the main checkout after a local merge,
or in the worktree). `pr` generates `pr.md` from the records (plan, acceptance
evidence, checks, verdicts, usage) at any time from `ready`; `pr --push`, from
`accepted` only, pushes the job branch and opens the pull request with `gh`.
`merge` is local only: from `ready` or `needs-human`, with the main checkout
clean and on the base branch, the engine runs `git merge --no-ff
sociotechnic/<id>`, records `localMerge` and moves the job to `merged-local`,
keeping the worktree and job branch for rework and publishing. From `accepted`
it finishes the job: it merges only when no local merge is recorded, then
removes the worktree and deletes the job branch. `merge <job> --remote --confirm` merges the recorded PR on GitHub,
including after a local merge. It verifies repository, branches and the
published head commit, and preserves local checkouts and worktrees. The human
may select `--method merge|squash|rebase`. GitHub requirements must permit the
merge; Sociotechnic does not schedule auto-merge or bypass rules. Only GitHub-confirmed
success is recorded. The merge itself, on GitHub or locally, is always the
human's act; drivers never add `--remote` or `--confirm` on their own.

## Worktrees and commits

Agents commit; drivers do not. Every build runs in the job's worktree on the
job branch, cut from the pinned base commit. Reviewers, conformance, the
approver and the planner have no shell and may write only inside the job
folder; a hook blocks anything else. The worktree must be clean at the gate, so
a reviewer that touched code would fail the round rather than pass it.

## Running agents

Jobs pinned to `docker-sandbox` use the console's sandbox runner and v3 recipe.
Do not dispatch their agents or repository checks directly on the host. Keep
provider adapters, guards and record ingestion intact. A sandbox error cannot
change the execution setting or billing method. See [setup and recovery](docs/docker-sandboxes.md).

The project and global skills hand execution to the console with `run <job>`
(or `run <job> --step`). They never spawn roles or call `finish` themselves.
The shared driver selects the provider from each dispatch's pinned model:

- Claude models use `query()` with project definitions, role tools and hooks,
  pinned model/effort, role turn limit and dispatch deadline.
- `sociotechnic-reviewer-code` uses `gpt-6.1-sol/high` and
  `sociotechnic-researcher` uses `gpt-6-luna/high` through local Codex CLI with
  saved ChatGPT authentication. An isolated read-only runner supplies bounded
  MCP readers. Network access follows the pinned role tools; baseline research
  has live web search and configured Context7.
  Compatible reader releases can select either provider in Agent library.
  Readers have no shell or arbitrary writes. Ordinary build templates may also
  select Codex: they use workspace-write shell/edit tools at the assigned job
  worktree. Design and Agent-worker templates remain Claude. No child agents or
  provider fallback is added. Pinned instruction skills load for both providers;
  their references are temporary snapshots covered by release content digests.
  The runner publishes only the final response to the assigned record path;
  the engine validates it. Stop and deadline kill its process group.

Historical dispatches retain their recorded models. Every completion still goes
through `finish` with observed usage. See [Codex integration](docs/codex-integration.md).

## Handoff between drivers

A job can be driven by the skill and the console in turn, at any human gate or
hold. PostgreSQL coordinates driver and mutation ownership. Only one driver may
run a job at a time, `step` from elsewhere is refused while it owns the job, and
`status` identifies the owner. Ownership loss stops scheduling and rejects stale
completions. Never force past a live driver; pause it in the console or wait for
a gate. Local lock or staging files cannot grant ownership.

## Design ceremony drivers

The designer is a guarded, shell-free Fable/xhigh role with an explicitly
registered Impeccable MCP tool. It writes only its assigned packet and isolated
preview round. The driver does not answer questions, choose stacks/directions,
open a second approval channel or infer approval. `design-input` is a real human
wait. The console records a response under the normal job lock and then starts
the shared driver on the same job; CLI sessions record `design-respond` and call
`run` afterward. Approval of design never authorizes acceptance or publication.

## Agent release provenance

New jobs pin the latest semantic release of each role at creation; the console may
record explicit legacy overrides and eligible role-to-agent assignments. New dispatches include their frozen version,
actual agent identity, role template, model/effort, tools, limits and definition. Drivers use that snapshot, never a newly
published release in its place. Old jobs without a version map keep baseline roles.
SDK definitions execute with the same write/design guard scripts. Codex reader
versions, including compatible planner, review, conformance and approval templates,
may choose the OpenAI models in `src/agent-models.ts` with the model-specific effort choices in that module and their
fixed reader tools. Ordinary build templates also support Codex with shell/edit
tools in the assigned worktree and a scoped branch-bound commit tool. Design and
Agent-worker templates still require Claude. The selected model determines the provider. Network access follows pinned tools.
Nested comment workers remain baseline v1.0.0. Library publication does not change
job caps, write scopes or human gates. See the
[release contract](CONTRACTS.md#agent-configuration-versions).

PostgreSQL owns immutable releases and run bindings. New run/dispatch creation
validates the pinned release against the database and current role contract. A
configured database outage fails instead of falling back to disk; already-running
calls retain their snapshots. Restore validates releases and repairs the cache
before restoring run files. Create or change agents through Agent library, not
repository files. `seeds/agents.json` only initializes an empty catalog. Drivers
continue to use the shared console runner; do not resolve local Markdown agents.

## Job and record authority

Drivers materialize committed database records as dispatch inputs and collect
only the assigned outputs. The engine validates the output, then commits records,
completion state and events together. Malformed output remains evidence and
follows existing retry bounds; a failed database commit cannot count as a
completed dispatch. Neither provider writes canonical records directly.

PostgreSQL is required for job operations. There is no file fallback, best-effort
sync or normal job-directory import. `restore` recovers a Git worktree only; it
cannot overwrite job evidence. Do not edit staging to repair a job or infer
completion from a surviving local file.

Full immutable catalog history travels in committed release migration bundles.
They include unused agents and older semantic versions, instructions, tools,
model/effort, limits and custom-agent metadata. `db init` imports missing releases
idempotently and rejects conflicting content for an existing identity/version.
Catalog improvements must be exported and checked before a code commit; an
upgrade never silently replaces a run's pinned configuration.
