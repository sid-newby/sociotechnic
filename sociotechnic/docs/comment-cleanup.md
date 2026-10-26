# Comment cleanup

In **New run**, choose **Comment cleanup**, select the repository and base branch,
then enter literal repository-relative files or directories, one per line (or `.`
for the whole repository). An optional goal describes the intended cleanup. Choose
**Prepare cleanup plan**. The engine creates an inventory and pinned COMMENTS plan
without dispatching Fable. Review the scope, exclusions and work packets before
choosing **Continue build**. Open **Cleanup scope** in the evidence shortcuts for
the inventory record and packet ranges.

The normal **Feature or fix** workflow still accepts a free-form cleanup request
through the general planner; existing jobs keep their pinned plans. For that path,
use:

> Map out a path for comment-cleanup (Sicko agents) through this repo. Shorten or
> qualify docblocks, delete unnecessary commentary, and verify retained claims
> against the code. Fan out appropriately sized waves, keep workers below 200k
> context tokens, and prove the cleanup with the repo's checks. Report exact
> MUST KILL refactor targets without changing application logic.

The React console holds after planning. In the legacy console, keep **hold after
plan** on for the first run. Confirm `plan.json` selects tier
`COMMENTS` and covers the intended source files. Sociotechnic creates its usual
`sociotechnic/<job-id>` branch and worktree. Do not ask a worker to create a second
`maint/docblock-cleanup` branch inside that worktree; it would break commit binding.

The free-form path keeps the normal planner. The explicit cleanup path skips that
dispatch. `sociotechnic-comment-cleaner` is the Sonnet/high
builder for this tier. It coordinates `sociotechnic-comment-sicko` workers on
Sonnet/high, using the policy adapted from `~/.claude/agents/comment-sicko.md`.
The shipped agents are self-contained; the global source file is not required.

The coordinator inventories coverage and exclusions, divides files into disjoint
packets, and sizes each wave: one worker for one packet, two for 2–4 packets, three
for 5–8, four for larger sets, subject to available slots. Aim for no more than 40
files and 80k source bytes per packet; large files use sequential symbol-sized
packets. Workers edit comments only. The coordinator commits each finished wave
serially and sends fresh workers to independently verify the affected files.

Workers aim below 100k supplied context and hand off unfinished scope by 150k.
The SDK sets a 180k auto-compaction window as a backstop, not a hard total-token cap
or proof that context stayed fresh. Read files and diffs in bounded chunks; larger
repos get more waves. A deadline, missing delegation capability, or unresolved
handoff produces BLOCKED with remaining scope. It never counts as complete coverage.

The policy preserves legal notices, real public API contracts, proven external
constraints and necessary links. It removes narration and oversized justifications;
retained docblocks are shortened or qualified from current code evidence. Executable
comment directives and runtime strings remain intact. A correctness suppression
that reveals a required code fix produces a MUST KILL symbol and a blocked result,
not an application refactor.

`round-N/build.md` links coverage, worker reports, fresh verification and the final
check results. The existing deterministic checks, code/security/conformance reviews
(and UI/UX lenses when applicable), gate and approver still run. Tests alone do not
prove that comments are true: the cleanup must also inspect code, contracts and the
actual diff, with native AST/compiled-output comparison where available. Missing
proof blocks readiness. Empty diffs retain the existing empty-diff gate.

Nested workers inherit packaged instruction resources from the coordinator's pinned
release through the existing SDK dispatch. A new coordinator release can append
`team-writing` for reports and other human-readable prose without changing the
worker's definition, permissions, report format or independent deployment policy.
Retained coordinator pins without that resource receive no new writing guidance.

Nested workers are part of the coordinator's SDK dispatch, not separate engine
ledger entries. Their assigned staged reports and coverage records are ingested under that round
in PostgreSQL with the coordinator completion; worker chat is not evidence. Use the console's New run
flow; a session driver with no nested Agent capability will report BLOCKED.
The inventory uses pinned `@babel/parser` for JavaScript, TypeScript, JSX and TSX.
Other languages and rejected syntax are explicitly marked for manual inspection.
Babel loads only for inventory and comment verification; ordinary engine commands
keep lazy dependency loading.

After the run reaches the normal human gate, test and approve it through the usual
merge/accept/publish controls. Cleanup workers never write the database or merge themselves. The shared driver
ingests their declared outputs; staging cannot replace the pinned inventory or
committed structural proof.

## Inventory and proof tools

From the Sociotechnic repository root:

```bash
sociotechnic/bin/sociotechnic inventory /path/to/repo --scope src --base main
sociotechnic/bin/sociotechnic new /path/to/repo 'Clean source comments' --workflow comments --scope src --base main
sociotechnic/bin/sociotechnic verify-comments /path/to/job-worktree --base <base-sha> --head HEAD
```

The project and global `/sociotechnic` skills are thin wrappers around these
commands. An explicit cleanup request uses `--workflow comments` and the selected
scope, then stops at the generated plan for review; the session does not repeat
discovery or start the build automatically.

`inventory` and `verify-comments` are read-only JSON tools. The inventory reads Git
blobs from a resolved commit, so untracked files, uncommitted edits and temporary
worktrees are not source input. It reports runtime state, dependencies, generated
files and symlinks as excluded. Empty, escaping, globbed or nonexistent scope is
rejected. A record over 1.5 MB, a scope over 5,000 files, a source file over 8 MiB
or a single line over 80,000 bytes requires a narrower scope or the general
planning workflow. No automatic comment deletion is performed.

`comment-inventory.json` records commit/blob bindings, UTF-16 comment offsets, line
ranges, docblock/protected-directive classification, manual-language status and
stable packets. A packet has at most 40 files and 80,000 source bytes. Larger files
get contiguous line ranges run serially for that file. These bounds do not claim
a total prompt or token budget; nearby evidence and reports still need headroom.
The plan groups exact owned files into at most twelve stages; those groups are
scope, while the inventory packets determine bounded worker assignments.

The coordinator uses the pinned manifest rather than repeating discovery. Workers
still verify retained claims against code and tests. At each build commit the
engine also compares supported changed files' ASTs and literal spellings to base,
and preserves protected comments at their token positions. A code/directive or
file/mode change fails the gate. Changed files without parser proof flag the human
gate; syntax checks alone do not prove equivalent behavior. The proof appears in
`round-N/comment-proof.json` and the normal checks record. Inventory tampering
blocks continuation or readiness.
