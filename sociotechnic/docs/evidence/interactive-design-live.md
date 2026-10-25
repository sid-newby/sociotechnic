# Live interactive design verification

Started on 2026-10-25 with the user's authorization for live testing without a
token budget. This evidence uses the real configured Claude provider, a separate
PostgreSQL database and a disposable target repository. No fixture SDK or fake
runner is injected.

Observed:

- A normal new-run request for a React site using the house template reached
  `needs-design` on the planner's first dispatch, without implementation planning
  or a build. The planner used its pinned v1.0.2 release.
- The designer started one persistent session with the actual Impeccable 4.3.1
  installation and its native executable. The SDK confirmed skill discovery.
- PostgreSQL retained native assistant messages, tool calls and their results.
  These show successful reads of the actual Impeccable playbooks, house starter
  README, portable UI guide and target repository.
- The house starter's revision and content digest were pinned in the session.
- Claude's native `AskUserQuestion` reached the app with three real questions
  about purpose, subject and audience. All choices and free-text fields rendered.
  The session entered a human wait without a tool or persistence error.
- The in-progress usage label was corrected to say that usage updates when the
  response finishes, instead of displaying zero while live work is underway.

The [interview screenshot](interactive-design/live-question.png) contains real
provider output. No human answer has been supplied by the verification harness.
The session remains available for the user to answer. Native preview generation,
same-session revision and final approval are not yet claimed as live evidence;
their fixture/native-subprocess coverage is described in
[integration verification](interactive-design.md).

Checks for the accompanying template handoff change: `task checks` passed
(289 main-suite tests passed, 31 optional checks skipped, zero failures; release
checks and dependency audit also passed). All 14 focused design checks passed
with PostgreSQL and actual Impeccable enabled. An additional focused check
confirmed the final planner receives the pinned starter path and digest and
that changed starter bytes prevent approval.

The existing production console and catalog were not restarted or migrated.
