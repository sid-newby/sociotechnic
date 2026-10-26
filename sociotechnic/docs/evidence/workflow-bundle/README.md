# Workflow bundle demo verification

Captured from commit `2f51f98deff3353f49129a07ea462ca7eefa96c1` with the rebuilt
v0.9.0 console. The [report](report.json) records source, build and image hashes.
The later evidence commit does not change application source.

The fixture uses the existing memory-store demo pattern, fake lead replies, an
owned ephemeral server and a private browser. It made two fake calls and no real
provider calls or live database connections. The server and browser were closed
in the fixture's cleanup path.

Verified creation of an orchestrated local run, pending lead questions, empty
answer validation, saving an answer and resuming to the next clarification,
a 390px layout without horizontal overflow, and the restored run summary after
design handoff with the saved conversation collapsed.

- [New run](new-run-orchestrated-local.png)
- [Pending workflow question](pending-workflow-question.png)
- [Answer dialog](workflow-answer-dialog.png)
- [Narrow layout](pending-workflow-narrow.png)
- [Run summary after design](post-design-run-summary.png)

These captures establish the listed fixture behaviors. They do not establish
live provider quality, production SSE reliability, or a clean premium static audit.
The existing premium source-pattern findings remain separate from these checks.
