# Engine and state reference

[App guide](../../README.md) · [CLI and driver reference](cli-reference.md) · [Development](development.md)

This reference describes role configuration, records, validation, limits and persistence. [CONTRACTS.md](../CONTRACTS.md) is the behavioral specification; [AGENTS.md](../AGENTS.md) is the driver contract.

## Optional execution environment

`job.execution` is absent on historical/local runs or contains the explicit local
setting, or `{ kind: "docker-sandbox", cpus, memoryGiB, parallelAgents }` on an
experimental sandbox run. Job operations validate it and refuse changes after
creation. Agent identity/version selection remains separate from execution.
The React console remembers its new-run environment choice and valid sandbox
resources in browser storage. This only initializes future forms; it cannot
change existing jobs, CLI/API defaults or installation-wide sandbox capacity.

One owned, mountless local VM contains an independent repository and executes
agents/checks. The host worktree is its commit-verified review mirror. PostgreSQL
still owns records; VM files and uncommitted work are not database backups.
Dispatch ingestion retains its existing input, output and driver-lease checks.
The gate checks VM/mirror agreement before approval. Pausing retains VM data;
finishing locally and explicit cleanup verify preservation before deleting it.
See [the v3 environment recipe, admission limits and recovery](docker-sandboxes.md).

## Repository preparation

The React New run form can browse or create directories and prepare a missing Git
repository before engine job creation. The HTTP layer's explicit `initialize`
option creates missing starter files and their first commit, then calls the same
engine entry points as an existing repository. It preserves committed repos and
existing starter contents and excludes unrelated files from the initial commit.
The engine still resolves the repository root and committed base and creates an
isolated job branch/worktree. CLI requirements, records, driver locks, bounds and
human gates are unchanged. See [Starting a run](cli-reference.md#starting-a-run).
New repository is a console setup preset, not an engine workflow. Folder creation
and the remembered browser starting point are separate from job creation. Its
explicit `githubRepository` setup creates a private GitHub remote and publishes
the initial base before the engine cuts the job branch. Authentication or push
failure prevents job creation; matching origins support retry without another
remote creation. Ordinary `initialize` stays local. Publishing run changes still
requires human acceptance and a separate push-and-PR action. UI
work without an existing UI scaffold is routed through design so the interview
can recommend the bundled React + NestJS house special; the human chooses the
stack and approves the design before implementation. Non-UI projects need no
scaffold. Explicitly requested scaffolds and existing UI foundations are respected.

## Browser verification

Opt-in browser builders include the [browser-verification skill](browser-verification.md).
Its immutable snapshot uses existing Bash access, per-dispatch sessions and
pinned host/VM tooling. Default assignments and read-only role permissions stay
unchanged. Setup failure is not verification evidence and cannot clear a gate.

## Job states

Job statuses (contract section 7.1). An override resumes the interrupted step; the diagram omits those return edges. `stopped` is reachable from any non-terminal status. It records `stoppedFrom`, the status the job left, and `reopen` leads back to it. `merged` is the only terminal status. The standard human path is `ready` → `merge` (local, into your checkout) → `merged-local` → test there → `accept` → `pr --push` → `merge --remote --confirm`.

```mermaid
stateDiagram-v2
  state "needs-human" as needs_human
  [*] --> new
  new --> planning
  state "design-input" as design_input
  new --> designing: explicit design workflow
  planning --> designing: needs-design
  designing --> design_input: Claude awaits human input
  design_input --> designing: reply or resume session
  design_input --> planning: approve design artifacts
  state "planning-input" as planning_input
  planning --> planning_input: needs-input
  planning_input --> planning: human answer
  planning --> researching: needs-research (once)
  researching --> planning
  planning --> planned: valid plan pinned
  planned --> building
  building --> built: READY and COMMIT == HEAD
  built --> checked: engine runs checks
  checked --> reviewing: checks pass, lenses dispatched
  checked --> reviewed: checks fail, failed gate without reviews
  reviewing --> reviewed: gate computed
  reviewed --> building: blockers, within caps
  reviewed --> approving: pass, no flags
  reviewed --> needs_human: flags, or a cap hit
  approving --> ready: APPROVE
  approving --> needs_human: ESCALATE
  state "merged-local" as merged_local
  ready --> merged_local: merge (local, worktree kept)
  ready --> accepted: accept (tested in the worktree)
  ready --> building: rework
  needs_human --> merged_local: merge (local)
  needs_human --> accepted: accept
  needs_human --> building: rework
  merged_local --> accepted: accept (tested in your checkout)
  merged_local --> building: rework
  accepted --> accepted: pr --push
  accepted --> merged: merge --remote --confirm
  accepted --> merged: merge (finish locally)
  merged --> [*]
  state "previous status (stoppedFrom)" as previous
  state "any non-terminal status" as active
  active --> stopped: stop
  stopped --> previous: reopen
```

## Roles and tiers

Fourteen roles, including the nested comment worker. The table is code (`sociotechnic/src/roles.ts`), the initialization seeds mirror its Claude definition model, effort, tools and turn limits,
and `sociotechnic agents` plus a test fail when they disagree. The two Codex
provider bindings are separate from their Claude prompt definitions.

| Role (agent name) | Model | Effort | Tools | Writes | Timeout |
| --- | --- | --- | --- | --- | --- |
| `sociotechnic-designer` | claude-fable-5-1 | xhigh | Read, Grep, Glob, Write/Edit, Skill, AskUserQuestion, WebSearch, WebFetch, Context7, native Impeccable | Isolated design workspace and native session | 40 active min/query |
| `sociotechnic-planner` | fable | xhigh | Read, Grep, Glob, Write, WebSearch, WebFetch, Context7 | `plan.json` (+ optional `plan.md`) | 25 min |
| `sociotechnic-researcher` | gpt-6-luna (Codex) | high | Read, Grep, Glob, Write, WebSearch, WebFetch, Context7 | `research/<n>-<slug>.md` | 15 min |
| `sociotechnic-builder` (COMPLEX) | opus | high | Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch, Context7 | commits + `round-N/build.md` | 60 min |
| `sociotechnic-builder-lite` (EASY) | sonnet | high | Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch, Context7 | commits + `round-N/build.md` | 45 min |
| `sociotechnic-comment-cleaner` (COMMENTS) | sonnet | high | Read, Grep, Glob, Bash, Write, Agent | commits + `round-N/build.md`; worker records | 60 min |
| `sociotechnic-comment-sicko` (nested worker) | sonnet | high | Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch | assigned comments + worker report; no commits | 30 min |
| `sociotechnic-sweeper` (BULK) | haiku | high | Read, Grep, Glob, Bash, Edit, Write | commits + `round-N/build.md` | 45 min |
| `sociotechnic-reviewer-code` | gpt-6.1-sol (Codex) | high | Read, Grep, Glob, Write | `round-N/review-code.md` | 20 min |
| `sociotechnic-reviewer-ux` | sonnet | high | Read, Grep, Glob, Write | `round-N/review-ux.md` | 20 min |
| `sociotechnic-reviewer-ui` | sonnet | high | Read, Grep, Glob, Write | `round-N/review-ui.md` | 20 min |
| `sociotechnic-reviewer-security` | opus | high | Read, Grep, Glob, Write, WebSearch, WebFetch | `round-N/review-security.md` | 20 min |
| `sociotechnic-conformance` | opus | high | Read, Grep, Glob, Write | `round-N/conformance.md` | 20 min |
| `sociotechnic-approver` | opus | high | Read, Grep, Glob, Write | `decision.md` (+ optional `pr-notes.md`) | 15 min |

`maxTurns` per agent: planner 80, researchers 40, builders 250, comment-cleaner 120, comment-sicko 60, reviewers 60, conformance 60, approver 40.

These are default role slots, not a requirement to maintain separate specialist
identities per tier. An ordinary builder release may declare `builderProfiles`
for EASY and COMPLEX, each containing `maxTurns` and `timeoutMinutes` bounded by
that release at dispatch time (the lower of the profile and overall limit).
Changing overall limits in the version editor preserves the tier profiles.
The same identity can then be selected in both slots. Run and
dispatch snapshots bind the actual slot, budget, instructions and release;
validation rejects a budget or tier mismatch. The build brief supplies the
approved tier and EASY file limit and escalation rules. Other role contracts,
tools and human gates remain separate. Releases without profiles retain their
original single-slot behavior. [Azure Builder](azure-sme.md) uses this capability.

"Context7" in the Tools column means the two MCP tools `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`. See [Network and docs access](#network-and-docs-access).

Code review and research use the local Codex CLI with saved ChatGPT
subscription authentication. Their Claude files remain prompt sources and
historical bindings; current provider/model assignments are in `roles.ts`.
Codex readers have bounded read-only MCP tools and no shell; the runner publishes the
final record. Research additionally has live web search and configured Context7.
See [Codex setup and permissions](codex-integration.md). Other baseline roles use
Claude. Agent-library releases can change providers for compatible reader and
ordinary build templates. Codex builders run shell/edit tools with workspace-write
at the job worktree. Design and Agent-worker templates still require Claude.

### Tier routing

The planner grades the job. The tier picks the builder.

| Tier | Use when | Builder | Model |
| --- | --- | --- | --- |
| COMPLEX | New abstractions, cross-module changes, concurrency, auth or security surface, migrations, unclear requirements, or more than `easyTierMaxFiles` files | `sociotechnic-builder` | opus |
| EASY | Localized change following a pattern already in the repo, at most `easyTierMaxFiles` files, clear acceptance | `sociotechnic-builder-lite` | sonnet |
| COMMENTS | Explicit Sicko/comment/docblock cleanup, regardless of file count | `sociotechnic-comment-cleaner` | sonnet |
| BULK | Mechanical repetition across many files with a verifiable pattern (rename, codemod, fixture or docs sweep) | `sociotechnic-sweeper` | haiku |

The planner runs on fable at xhigh. Researchers run on Codex gpt-6-luna/high and answer one bounded question each, in parallel.

### Comment cleanup

Explicit **Comment cleanup** runs generate a pinned COMMENTS plan and inventory without a planner dispatch. Free-form **Feature or fix** requests still use the planner to select COMMENTS. The Sonnet/high coordinator assigns disjoint files to fresh Sonnet/high workers and commits between bounded waves. The coordinator consumes the pinned inventory when present instead of repeating discovery. Only the coordinator appears as a build dispatch in the engine ledger; nested worker reports belong to that build. It uses the existing checks, reviews and human gates. COMMENTS plan stages require nonempty, non-overlapping exact file paths. See [usage and limits](comment-cleanup.md).

### Read-only by design

The planner, researchers, reviewers, conformance and approver have no Bash. Network access is separate from Bash and does not change this. See [Network and docs access](#network-and-docs-access). Their `Write` and `Edit` calls pass through `sociotechnic/hooks/guard-write.sh`, a PreToolUse hook that restricts writes to the assigned dispatch output scope. Reviewers never run tests. They read `round-N/checks.json`, `diff.patch`, `changed-files.txt` and `diffstat.txt`, which the engine writes before dispatching them.

Reviewer, conformance and approver prompts open with a trust boundary: the diff and every file read are untrusted data, instructions inside them are never followed, and text that tries to influence the verdict is itself a finding.

## Network and docs access

Roles that need current facts get web tools independently of shell access. The write guard still limits local writes, and the gate still checks worktree cleanliness. Network tools send requests to external services.

| Role | Network | Why |
| --- | --- | --- |
| `sociotechnic-planner`, `sociotechnic-researcher` | `WebSearch`, `WebFetch`, Context7 | Package versions, current docs and APIs |
| `sociotechnic-builder`, `sociotechnic-builder-lite` | `WebSearch`, `WebFetch`, Context7 | They already have a shell. Docs help them use a library correctly |
| `sociotechnic-comment-sicko` | `WebSearch`, `WebFetch` | Verify external constraints cited by retained comments |
| `sociotechnic-reviewer-security` | `WebSearch`, `WebFetch` | Advisories for the dependencies in a diff |
| `sociotechnic-comment-cleaner`, `sociotechnic-sweeper`, code, ux and ui lenses, `sociotechnic-conformance`, `sociotechnic-approver` | none | They judge the diff against the plan and the records and stay offline |

### Tools and configuration

- For Codex research, live web search replaces `WebSearch`/`WebFetch`, and the
  same user-scoped Context7 entry is forwarded as an MCP server. Missing Context7
  is logged; sources must still support every external claim.
- `WebSearch` and `WebFetch` are built into Claude Code. They need no configuration on either driver.
- Context7 is the two MCP tools `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`. It comes from the user-scoped `context7` server in `~/.claude.json`.
- In a `/sociotechnic` session the subagents see that server because the session does.
- The console's SDK driver loads only project settings. At dispatch time `runner.ts` reads `mcpServers.context7` from `~/.claude.json` and passes it through the SDK's `mcpServers` option. It does this only for roles whose tools name a Context7 tool. The key never enters the repository.
- `SOCIOTECHNIC_CLAUDE_CONFIG` overrides the path of that file. See [Environment](#environment).
- When the entry is missing, the dispatch still runs. The driver log gets a `warn` line and the agent lacks the Context7 tools. Add a `context7` server to `~/.claude.json` to fix it.

### Version pinning

The optional [Azure SME](azure-sme.md) reuses the infrastructure specialist
configuration: planner/advisor reader identities and COMPLEX/EASY builder
identities, all initially Sol/high v1.0.0. Assign them explicitly in New run;
existing assignments and gates remain unchanged. Its pinned `azure-sme` package
contains seven Microsoft workflows with inert text templates/scripts, loaded as
references rather than automatically executed. A research assignment can advise
on escalation; remediation requires a builder assignment and authorized scope.

Builders resolve package versions with `pnpm view <pkg> version`. The planner uses a search. Both cite the source of any fact taken from the network. A plan may say "latest at build time, pinned by the builder" instead of a number.

## Records and contracts

New runs freeze a [capability roster](agent-discovery.md) from the database and
include it with help guidance in every top-level dispatch. Nested workers receive
the roster and ask their coordinator. The planner's one research escape may
name an advisor per question with `advisors`, an array parallel to `questions`;
null retains the configured researcher. Only frozen research-template releases
are eligible, and explicit researcher assignment/version locks take precedence.
Retries preserve the selected advisor's full configuration. Each auxiliary
dispatch is bound to its release in PostgreSQL without rewriting the default
role pins. Advisors cannot reopen research or delegate onward.

Plans may contain up to six `{agent, reason}` entries in `agentRecommendations`.
They are roster-validated, digest-bound recommendations to the assigner, not
automatic changes to the tier or builder. Builders use BLOCKED/Blocker, validators
use Findings and approvers use ESCALATE/Escalation for specific help requests.
Ownership, independent verdicts, permissions and all human gates remain intact.

Builders, researchers and review roles write UTF-8 Markdown records. The planner writes validated `plan.json` instead. The engine parses it with `sociotechnic/src/verdict.ts`, which is pure. Nothing is inferred and a malformed record never passes.

Rules, in order:

1. **Provider error.** Text outside code spans that matches a provider failure (rate limit, overloaded, authentication, credit balance, quota) makes the record `malformed` with reason `provider-error`. Code spans and fenced blocks are ignored.
2. **Marker line.** The first non-blank line must be the role's marker, for example `VERDICT: PASS`. Only the first non-blank line counts, because the marker is an answer, not a mention. Emphasis such as `**VERDICT:** **PASS**` or `# VERDICT: pass` is tolerated. Missing or wrong gives `no-marker`. A file under 50 bytes or absent gives `empty-output`.
3. **Commit line.** The next non-blank line is `COMMIT: <40 hex>`, the HEAD the agent examined. Missing gives `no-commit`. The engine compares it to the worktree HEAD. A mismatch is `stale`, never a pass.
4. **Findings.** Review-class records list bullets under `## Findings`. Severities `critical`, `high`, `medium` block. `low` is advisory.
5. **Consistency.** `PASS` with any blocking finding is `malformed` (`pass-with-blocking-findings`) and treated as CHANGES. `CHANGES` with no findings stays CHANGES (`changes-without-findings`). An agent that writes `SKIPPED` is `malformed` (`agent-wrote-skipped`). Only the engine writes SKIPPED.

| Record | Marker | Values | Commit line | Findings | Written by |
| --- | --- | --- | --- | --- | --- |
| `round-N/build.md` | `STATUS` | READY, BLOCKED | yes | no | builder, builder-lite, sweeper |
| `round-N/review-<lens>.md` | `VERDICT` | PASS, CHANGES | yes | yes | the four reviewers |
| `round-N/review-<lens>.md` (skipped) | `VERDICT` | SKIPPED | yes | no | engine (lens guards) |
| `round-N/review-human.md` | `VERDICT` | CHANGES | yes | one `[high] general` | engine, on `rework` |
| `round-N/conformance.md` | `VERDICT` | PASS, CHANGES | yes | yes | conformance |
| `decision.md` | `DECISION` | APPROVE, ESCALATE | yes | no (has `## Reasons`) | approver |
| `research/<n>-<slug>.md` | `STATUS` | DONE, BLOCKED | no | no | researcher |

What the gate sees (`effective`): a review is `PASS` only when well-formed, `PASS` and zero blocking findings, otherwise `CHANGES`. A build is `READY` or else `BLOCKED`. A decision is `APPROVE` or else `ESCALATE`. Research is `DONE` or else `BLOCKED`.

Example review record:

```markdown
VERDICT: CHANGES
COMMIT: 9fceb02d0ae598e95dc970b74767f19372d61724

## Findings
- [high] src/auth/login.ts:42 — token compared with ==, not in constant time
- [low] general — rename `doIt` to say what it does

## Notes
Scope was the diff only. Tests cover the happy path.
```

Agent record templates require these body sections: `build.md` has `## Summary`, `## Acceptance`, `## Deviations`, `## Notes for reviewers` (BLOCKED adds `## Blocker`). Reviews have `## Findings` then `## Notes`. `conformance.md` adds a `## Plan steps` table with `stage | status | justification`, where status is `implemented`, `partial`, `missing` or `added`. Every `partial`, `missing` or `added` row without a justification is a `[medium]` finding. `decision.md` has `## Reasons`, and ESCALATE adds `## Escalation`. Research has `## Answer` and `## Evidence`.

The console recognizes the existing build `## Acceptance` checkboxes as
builder-reported verification. The current round's READY record must match its
accepted build commit and the gate head when present. Checked and unchecked
items are counted separately, with a link to the original methods and results.
This evidence can mark the Checks milestone as attended even without configured
repository commands. It never counts as engine-run passing checks or clears
`no-checks-configured`; missing, stale and unreadable evidence stay visible.
Existing tests, smoke commands, manual inspection and documentation checks can
all provide evidence. A new test or duplicate record section is not required.

### The plan

The planner writes `plan.json`. The engine validates it with a hand-written validator and pins its SHA-256 digest in `job.json`. Fields: `title`, `summary`, `tier`, `tierReason`, `stages` (1 to 12, each with `id`, `title`, `description`, `files`, `acceptance`, `risks`), `acceptance`, `touches`, `docsImpact`, `testing`, `risks`, `outOfScope`. The planner may instead write `{"status": "needs-research", "questions": [...]}` with 1 to 6 questions. Researchers then run in parallel and the planner is re-dispatched. That happens at most once per job.

The planner follows the target repository's documentation links and source map
before proposing new commands, routes or helpers. Its `docsImpact` assessment
includes documented entry points and file moves as well as behavior changes.
Affected contracts, references and map files belong in the stages and `touches`;
when no update is needed, the plan explains why. These are planning requirements;
the engine does not automatically detect stale documentation.

### Canonical records and local staging

PostgreSQL stores the job document and logical record paths. `job.json` means a
serialized view of that document, not an independently writable record. The
engine owns checks, diffs, human-review records and generated PR text; agents
produce only their assigned staged outputs.

```text
Database job records, keyed by job id and relative path:
  comment-inventory.json  explicit cleanup inventory
  plan.json, plan.md      plan and optional prose
  research/               researcher records
  round-N/                build, checks, diff, reviews and coverage evidence
  design/                 packets, previews and scoped-tool receipts
  decision.md             approver record
  pr-notes.md, pr.md       approval notes and generated PR text

.sociotechnic/
  staging/<job>/<dispatch>/
    inputs/               materialized committed records
    outputs/              assigned agent outputs awaiting validation/commit
  worktrees/<job>/        Git worktree, branch sociotechnic/<job>
```

Staging is disposable after ingestion. Editing inputs cannot change committed
plans or records. Uncommitted output cannot pass a gate. An interrupted dispatch
may retain staging for recovery, but the database dispatch state decides whether
that output may be ingested. Losing pending output follows the existing bounded
retry/park rules. Git commits and uncommitted worktree edits still require their
own backup.

`pr.md` is generated from committed plan, build, check, review and usage records.
A temporary body file for `gh --body-file` is an export of that record, not a new
source of truth. Publishing stores the PR URL, number and head in the job document.

## Gate

The gate is deterministic (`sociotechnic/src/gate.ts`). `step` computes it directly
at `checked` when deterministic checks fail, or after all issued reviews finish.
All blockers and flags are reported. A red-check round retains build/check/diff
evidence, with empty lens and review maps; no PASS or SKIPPED review is invented.
Its next round uses the ordinary fresh builder and effective round, dispatch,
retry and deadline bounds. The repair prompt names the previous report, checked
commit, command, exit code, signal, timeout and retained output tail once.
Passing repaired commits still receive every applicable review and normal gates.

New builder releases default to focused development and acceptance verification;
pinned-definition, repository and approved-plan obligations are cumulative.
Explicit legacy/custom full-suite requirements remain. READY reports actual
builder evidence; the engine independently runs the full configured suite at
committed build HEAD. Missing checks retain `no-checks-configured`. Checked and
reviewed holds, stop/reopen, retained edits, stale-input/commit rejection,
completion replay and ownership guards continue to apply.

### Blockers

A blocker fails the round.

| Blocker | When |
| --- | --- |
| `build-not-ready` | build record is not an effective READY |
| `build-commit-mismatch` | `build.md` COMMIT differs from HEAD |
| `checks-failed` | the configured checks did not all pass |
| `checks-commit-mismatch` | `checks.json` was not run at HEAD |
| `review-<lens>-changes` | a lens is CHANGES, malformed or missing. Keys are `review-code`, `review-ux`, `review-ui`, `review-security`, `conformance` |
| `review-<lens>-stale` | a record's COMMIT differs from HEAD |
| `worktree-dirty` | `git status --porcelain` in the worktree is not empty |
| `no-changes` | the diff against the base commit is empty |
| `plan-digest-changed` | `plan.json` changed after it was pinned |
| `review-human-changes` | a rework note exists in this round |

### Flags

A flag does not fail the round. It means a human must look.

| Flag | When |
| --- | --- |
| `no-checks-configured` | the target has no checks |
| `escalate-path:<path>` | a changed file matches `escalatePaths` |
| `easy-tier-too-many-files` | tier is EASY or BULK and changed files exceed `easyTierMaxFiles` |
| `touches-outside-plan:<path>` | a changed file matches none of `plan.touches` |

### Outcomes

| Gate result | What happens |
| --- | --- |
| Pass, no flags | The approver is dispatched. APPROVE gives `ready`. ESCALATE gives `needs-human` |
| Pass, flags | `needs-human`. The approver is not dispatched |
| Blockers, within caps | The next round opens and a fresh builder gets the findings and failing check tails |
| Blockers, past a cap | `needs-human` with the bound as the reason |

The approver sees only records. It must ESCALATE, naming the rule, when: (a) a plan acceptance criterion has no evidence in `build.md`; (b) conformance lists a `missing`, `partial` or `added` stage whose justification does not explain the deviation; (c) `build.md` deviations and `conformance.md` disagree; (d) it cannot verify something from the records. It never edits code and never reruns checks.

## Reopening a stopped job

A stopped job keeps its plan, dispatch history, branch, worktree and whatever the interrupted agent left uncommitted. `stop` records `stoppedFrom` and an optional note verbatim in its `human` history entry. Without a note, that entry keeps the existing empty string. The status reason and aborted dispatch notes remain "stopped by human". `reopen` is the way back, from `stopped` only.

```bash
sociotechnic/bin/sociotechnic reopen 20261023-add-a-login-page
```

1. **Status.** The job returns to `stoppedFrom`. For a job stopped before that field existed, sociotechnic derives it from the last dispatch: `plan` gives `planning`, `research` gives `researching`, `build` gives `building`, `review` gives `reviewing`, `approve` gives `approving`. No dispatch gives `new`.
2. **Worktree.** It must exist. When it is missing and the branch exists, sociotechnic recreates it with `git worktree add`, as `restore` does. When the branch is gone too, `reopen` fails with `no-branch`.
3. **Uncommitted changes.** They are kept and listed in the result as `files`. Untracked files count. `--discard` runs `git checkout -- .` and `git clean -fd` in the worktree first.
4. **Record.** A `human` entry `{ action: "reopen", note: "kept" | "discarded" }` is appended and the job change is committed to the database.

Nothing else changes. The dispatches the stop aborted stay `failed` with the note "stopped by human", so the next `step` retries the interrupted step as the next attempt. That attempt counts against `retriesPerStep`. A job already past that bound parks as `needs-human`, and you `override` it like any other retry.

When changes were kept, the retry block of the builder's brief says so and lists the files. The builder inspects them, keeps what is sound and commits before it writes its record. This is the one exception to the builder's clean-tree rule. A build attempt you [interrupted](#interrupted-dispatches) is retried the same way.

In the React console, the decision bar for a `stopped` job offers Reopen run and Remove worktree (Remove sandbox and worktree for a Docker Sandbox run). Reopen keeps uncommitted changes by default; the confirmation dialog offers an explicit Discard uncommitted changes choice for local runs and sends that choice as `discard`. `/legacy`, `reopen <job> --discard` and `POST /api/jobs/:id/reopen` with `{ "discard": true }` retain the same behavior. In a session, type `/sociotechnic reopen <job>`, then `run` through either skill's shared console driver.

## Loop bounds

Every bound is enforced by the engine. Past a bound the job moves to `needs-human` with a reason.

| Bound | Default | Counts | Reason when hit |
| --- | --- | --- | --- |
| `rounds` | 3 | build + checks and, when passing, reviews (+ approver) cycles | `loop-bound:rounds` |
| `dispatchesPerRound` | 10 | every agent spawn in a round, including retries. Plan and research count in round 0 | `loop-bound:dispatchesPerRound` |
| `retriesPerStep` | 1 | re-dispatches of one step after a malformed, stale, failed, timed-out or interrupted record | `retry-bound:<step>` |

- **Retries.** A retry spawns a fresh agent as `attempt + 1`, with the reason in its brief.
- **Timeouts.** Each dispatch has `deadlineAt = startedAt + role timeout` (see the roles table). `step` reports overdue dispatches as `stop`. The driver stops them and calls `finish --outcome timeout`, which counts as a failed attempt. With a [local concurrency limit](cli-reference.md#local-concurrency-limit), time spent waiting for a slot counts too: a dispatch whose deadline passes in the queue is recorded `timeout` with the note "deadline reached while waiting for a local dispatch slot" and never launches.
- **Interrupts.** An interrupted dispatch counts as a failed attempt, the same as one a stop aborted. See [Interrupted dispatches](#interrupted-dispatches).
- **Overrides accumulate.** Effective cap = `caps[bound]` plus the number of overrides for that bound. Overrides never reset. `rework` grants one `rounds` override after a build, or one `retriesPerStep` override for a failed round-zero planner with no pinned plan. Planning feedback stays in human history and the next planner brief; the console holds again at `planned`.
- **No resume.** No agent is ever resumed. Every dispatch gets a generated brief that names files to read and inlines only what is small: the changed-files list, CHANGES findings, failing check tails, the retry reason.

```bash
sociotechnic/bin/sociotechnic override 20261023-add-a-login-page rounds 'one more pass is fine'
```

### Interrupted dispatches

`interrupt <job> <dispatch> [note]` (or the console route) ends one unfinished
dispatch. The engine records:

| Field | Value |
| --- | --- |
| `dispatches[].outcome` | `"interrupted"` |
| `dispatches[].note` | your trimmed note, or `null` |
| `dispatches[].parsed` | the record parsed as `finish` does; usually malformed, since the agent stopped early |
| `human[]` | `{ action: "interrupt", note: "<dispatch>" }` or `{ action: "interrupt", note: "<dispatch>: <note>" }` |

Status, the plan, gates and the other dispatches do not change. Only `interrupt`
records this outcome; `finish --outcome interrupted` is refused.

Retry accounting follows the stop rule. When the step's other dispatches settle,
the next `step` re-dispatches the interrupted step as `attempt + 1` with the
retry reason `interrupted by human: <note>`, and that attempt counts against
`retriesPerStep` and `dispatchesPerRound`. With the default `retriesPerStep` of
1, a second interrupt of the same step parks the job:

```text
retry-bound:plan (1 + 0 overrides): interrupted by human
```

To keep another attempt, raise the bound before it trips. `override` is accepted
in any non-terminal status and changes status only at `needs-human`:

```bash
sociotechnic/bin/sociotechnic override 20261023-add-a-login-page retriesPerStep 'one more research attempt'
```

Interrupting is refused for a finished or unknown dispatch and for Docker Sandbox
runs (`sandbox-interrupt`), because their dispatches share one sandbox.

## Configuration

### `.sociotechnic.json`

Optional, at the target repo root. Missing keys take their defaults. The example below configures `npm test`; the actual default is no checks (`[]`). `sociotechnic init` writes this structure with checks detected in your target repo.

```json
{
  "checks": [
    { "name": "test", "run": "npm test", "timeoutSeconds": 600 }
  ],
  "lenses": {
    "reviewer-code":     { "paths": ["**"] },
    "reviewer-security": { "paths": ["**"] },
    "conformance":       { "paths": ["**"] },
    "reviewer-ux":       { "paths": ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/*.css", "**/*.scss", "**/ui/**", "**/components/**", "**/pages/**", "**/app/**"] },
    "reviewer-ui":       { "paths": ["**/*.tsx", "**/*.jsx", "**/*.vue", "**/*.svelte", "**/*.css", "**/*.scss", "**/ui/**", "**/components/**", "**/pages/**", "**/app/**"] }
  },
  "escalatePaths": [".github/**", ".forgejo/**", "**/.env*", "**/auth/**", "**/secrets/**", "package-lock.json"],
  "easyTierMaxFiles": 8,
  "caps": { "rounds": 3, "dispatchesPerRound": 10, "retriesPerStep": 1 }
}
```

| Key | Default | Rule |
| --- | --- | --- |
| `checks` | `[]` | Run in the worktree, in order. Each needs a non-empty `name` and `run`. `timeoutSeconds` defaults to 600 and must be positive. Empty or missing is allowed but flagged `no-checks-configured` |
| `lenses.<name>.paths` | see above | Globs. A lens runs only if a changed file matches. Otherwise the engine writes a SKIPPED record. Known lenses: `reviewer-code`, `reviewer-ux`, `reviewer-ui`, `reviewer-security`, `conformance`. An unknown name is an error |
| `escalatePaths` | see above | A changed file matching any glob raises the `escalate-path:<path>` flag |
| `easyTierMaxFiles` | 8 | Integer, 0 or more. Above it, an EASY or BULK job raises `easy-tier-too-many-files` |
| `caps.rounds` | 3 | Integer, 1 or more |
| `caps.dispatchesPerRound` | 10 | Integer, 1 or more |
| `caps.retriesPerStep` | 1 | Integer, 0 or more |

Globs support `**`, `*` and `?`, matched against repo-relative paths with forward slashes. `**` alone matches everything. A malformed file fails with code `bad-config`.

`sociotechnic init` detects checks from `package.json` scripts (`typecheck`, `lint`, `test`, `build`, run as `<runner> run <script>` with `pnpm`, `yarn`, `bun` or `npm` chosen by lockfile), `deno.json` or `deno.jsonc` (`deno task test` or `deno test`), `Cargo.toml` (`cargo test`), `go.mod` (`go test ./...`) and `pyproject.toml` (`python -m pytest`).

### Environment

| Variable | Effect |
| --- | --- |
| `SOCIOTECHNIC_HOME` | Overrides the engine home. By default it is the directory two levels above `sociotechnic/src/cli.ts`, which is this repo root. Staging, runtime files and worktrees go under `$SOCIOTECHNIC_HOME/.sociotechnic/`; jobs and records live in PostgreSQL |
| `SOCIOTECHNIC_API_URL` | Development only: use an existing loopback HTTP API with `task dev`, starting only Vite and clearing only port 5173 |
| `SOCIOTECHNIC_RUNNER` | Console runner. `fake` selects the test runner. Unset uses the Claude Agent SDK runner |
| `SOCIOTECHNIC_FAKE_AGENT` | With `SOCIOTECHNIC_RUNNER=fake`: path of a script run as `<script> <agent> <prompt-file>` for each dispatch. Exit 0 is `ok`, non-zero is `failed` |
| `SOCIOTECHNIC_CLAUDE` | Overrides the SDK's `pathToClaudeCodeExecutable`. Otherwise the SDK resolves its own, then `claude` on PATH |
| `SOCIOTECHNIC_CLAUDE_CONFIG` | Path of the Claude config file the SDK driver reads `mcpServers.context7` from. Default `~/.claude.json`. A missing entry logs a `warn` and the dispatch runs without Context7 |
| `SOCIOTECHNIC_LOCAL_MAX_DISPATCHES` | Fixes the local concurrency limit (an integer from 1 to 64) for every console of this installation and makes `POST /api/local/capacity` refuse changes. Unset uses `.sociotechnic/local-settings.json`, or no limit when that file is absent. See [local concurrency limit](cli-reference.md#local-concurrency-limit) |
| `SOCIOTECHNIC_DATABASE_URL` | State-store connection URL. Default `postgres://localhost:5433/sociotechnic`. Passwords are redacted when the URL is printed. The value `off` disables database access and makes job operations fail; it does not enable a file-backed job mode. |
| `SOCIOTECHNIC_TEST_DATABASE_URL` | Tests only. When set, `dbpg.test.ts` runs against that server in a throwaway database. Unset skips it |
| `SOCIOTECHNIC_TIMEOUT_MINUTES_OVERRIDE` | Tests only. Shortens every dispatch deadline |

## Console archive preferences

Driver ownership is separate from workflow status and archive visibility. The
database owner row identifies the process and, for UI drivers, its console URL.
Console APIs resolve this persisted owner instead of treating a server's empty
local driver registry as an idle run. Other same-host consoles can link to the
owner while all execution and takeover decisions remain protected by the existing
advisory lease. A known dead local process is an interrupted owner, not active
execution. See [cross-console ownership](cli-reference.md#safety-and-handoff)
for API states, refresh behavior and legacy location discovery.

Archive state is part of the PostgreSQL job document. Archive and unarchive
change visibility only: records, workflow status and active execution are kept.
The HTTP listing includes archived runs, and Show archived controls rail
visibility. Archive state survives staging loss and database backup/restore.

## Planning questions

When a human decision prevents an actionable plan, the planner can return
`{"status":"needs-input","questions":["..."]}` before or after research. The
engine enters `planning-input` with no pinned plan and no build round. The
console shows the questions and an Answer planner action. Your reply is saved
with its questions and dispatch ID in PostgreSQL, then a fresh planner runs to
the plan-review hold. Stale replies fail, and failed sends keep the draft.

The CLI exposes the pending questions and dispatch in `status <job>`. Reply with
`answer <job> <dispatch> <answer...>`, then `run <job> --hold planned`. Answers
do not lift bounds or change frozen agent releases. Follow-up questions count
toward the existing dispatch cap. Stop/reopen preserves pending questions.
Previously pinned plans are unaffected. Requested reviews may plan a written
report; an empty repository is not itself a reason to invent an integration.

## State store

PostgreSQL owns jobs, records, history, archive state, immutable agent releases
and run-to-release bindings. Spec: [CONTRACTS.md section 13](../CONTRACTS.md).

### Principle

CLI commands, HTTP handlers and the driver share `src/job-store.ts`. Each
operation reads a consistent database job/record snapshot. The engine uses the
scoped in-memory record session in `src/record-store.ts`; it does not consult
staging to decide job state. Mutations validate pinned releases and commit job,
records, bindings and derived events together. Failed persistence fails the
operation. There is no file fallback or local-over-database merge.

```mermaid
flowchart LR
  CMD["CLI, HTTP or driver"] --> OP["Database job operation"]
  OP <--> PG[("jobs, records, events<br/>releases and bindings")]
  PG --> IN["Dispatch input staging"]
  IN --> A["Agent"]
  A --> OUT["Assigned output staging"]
  OUT --> V["Validation and atomic ingestion"]
  V --> PG
```

### Connection

The connection URL is `SOCIOTECHNIC_DATABASE_URL`, default
`postgres://localhost:5433/sociotechnic`. Local PostgreSQL 17 uses port 5433;
port 5432 belongs to a different server on the maintainer's machine. Passwords
are redacted in diagnostic URLs. `off` is not an offline job mode. Pure tools
such as bundled-agent validation and verdict parsing can run without jobs.

### Database commands

<a id="db-commands"></a>

| Command | Purpose |
| --- | --- |
| `db init` | Apply the idempotent schema migration and immutable catalog bundles |
| `db status` | Report reachability and database counts; a diagnostic response may report `reachable: false` |
| `db import-jobs --dry-run --out <manifest> [--prefer-local]` | Inventory legacy job folders and database records before cutover |
| `db import-jobs --apply --manifest <file>` | Apply the reviewed, content-bound legacy import |
| `db catalog-export --out <file>` | Export every immutable agent release, including older and unused versions, to a migration bundle |
| `db catalog-check` | Compare the complete database catalog against the union of committed bundles |

Normal `db sync` is removed. Legacy import is a maintenance migration, not a
runtime fallback or a way to publish staging edits. Back up both the database
and legacy files before applying it. Resolve divergent job/record content before
cutover, preserve database-only records, and verify hashes and approval evidence
before retiring the old files. `--prefer-local` on the dry run records an explicit
local conflict choice in the manifest. Apply rejects unresolved conflicts; this is not an ongoing
overwrite policy. See the [migration plan](postgres-jobs-records-plan.md).

### Schema and transactions

[`src/db/schema.sql`](../src/db/schema.sql) is the authoritative schema. `jobs`
contains the canonical job document and derived searchable fields. `records`
contains one canonical `bytea` payload per logical record path; text and binary
previews retain their content bytes. UTF-8/base64 are transport forms only. `events` retains workflow history.
`agent_versions` stores immutable complete releases and `job_agent_versions`
binds each run to exact versions. Generated `job.json` views do not create a
second writable copy of job state.

Ownership is coordinated through PostgreSQL. Job mutations serialize and check
for changed state before commit. Agent execution and external Git operations
run outside database transactions. Ownership loss prevents stale completion
commits. Git effects cannot commit atomically with PostgreSQL; interrupted
operations must reconcile the observed branch, worktree or PR before retry.
Human gates and dirty-worktree protection still apply.

Job-write connections carry the writer epoch `sociotechnic.writer = 'jobs-v1'`;
the marker is reset before returning a connection to the pool. Database guards
reject old runtime writes without it; old drivers still must be stopped before
cutover. This protects the application boundary without changing global
PostgreSQL administration roles.

### Listing and recovery

`jobs [--project <name|path>] [--status <s>] [--limit <n>]` and `projects` read
PostgreSQL only. Missing staging does not hide a job. A database outage returns
an error rather than an empty list or old file snapshot. Worktree availability
is separate from record availability.

`restore <job>` and `POST /api/jobs/:id/restore` recreate a missing Git worktree
when the repository and job branch still exist. They use the same `restoreJob`
operation, job-operation boundary and driver coordination locks. Active drivers,
foreign owners and stored interrupted ownership refuse restoration until
ownership is stopped or reconciled. They do not dispatch agents, change the human
gate/status or overwrite job records; there is no force mode. The HTTP body is
empty, success is `{ job, worktree: "restored" | "present" }`, and a missing
repository/branch returns 409 `no-branch`. An already present worktree and repeated
requests are safe. The React Restore worktree action stays separate from Recover
worktree and continue. `resume` and `run` use the database job and
prepare dispatch staging as needed. They cannot recreate a missing repository,
branch or uncommitted edit from database records.

### Console updates

Details, record viewing, design previews, generated PR text and agent-library
history read the database. Committed changes publish database notifications;
the console refreshes current state after reconnect so missed notifications do
not leave stale evidence. SSE ping and transient live driver activity remain,
including `log` events for every driver line; those lines live only in the
console process that wrote them and are not job records.
Uncommitted staging changes do not become completed-record events.

## Interactive design

New design work uses `job.designSession`: generic ready, working, waiting,
interrupted, failed and approved states. Job statuses `designing` and
`design-input` describe execution and human waiting; they do not prescribe
Impeccable's design phases. Each human message resumes the exact SDK session.
No designer packet dispatch or automatic missing-tool retry is created.

The native agent's prompt comes from its Markdown file. Bash and Skill execute
the installed /impeccable command normally, including its own preview windows.
PostgreSQL retains native SDK transcripts, messages, images and returned work.
Driver leases guard writes. HANDOFF.md and samples return to the caller, which
decides the next step. Its snapshot binds `plan.designDigest` when used for
planning. Follow-up assignments and chat after handoff reuse the same session
without automatically advancing a build. Human waits suspend active deadlines.
Historical `job.design` packets remain supported for reading and approved
implementation integrity, not further packet generation.

The designer also handles follow-up remediation, escalation, complex UI work and
QA within its assignment. The console is an independently scrolling chat over
the existing native session, with image sharing and separate-tab samples and
prototypes. Initial returned work goes to the planner and remains held for plan
review. Builder prompts receive that same snapshot and digest; if later returned
work differs from the reviewed plan, building and review gates park for human
attention. A continued conversation does not implicitly replan or build.

See [interactive design](design-ceremony.md) for local installation, recovery,
images, Markdown handoff, native windows and separate live verification evidence.

## Agent library evidence and provenance

History and Agent library share the deployment, observation and checked-build
projections. History filters before paging inside a labelled cohort of at most
100 database runs. The response reports scan completeness, measured coverage and
exact source references; narrowing the filters can produce a complete cohort.
[The API reference](cli-reference.md#history-api) defines the filters and limits.
Daily series use actual completion dates; there is no usage interpolation or
unfinished-dispatch agent timer. Cache reads are a subset of total tokens.
Historical provider cost fields remain stored for compatibility; console usage
reports display recorded token categories and per-field coverage instead. Main
`usage` counters and per-model `modelUsage` pipeline totals are never added
together. Resumable snapshots may be cumulative; their sums are not deduplicated
session usage. Empty measurements remain null, and partial totals retain coverage.

New engine dispatches include optional `configuration` metadata: SHA-256 revision
of the role settings and definition bytes, plus observed provider/model/effort,
tools, skills and limits. Old jobs remain valid with version unrecorded unless
the operator explicitly confirms a baseline backfill.
`db backfill-agent-versions --before 2026-10-24T21:57:23.000Z` previews completed
unversioned calls through that UTC cutoff; add `--confirm` to apply. This records
`versionBackfill: { version: "1.0.0", source: "operator-confirmed", at, before }`
on each eligible dispatch, preserving recorded models, effort, usage and all
execution evidence. It does not fabricate a definition snapshot or change run
release pins. Live drivers, missing releases and incomplete history block it.
The database job document is updated transactionally; repeat runs leave existing
versions and attributions unchanged.

The library validates database releases and no longer checks for deleted agent files.
This records observed configuration, not frozen generated briefs, referenced skill
contents, model aliases or optional-service availability. PostgreSQL preserves
these snapshots alongside immutable releases and run bindings.

New `round.checks` references retain `configured` and failed check names,
categories and timeout flags. Categories derive from configured check names and
commands (typecheck, test, lint, build, general checks). Historical failures without
that metadata remain general checks. Library observations bind execution failures,
timeouts, interruptions, malformed records and re-asks directly to dispatches. Checks, review
findings and human rework attach only to the latest builder in the same round
with the same commit, explicitly as build context. They retain reporter and source
record; attribution does not establish causation. Feedback counts are report counts.
Interrupted calls have their own metric and observation category; they remain
separate from failed, timed-out, pending and completed calls. Valid CHANGES,
BLOCKED and ESCALATE results are not execution failures.

Global library profiles describe latest releases. In-run inspection combines
scoped deployment metrics with `/api/meta?job=<id>` pinned assignments and
configuration. A shared identity can have different per-role budgets; those
assignments remain visible. Missing pinned provenance does not substitute a
latest-release profile. Configuration cohort filters match workflow, tier,
model, effort, version and revision exactly before deployment paging. Metric
and category counts open the contributing source list; individual dispatches,
observations and feats link to their exact record. Superseded source paths remain
bound to the historical attempt, even when a newer record occupies its old path.

Comparisons group workflow, tier, actual model/effort and definition revision.
Missing timing/tokens stay unavailable with coverage counts; p90 uses nearest rank.
Cumulative agent time can overlap. Nested comment workers are not separately
counted. Feats recognize checked builds bound to an unflagged passing gate commit;
acceptance describes the run. No metric establishes accuracy or changes dispatch
policy. See [library API](cli-reference.md#agent-library-api) and the
[behavioral contract](../CONTRACTS.md#agent-library).

### Browser defaults and pinned run holds

Settings owns the browser preference `sociotechnic.new-run-holds.v1` through
`ui/web/src/run-preferences.ts`. It stores the new-run transition holds;
`planned`, `built`, `checked` and `reviewed` are the only accepted values.
An absent preference defaults to initial plan review. Invalid or unavailable
storage uses that fallback and displays a local message. Saving reports success only after browser storage accepts the value;
a failure leaves the prior stored defaults in place.

New run reads the preference on opening and sends optional `consoleHolds` to
job creation. Validation precedes repository initialization/publication and
job effects. The array is persisted in the canonical database job and remains
pinned for that run. The console always includes initial plan review. Continue
uses that run's holds except its current status, allowing the requested advance;
a one-run Controls hold overrides them for that start. Changing browser defaults
never edits existing jobs, CLI/global defaults or engine human gates. Jobs
without the optional field keep their previous continuation behavior. No schema
migration is required for this optional job-document field.

### Semantic agent releases

Add agent and Manage versions share grouped Claude and OpenAI/Codex choices for
planning, research, review, conformance, approval and ordinary build templates. Model selection
determines the provider. Codex requires fixed adapter tools, saved
ChatGPT authentication and account access to the selected model. Switching in the
form preserves effort when the new model supports it, otherwise uses high,
and restores fixed tools for Codex. The shared model table defines effort choices
for both editors and version validation; adapters forward the pinned effort. Design and Agent-worker
templates remain Claude-only. Publication never changes an existing run's pins.

PostgreSQL owns immutable releases in `agent_versions` and run bindings in
`job_agent_versions`. A release includes instructions, model, effort, tools,
limits, provenance fingerprints and, for custom identities, its fixed role template
and differentiation note. SQL rejects updates and deletions. The full database
backup includes every release, including agents never deployed.

Run `sociotechnic db init` after upgrading. It imports committed complete release
bundles from `seeds/agent-releases/*.json` into empty or existing catalogs.
Identical releases are a no-op; an existing identity/version with different
content aborts the transaction. Existing newer releases and run pins remain.
The bundles preserve complete definitions and configuration, including custom
agents and historical versions never used by a job. They are migration inputs,
not a runtime file fallback. Use Agent library's **Add agent** and **Manage
versions**, or their [HTTP APIs](cli-reference.md#agent-release-api), to publish.

After catalog changes, run `db catalog-export --out <new-bundle.json>` and
`db catalog-check` before committing. Check compares the union of bundles with
the whole database catalog and reports versions that have not traveled with the
code. Keep previously committed bundles immutable; export a new one for later
changes. `seeds/agents.json` retains the original initialization definitions and
is not a live agent editor. The removed `.claude/agents/sociotechnic-*.md` files
are no longer runtime inputs.

Strict numeric major.minor.patch order selects latest; prerelease/build metadata
is not supported. Use patch for corrections, minor for compatible capabilities,
and major for changed expectations. Roles retain the engine's record contract,
compatible provider/tool rules, guards and permission ceiling in every release. Custom agents must
review current peers and explain their distinct responsibility; identical
instructions are rejected. Import strips frontmatter permissions, hooks and skills.

New jobs pin every role in `agentVersions`, full settings/instructions in
`agentConfigurations`, and optional role-to-identity `agentAssignments`. New run
can explicitly select an eligible identity and an older release. Legacy jobs
without a map keep baseline settings. Each dispatch records the actual identity,
version, instructions and configuration. New dispatches validate the pinned
release against PostgreSQL and the binary's role contract; incompatible content
fails explicitly. Already running calls retain their frozen configuration.

The SDK executes programmatic definitions with explicit tools and the same guard
scripts. Nested workers use the run's pinned v1.0.0 definition. Codex readers stay
read-only; ordinary builders use their assigned worktree. Guard implementation remains binary code; catalog
backups do not include binaries, credentials, repositories or git objects.

`.sociotechnic/agent-versions/<agent>/<version>.json` is only a disposable cache.
Reads repair missing or changed cache files from the database. Job operations
validate required releases without treating their cache as authority. A normal
PostgreSQL backup/restore therefore preserves release identity with the run;
restore the application and git repositories separately as before. Back up the
whole database rather than selecting only the old jobs/records/events tables.

When PostgreSQL is unavailable, job and catalog operations fail; they never
fall back to disk. `SOCIOTECHNIC_DATABASE_URL=off` does not run jobs. Explicit
in-memory stores are test dependencies, not an alternate production store.

## Development cancellation history cleanup

`db clean-development-history --manifest <file>` previews an explicitly reviewed
JSON array of `{ job, cancelled, retry }` pairs. Add `--confirm` to apply and
optionally `--note <reason>`. It accepts only completed human cancellations with
missing/malformed output followed by the same agent's successful immediate retry.
Active or interrupted driver owners block maintenance. No date cutoff or future
cancellation is included automatically.

The canonical job document records the operator's reason and paired dispatch
annotations. Agent library metrics/history omit the cancelled deployment and
show its genuine successful retry as performance attempt 1, with no re-ask
observation. Original execution attempts, outcomes, usage, bounds, configurations,
gates and raw records remain unchanged; real failures and review findings remain
visible. Reapplying the same pairs is a no-op. Events retain maintenance provenance.

A legacy import manifest may contain `recoveries` with historical record bytes,
SHA-256 and provenance. The importer preserves replaced bytes under
`migration/unbound/`, records the recovery source, and validates the recovered
content against the original pinned plan/design/record evidence. Recovery cannot
change the job's pinned approval digest or manufacture a successful dispatch.

### Packaged infrastructure expertise

The [infrastructure expert](infrastructure-agent.md) provides optional planner and
builder identities at 1.0.0 using Sol/high. They share pinned Terraform and Docker
instruction skills. `skillResources` in an immutable release and its configuration
contains entrypoint/reference bytes; canonical content digests cover these bytes.
Both providers materialize them per dispatch and remove the copies afterward.
Reader tools can read those exact reference roots even when the target is another
repository. Skill snapshots do not grant shell, network, MCP servers or privileges.
Catalog export/import includes the snapshots and preserves existing run pins.

The bundled [team-writing skill](../skills/team-writing/SKILL.md) uses the same
immutable packaging for human-readable prose, with original Unslop and Technical
Writing references and licenses. New releases can append it through `addSkills`
without reloading older saved resources. Existing `skills` selection remains an
explicit replacement. Both fields cannot be supplied together; the combined
resources retain the same duplicate-name and payload bounds. Additions cannot
shadow existing native/configured skill names.

Ordinary Claude and Codex adapters load pinned entrypoints and expose their
reference roots. Nested Comment Sicko workers inherit the coordinator's snapshot.
Native designer queries materialize their run's resources outside the design
artifact workspace on initial invocation and resume, append them to the saved
native agent prompt, and remove the temporary copies after every query exit.
The native Markdown source, Impeccable, questions, transcripts and handoff gates
remain their existing owners. A retained pin without resources receives no writing
policy. Guidance preserves facts, uncertainty, code and exact record contracts;
it adds no hook, output filter, extra inference or tool authority.

### Raw SDK timing evidence

The Claude runner retains finite nonnegative result fields `duration_api_ms`,
`ttft_ms`, `ttft_stream_ms`, `time_to_request_ms`, `request_sent_wall_ms`,
`first_content_frame_ms`, `first_stream_post_ms`, `first_stream_post_ack_ms`,
`first_stream_post_queue_wait_ms`, `first_stream_post_wall_ms`, `first_text_post_ms`,
`first_text_post_queue_wait_ms`, `first_text_post_wall_ms`,
`time_to_request_from_spawn_ms` and `time_origin_ms` in existing dispatch usage.
Wall/origin fields are raw clocks, not elapsed latency; do not sum them or subtract
API duration to invent startup/model time. Existing `duration_ms`, issue-to-finish
measurements and token meanings remain. Missing values stay unknown and the
latest result replaces prior result evidence. On timeout or stream failure,
reported timing evidence already received is retained with observed elapsed time.
No UI projection or Codex collector changes are included.

### Verification-policy release compatibility

The additive [candidate bundle](../seeds/agent-release-candidates/20261025-focused-verification.json)
contains eleven new releases alongside 32 immutable historical releases in the
bundle union. [The inventory](evidence/workflow-integration/candidate-releases.json)
records exact versions and definition/content/bundle digests. Candidates are kept
outside `seeds/agent-releases/`, so console startup and `db init` do not import
them. Development has not imported them into a live catalog. Before promotion,
compare all candidate identities/versions with the target database. Publish
colliding improvements under fresh versions; preserve existing releases and pins.

| Run or operation | Instruction/configuration behavior | Engine behavior |
| --- | --- | --- |
| New run before candidate import | Current catalog latest | Installed engine |
| New/default or specialist run after authorized import | Candidate latest for the selected eligible identity | Installed engine |
| Explicit legacy version | Exact selected historical definition and its full-suite obligations | Installed engine |
| Existing or custom pinned run | Original definition, skills, budgets and configuration stay frozen | Next eligible unreviewed checked round uses installed routing |
| Review wave already issued | Saved dispatch envelopes and frozen definitions finish normally | Wait for every started sibling and compute normal gate |

Upgrading engine code is an operator-controlled action distinct from catalog
import. Hold/stop active drivers before changing binaries, back up the complete
PostgreSQL catalog and jobs plus Git repositories, and retain the previous binary.
Import candidates only through the normal authorized initialization/migration
flow; identical imports are no-ops, conflicts abort. Do not edit/delete immutable
history to roll back a release. New runs can explicitly select an older version;
existing pins remain. To roll back engine code, stop drivers and restore the prior
binary before resuming; do not rewrite already-issued envelopes or failed-round
evidence. Old code may buy reviews for a failed checked round, so review the saved
status before continuing. No live rollback, import or publication occurred here.
