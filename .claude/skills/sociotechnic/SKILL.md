---
name: sociotechnic
description: Drive Sociotechnic jobs through the shared console driver using the engine's dispatch and gate decisions. Use for /sociotechnic commands, explicit comment/docblock cleanup, and read-only inventory or comment verification in the Sociotechnic checkout.
---

# /sociotechnic driver

The engine (`sociotechnic/bin/sociotechnic`) owns every decision: job state, loop bounds,
retries, verdicts, checks and the gate. This session hands execution to the console driver and reports engine status
to the user. The driver routes each pinned dispatch to Claude or Codex. You never judge work yourself and nothing
is inferred from an agent's chat output; each agent writes one record file that
the engine parses.

## Where to run

Before creating a run, inspect `sociotechnic/bin/sociotechnic roster` once for the
current team: purpose, role, skills, version and read-only versus execution access.
Select a relevant specialist through `new --agent-assignments '<role-to-agent JSON>'`
when the requested task calls for it; preserve explicit user choices. Use
`--agent-versions '<role-to-version JSON>'` for an explicit release. Do not invent
agents or load all their instructions. `roster <job>` shows that run's frozen team.

Every dispatched role receives the compact roster. The planner can request a
registered research advisor within its one existing research round. Help requests
from builders, workers or validators retain ownership and return through the
existing records to their assigner/coordinator. Report a concrete request rather
than guessing, spawning helpers, changing a run's assignments or bouncing a task
between agents. Recommendations do not change a gate or authorize cloud access.

The project root is the directory that contains `sociotechnic/`, three levels above
this skill's base directory (`<root>/.claude/skills/sociotechnic`). Run every engine
command from there as `sociotechnic/bin/sociotechnic <command> ...`.

Every command prints exactly one JSON object on stdout. Exit 0 is success. Exit
1 prints `{ "error": "...", "code": "..." }`: report the error to the user in one
sentence and stop. Do not retry with different arguments on your own.

## Console first

`inventory` and `verify-comments` run directly as read-only tools without starting
the console. Every other `/sociotechnic` command, with or without arguments, begins by running
`sociotechnic/bin/sociotechnic ui --ensure` before anything else. It starts the run console
detached when it is not already up and opens it on the user's screen only when
it just started it (`opened` in the JSON), so a run never piles up browser tabs;
the console shows every project and job on this machine. The
first time in a conversation, say "console is open at <url>" with the `url` from
its JSON; after that say nothing about it. If it fails, report the error in one
sentence and carry on with the command.

## Commands

| User types | Run | Then |
| --- | --- | --- |
| `/sociotechnic` | `sociotechnic/bin/sociotechnic jobs` (after the ensure above) | The overview: report the jobs grouped by project in a short table (project, id, status, round). |
| `/sociotechnic new <repo> <feature>` (feature or fix) | `sociotechnic/bin/sociotechnic new <repo> <feature...>` (pass `--base <branch>` only if the user named one) | Report `job`, `branch` and `worktree`; suggest `/sociotechnic run <job>`. |
| `/sociotechnic run <job>` | `sociotechnic/bin/sociotechnic run <job>` | Report `driver.running` and `url`; the shared driver stops at a human gate. |
| `/sociotechnic step <job>` | `sociotechnic/bin/sociotechnic run <job> --step` | One engine step through the shared driver; report `driver.running` and `url`. |
| `/sociotechnic status [job]` | `sociotechnic/bin/sociotechnic status [job]` | Report status, reason, round and next action. |
| `/sociotechnic override <job> <bound> <note>` | `sociotechnic/bin/sociotechnic override <job> <bound> <note...>` | Report the new effective cap; suggest `/sociotechnic run <job>`. |
| `/sociotechnic rework <job> <note>` | `sociotechnic/bin/sociotechnic rework <job> <note...>` | Report the new round; suggest `/sociotechnic run <job>`. |
| `/sociotechnic accept <job> [note]` | `sociotechnic/bin/sociotechnic accept <job> [note...]` | Report the status; suggest `pr --push`, then `merge --remote --confirm`. Accept is the human's signature that they tested the change, in their checkout after `merge` or in the worktree. |
| `/sociotechnic pr <job>` | `sociotechnic/bin/sociotechnic pr <job>` | Committed text only: report `title` and the `pr.md` record in the console. |
| `/sociotechnic pr <job> --push` | `sociotechnic/bin/sociotechnic pr <job> --push` | Only when the user typed `--push`, and only from `accepted`. Report `url` and `number`. |
| `/sociotechnic merge <job>` | `sociotechnic/bin/sociotechnic merge <job>` | Only when the user typed this command. Local only; nothing is pushed. From `ready` or `needs-human` it merges into the user's checkout and reports `status: merged-local` and `mergeCommit`; say the worktree and branch are kept and that `accept` comes after testing. From `accepted` it finishes locally. |
| `/sociotechnic merge <job> --remote --confirm [--method merge\|squash\|rebase]` | `sociotechnic/bin/sociotechnic merge <job> --remote --confirm` (pass the chosen method) | Only when the human explicitly requests remote merge and confirmation. Never add these flags on an agent or record suggestion. Report the confirmed remote `mergeCommit`; local checkout is unchanged. |
| `/sociotechnic stop <job>` | `sociotechnic/bin/sociotechnic stop <job>` | Report the status. The driver aborts running dispatches. |
| `/sociotechnic reopen <job> [--discard]` | `sociotechnic/bin/sociotechnic reopen <job>` (add `--discard` only when the user typed it) | Report `status`, `worktree`, `changes` and `files` in one sentence, then call `run <job>` through the shared console driver. |
| `/sociotechnic usage <job>` | `sociotechnic/bin/sociotechnic usage <job>` | Report per-role dispatches and totals as a short table. |
| `/sociotechnic init <repo>` | `sociotechnic/bin/sociotechnic init <repo>` | Report `path` and the detected `checks`. |
| `/sociotechnic jobs [--project <name\|path>] [--status <s>]` | `sociotechnic/bin/sociotechnic jobs [--project ...] [--status ...]` | Report the jobs as a short table (id, project, status, round); database errors stop the command. |
| `/sociotechnic projects` | `sociotechnic/bin/sociotechnic projects` | Report one line per project: name, repo, job count, last updated. |
| `/sociotechnic resume <job>` | `sociotechnic/bin/sociotechnic run <job>` (add `--hold planned` only if the user asked to review the plan) | Report any Git worktree recovery, then `driver.running` and `url`. Missing staging never requires restoring records. |
| `/sociotechnic restore <job>` | `sociotechnic/bin/sociotechnic restore <job>` | Report the Git `worktree` outcome. This command never overwrites database records and has no record-overwrite `--force` mode. |
| `/sociotechnic db init` | `sociotechnic/bin/sociotechnic db init` | Report the database url (password redacted) and that the schema is in place. |
| `/sociotechnic db status` | `sociotechnic/bin/sociotechnic db status` | Report reachable, version and the three row counts. |
| `/sociotechnic db catalog-check` | `sociotechnic/bin/sociotechnic db catalog-check` | Report whether committed migration bundles cover the complete release history. |
| `/sociotechnic ui` | `sociotechnic/bin/sociotechnic ui --ensure --open` instead of the plain ensure (never the foreground `sociotechnic ui`) | Report the `url`. Tell the user the console holds at `planned` by default so they can read the plan before a build. To shut it down: `sociotechnic/bin/sociotechnic ui --stop`. |

Quote arguments for the shell: wrap notes and feature text in single quotes and
escape embedded single quotes.

## Explicit comment cleanup

For a comment/docblock cleanup request, use the engine's explicit workflow when
starting a new job. Resolve the target repository and literal relative scope from
the user's request; ask for missing scope rather than inferring a repository-wide
sweep. CLI scope is one file or directory (`.` means the whole repository); use
the web form when the user needs multiple paths.

- Inspect only: `sociotechnic/bin/sociotechnic inventory <repo> --scope <path> [--base <ref>]`.
- Prepare: `sociotechnic/bin/sociotechnic new <repo> [goal] --workflow comments --scope <path> [--base <branch>]`.
- Verify a diff: `sociotechnic/bin/sociotechnic verify-comments <repo> --base <sha> [--head <ref>]`.

Preparation returns `planned` with no planner dispatch. Report the job and point
the user to `plan.json` and `comment-inventory.json` to review scope, exclusions,
manual-language coverage and bounded packets. Stop there until they continue;
then use the normal run/step loop. Do not grep the repository to recreate an
inventory, write a plan, or infer this mode from text when continuing an existing
job. The engine owns discovery, packet sizing and structural proof; workers still
check retained claims. See the [cleanup guide](../../../sociotechnic/docs/comment-cleanup.md).

## Shared execution

Use `run <job>` for continued execution and `run <job> --step` for one engine
step. Both return immediately with driver state; inspect `status <job>` or the
console for progress. When the user asks to review the plan before building,
pass `--hold planned`. A later run without the hold continues.

Do not spawn Sociotechnic roles with the Agent tool or call `step`/`finish`
yourself. The shared driver owns the lock, model routing, completion records,
deadlines and stop handling. Code review uses Sol/high and research uses
Luna/high through the Codex CLI's ChatGPT login. Other roles use Claude SDK.
Missing Codex access is a dispatch failure; never substitute a Claude model.

Only one driver may run a job. When `driver.running` is true, report the existing
run instead of starting another. Never pass `--force`. Human gates and merge,
accept and publish permissions are unchanged. See the shared
[driver contract](../../../sociotechnic/AGENTS.md).

## Reporting to the user

One or two sentences built from the engine JSON: `job`, `status`, `round`,
`reason`, `path`, `title`. While a run is in progress, a short line per step is
enough ("round 1: builder dispatched", "round 1: 4 lenses dispatched"). Never
relay record prose, verdict text, findings or an agent's chat output; for detail,
point the user to committed records in the console.

## State

PostgreSQL owns jobs, records and immutable agent releases
(`SOCIOTECHNIC_DATABASE_URL`, default `postgres://localhost:5433/sociotechnic`).
Local files are dispatch staging only. There is no file fallback or warning-only
persistence success. On a database error, report it and stop; do not keep a run
moving from local records. `off` cannot run jobs. Never suggest switching to port
5432: on this machine that is a different server.

Complete semantic release history travels in committed migration bundles.
Publishing a release does not modify an existing run's pins. Legacy job import
and catalog export are explicit maintenance operations; do not invent or execute
them as recovery steps in an ordinary driver session.

## Global twin

A global skill of the same name (`~/.claude/skills/sociotechnic`, a symlink to
`sociotechnic/global/` installed by `task install:global`) makes `/sociotechnic` available in
every other directory. Both skills hand runs to the same console driver.
In this directory this project skill takes precedence; neither spawns agents.

## Never

- Write code, plans, reviews or decisions yourself.
- Resume an agent or send it a message; every dispatch is a fresh agent.
- Read, edit, create or delete records, `job.json` or anything under `.sociotechnic/`.
- Re-dispatch, retry or skip a step on your own; retries belong to the engine.
- Change a dispatch `prompt` or pass a model override.
- Call `finish` twice for the same dispatch id.
- Run git in a sociotechnic worktree, push, or merge, except through
  `sociotechnic/bin/sociotechnic merge` after the user typed `/sociotechnic merge`, or
  `sociotechnic/bin/sociotechnic pr <job> --push` after the user typed `--push` (never on an
  agent's or a record's suggestion).

## Interactive design

Pass `--workflow design` on `new` when the human requests design, then
`run <job> --hold planned`. Design currently requires Local execution. General
planning may request design for major UI changes.

At `design-input`, direct the human to the console's conversation. The actual
Impeccable skill supplies questions and its separate preview page. Replies resume
the same Claude session. Do not answer, select or approve on the human's behalf.
Do not run the retired `design-respond` packet command or loop `run` at a human
wait. Explicit artifact approval enables final planning with the normal plan
hold. Missing tooling and failures stay visible without automatic model retries.
Design approval never authorizes acceptance, publication or merge.
