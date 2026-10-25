# Working on Sociotechnic

These instructions apply to development of `sid-newby/sociotechnic` (Sociotechnic),
including its worktrees. They do not set policy for other repositories that
Sociotechnic runs against.

## Find and reuse the existing tools

The root [README](README.md) is the web-console user guide. Before adding or
changing an ability, read the relevant technical reference and trace the existing
implementation and tests. Reuse the engine commands, HTTP routes and helpers
already available rather than building a parallel workflow.

| Reference | Read it for |
| --- | --- |
| [CLI and driver reference](sociotechnic/docs/cli-reference.md) | Existing commands and flags, HTTP API, console lifecycle, publishing, driver locks and handoff |
| [Engine and state reference](sociotechnic/docs/engine-reference.md) | Roles, tiers, record formats, gate rules, bounds, configuration, database sync and restoration |
| [Local setup and development](sociotechnic/docs/development.md) | Source map, tasks, checks, dependencies and local runtime |
| [Comment cleanup](sociotechnic/docs/comment-cleanup.md) | Existing cleanup coordinator, workers, scope and verification requirements |
| [Behavioral contracts](sociotechnic/CONTRACTS.md) | Engine and agent specification; update it before changing behavior, then update implementation and tests |
| [Driver contract](sociotechnic/AGENTS.md) | How the console and session drivers execute engine decisions and observe human gates |

Preserve record validation, commit binding, driver locks, loop bounds and human
gates when extending existing tools. Run the checks appropriate to the change as
documented in the development reference. Keep command and implementation details
in `sociotechnic/docs/`; keep the root README focused on the web experience.

## Keep documentation and the map current

For each feature, removed capability or moved entry point, assess its impact on
the behavioral contracts, CLI/API reference, engine/state reference and the
[feature-to-code map](sociotechnic/docs/development.md#feature-to-code-map).
Include affected documents in the plan's `docsImpact`, stages and allowed file
scope, and update them in the same change as the implementation. Internal moves
can require map and link updates even when behavior is unchanged.

Keep `CLAUDE.md` as the short navigation entry point and the development guide as
the detailed source map. Verify named files, commands, routes and checks against
the current checkout before claiming they exist. When a reference is stale, trace
the implementation and repair the reference; do not build a duplicate tool from
an incomplete map. Explain a no-documentation-impact decision in the plan.

## Branch cleanup for this repository

After an authorized merge, synchronize `main` and verify the merged work is on
`origin/main`. Delete the completed remote feature branch, prune stale tracking
refs, and delete its local branch when no active worktree needs it. Finish on a
clean, synchronized `main` unless the task requires ongoing branch work.

- GitHub's automatic head-branch deletion is enabled for this repository. Verify
  deletion after a PR merge; direct git merges still require explicit cleanup.
- Fetch before checking merge status. For ordinary merges, verify the branch tip
  is an ancestor of `origin/main`. For squash or rebase merges, inspect the merged
  PR and any commits added afterward before deciding that deletion is safe.
- Keep branches with unmerged work, an open PR, or an active follow-up. Never
  delete `main`, the default branch, or another long-lived or protected branch.
- Use safe local deletion (`git branch -d`), and do not remove a worktree or its
  uncommitted changes just to delete a branch.
- Retire completed worktrees as well as branches once their work is committed,
  synchronized and verified merged. Preserve active runs and worktrees still
  needed for testing, rework or reopening. This applies only to this project;
  never clear worktrees merely because a scan encountered them.
- Base cleanup decisions on Git state and actual runtime use, not chat or thread
  association. A chat attached to a worktree does not by itself make it active.
  The primary checkout means Git's actual primary checkout, not an app's label
  for the current chat folder. Never remove Git's primary checkout.
- A process merely having a worktree as its working directory does not establish
  that the worktree is needed. Identify the process and its parent/children,
  then check actual jobs, tests, service clients, open project files and sandbox
  state. An idle tool helper or unused daemon is not a reason to retain a
  completed worktree indefinitely. Low CPU use or a listening port alone does
  not settle whether a process is needed.
- Stop verified leftovers gracefully through their service's shutdown command,
  or send SIGTERM to exact, freshly verified helper PIDs. Check shared services
  for other consumers first; do not stop unrelated applications, databases or
  active work, and never use broad process-name kills. Recheck that the processes
  exited and the worktree is still clean before removing it. If a dependency is
  genuinely unresolved, report the specific process and work it may serve rather
  than treating any background process as a blanket cleanup blocker. See the
  [process checks](sociotechnic/docs/development.md#background-process-checks).
- Try the owning app’s archive/remove workflow for a managed worktree first. If
  it refuses solely because of chat metadata, explicitly requested cleanup may
  proceed with ordinary `git worktree remove <exact-path>` from the retained main
  checkout. Verify the target is a registered linked worktree in this repository,
  its tracked and untracked files are clean, all its commits are verified merged,
  and no running job, test, development server or console needs it. Preserve any
  needed ignored files first. Do not use `--force`, alter app metadata or remove
  unrelated worktrees. Prune stale Git registrations afterward; a historical app
  attachment is not evidence that the checkout still exists.
- This cleanup preference does not authorize a merge or publication by itself.
  Runtime agents and drivers still follow their existing human gates and roles.

This policy is specific to `sid-newby/sociotechnic`; do not apply it to other projects or
change global git settings.
