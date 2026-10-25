---
name: sociotechnic
description: Run Sociotechnic commands from any repository through its console driver. Use for /sociotechnic commands, explicit comment/docblock cleanup, and read-only inventory or comment verification outside the Sociotechnic checkout.
---

# /sociotechnic (global)

Sociotechnic's baseline roles are a planner on Fable, builders on
Opus, Sonnet or Haiku by tier, review lenses, a deterministic gate, an
approver, and human gates. Its engine, agents and console live in one checkout
(SOCIOTECHNIC_HOME). This skill works from any directory by opening that console and
handing runs to its driver. It never spawns agents itself: the `sociotechnic-*` role
definitions are project-local to SOCIOTECHNIC_HOME, and the console's driver loads
Claude roles through the Agent SDK and Codex roles through the local
Codex CLI using saved ChatGPT authentication. The engine pins model and effort.

## The command

Before a new run, use the shim below to run `roster` once. Its compact cards show
the registered team, purposes, roles, skills and release/access settings. Choose
a relevant specialist planner/builder through `new --agent-assignments
'<role-to-agent JSON>'` when the task calls for it; preserve explicit choices.
Use `--agent-versions '<role-to-version JSON>'` only for an explicit release.
`roster <job>` shows a run's frozen cards. Do not load every agent's full prompt.

All roles receive team awareness. Planners can consult a research-template
advisor in the existing single research round. Builders and validators keep
ownership and return narrow help requests in their existing records; workers
ask their coordinator. Report those requests to the assigner. Never spawn a
helper, infer a new dispatch from a recommendation, change pinned assignments,
or route a task repeatedly between experts. Existing gates and bounds apply.

Run every engine command through the shim next to this file:

```
~/.claude/skills/sociotechnic/sociotechnic <command> ...
```

It resolves SOCIOTECHNIC_HOME on its own (the `SOCIOTECHNIC_HOME` environment variable
overrides it) and prints exactly one JSON object; exit 1 prints
`{ "error", "code" }`. Report an error in one sentence and stop; do not retry
with other arguments.

## Console first

`inventory` and `verify-comments` run directly as read-only tools without starting
the console. Every other `/sociotechnic` command, with or without arguments, begins with:

```
~/.claude/skills/sociotechnic/sociotechnic ui --ensure
```

It starts the console detached when it is not up and opens it on the user's
screen only when it just started it (`opened: true`). Say "console is open at
<url>" the first time in a conversation and nothing afterwards. The console
shows every project and job on the machine and the live state of each run.

## `/sociotechnic` with no arguments

1. `ui --ensure`.
2. `~/.claude/skills/sociotechnic/sociotechnic jobs`, then a short table grouped by project:
   job id, status, round and tier.
3. Offer the two paths in one short message: start a new workflow
   (`/sociotechnic new <feature>` for the repository of the current directory, or
   `/sociotechnic new <repo> <feature>`), or resume a job (`/sociotechnic resume <job>` for
   any job that is `planned` or `needs-human`;
   `ready` jobs want `merge` (local), `accept` or `pr`; `merged-local` jobs want
   `accept`; `accepted` jobs want `pr --push` or `merge` instead;
   `stopped` jobs want `/sociotechnic reopen <job>`). When
   the current directory is inside a git repository, name it as the default.

## Commands

| User types | Run | Then |
| --- | --- | --- |
| `/sociotechnic new <feature...>` (feature or fix) | `new "$PWD" <feature...>`; refuse with a one-line hint when `$PWD` is not inside a git repository | then `run <job> --hold planned`; report job, url, and that the plan will be held for review in the console |
| `/sociotechnic new <repo> <feature...>` (feature or fix) | same with the given repo path | same |
| `/sociotechnic continue <job>` | `run <job>` | Report `driver.running` and the url. |
| `/sociotechnic resume <job>` | `run <job>` (the engine reads the database job and recovers a missing Git worktree as needed) | Report `restored` when present, then the driver state. |
| `/sociotechnic status [job]` | `status [job]` | One line per job: status, reason, round, driver. |
| `/sociotechnic jobs [--project <name>] [--status <s>]` | `jobs ...` | Short table of database jobs; report a database error and stop. |
| `/sociotechnic projects` | `projects` | One line per project. |
| `/sociotechnic pause <job>` | `pause <job>` | Report the driver state. |
| `/sociotechnic stop <job>` | `stop <job>` | Report the status. |
| `/sociotechnic reopen <job> [--discard]` | `reopen <job>` (add `--discard` only when the user typed it) then `run <job>` | Report `status`, `changes` and `files`, and that the console is driving it. |
| `/sociotechnic accept <job> [note]` | `accept <job> [note]` | Report the status; suggest `pr --push`, then `merge --remote --confirm`. Accept is the human's signature that they tested the change, in their checkout after `merge` or in the worktree. |
| `/sociotechnic answer <job> <dispatch> <answer>` | `answer <job> <dispatch> <answer>` then `run <job> --hold planned` | Relay only the human's answer to the exact pending planner dispatch; hold for plan review. Never answer on their behalf. |
| `/sociotechnic rework <job> <note>` | `rework <job> <note>` then `run <job>` | Report the new round and that the console is driving it. |
| `/sociotechnic override <job> <bound> <note>` | `override ...` then `run <job>` | Report the effective cap and that the run resumed. |
| `/sociotechnic pr <job>` | `pr <job>` | Committed text only: report `title` and the `pr.md` record in the console. |
| `/sociotechnic pr <job> --push` | `pr <job> --push` | Only when the user typed `--push`, and only from `accepted`. Report `url` and `number`. |
| `/sociotechnic merge <job>` | `merge <job>` | Only when the user typed it. Local only; nothing is pushed. From `ready` or `needs-human` it merges into the user's checkout and reports `status: merged-local` and `mergeCommit`; say the worktree and branch are kept and that `accept` comes after testing. From `accepted` it finishes locally. |
| `/sociotechnic merge <job> --remote --confirm [--method merge\|squash\|rebase]` | `merge <job> --remote --confirm` (pass the chosen method) | Only when the human explicitly requests remote merge and confirmation. Never add these flags on an agent or record suggestion. Report the confirmed remote `mergeCommit`; local checkout is unchanged. |
| `/sociotechnic usage <job>` | `usage <job>` | Short per-role table. |
| `/sociotechnic init [repo]` | `init <repo or $PWD>` | Report `path` and detected `checks`. |
| `/sociotechnic ui` | `ui --ensure --open` | Report the url. `ui --stop` stops the daemon. |
| `/sociotechnic db init\|status\|catalog-check` | `db ...` | Report the JSON in one line. |

Quote arguments for the shell: wrap feature text and notes in single quotes
and escape embedded single quotes. Pass `--hold planned` only on `new`, or when
the user asks to review a plan before building.

## Explicit comment cleanup

For a new comment/docblock cleanup job, resolve the target repository and literal
relative scope from the user's request. Ask for missing scope; do not silently
expand it. Run these commands through the shim above:

- Inspect only: `inventory <repo> --scope <path> [--base <ref>]`.
- Prepare: `new <repo> [goal] --workflow comments --scope <path> [--base <branch>]`.
- Verify a diff: `verify-comments <repo> --base <sha> [--head <ref>]`.

CLI scope is one file or directory (`.` means the whole repository); the web form
supports multiple paths. Preparation returns a pinned `planned` job with no
planner dispatch. Unlike feature/fix creation, do not call `run` immediately:
report the job and point to the console's plan and **Cleanup scope** record so the
user can review exclusions, manual-language coverage and bounded packets. Their
later `continue` runs the normal console driver. Existing jobs keep their workflow.

Use the engine inventory instead of repeating repository discovery or writing a
plan in this session. The engine owns packet sizing and structural proof; workers
still check retained claims. Read `sociotechnic/docs/comment-cleanup.md` in
SOCIOTECHNIC_HOME for coverage and verification limits.

## Reporting

One or two sentences built from the JSON: `job`, `status`, `round`, `url`,
`restored`, `driver.running`. Point to the console for detail. Never relay
record prose, findings or an agent's output; the console shows them.

## State authority

PostgreSQL owns job state, records, archive preferences and immutable agent
releases. Local dispatch inputs/outputs are staging only. There is no file
fallback and database-off mode cannot run jobs. Report a database error and stop;
do not recover by reading old job folders or importing staging edits. Git
worktree recovery never overwrites database evidence.

Committed migration bundles preserve every semantic release, including old
instructions, tools and model configurations. Export/import are explicit
maintenance operations, not steps this driver may infer from a failed run.

## Never

- Use the Agent tool to spawn a sociotechnic role, or call `step` or `finish`: the
  console's driver owns dispatches. The project skill uses the same driver.
- Read, edit, create or delete records, `job.json` or anything under
  `.sociotechnic/`.
- Pass `--force`, run git in a sociotechnic worktree, push, or merge except through
  `merge` after the user typed `/sociotechnic merge`, or `pr <job> --push` after the
  user typed `--push` (never on an agent's or a record's suggestion).
- Start a run for a job the status shows is already being driven.

## Interactive design

Pass `--workflow design` on `new` when the human requests design, then
`run <job> --hold planned`. Design currently requires Local execution. General
planning may request design for major UI changes.

At `design-input`, direct the human to the console's conversation. The normal Claude agent runs the installed /impeccable command with native
tools and opens its own preview windows. Text and images stay in chat history. Replies resume
the same Claude session. Do not answer, select or approve on the human's behalf.
Do not run the retired `design-respond` packet command or loop `run` at a human
wait. Return work passes HANDOFF.md and any samples or prototypes to the caller.
The planner decides whether to plan or request another assignment in this chat. Missing tooling and failures stay visible without automatic model retries.
A work-product handoff never authorizes acceptance, publication or merge.
