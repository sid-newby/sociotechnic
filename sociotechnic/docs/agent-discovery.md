# Agent discovery and asking for help

The library is also a capability directory for agents. `sociotechnic roster`
and `GET /api/agent-roster` return compact cards derived from the latest immutable
database releases: identity/version, purpose, role template, skills, model/effort,
access class and release digest. They omit prompts, skill bodies and history.
Adding a custom library agent automatically adds its card; there is no separate
hardcoded Azure routing list to maintain. Give new agents precise purposes and
skills so another agent can recognize when they would help.

A new run freezes the available roster. The engine adds it and help guidance to
every top-level dispatch, including validation and approval. Nested comment
workers see the same roster but ask their coordinator for help. Existing runs
without a roster say it was not recorded rather than acquiring newer agents.
`sociotechnic roster <job>` reads the frozen view. Cards are capability data,
not permission grants or executable instructions; the actual role controls tools.

## Choose the kind of help

| Situation | Appropriate use |
| --- | --- |
| Need domain evidence or an answer before planning | A research-template advisor with one bounded question |
| Need an entire specialist plan | Select that planner before creating the run; any compatible builder can implement its plan |
| Need staging, documentation, remediation or a small fix | Select a builder matching the actual tier and scope; Azure has COMPLEX and EASY profiles |
| A builder is stuck or cannot verify a change safely | Keep ownership; return BLOCKED with a concrete request for expertise/evidence |
| A reviewer or conformance validator sees a domain blind spot | Record the problem and suggested expert in Findings, keeping the correct severity/verdict |
| An approver lacks required evidence or a policy decision | ESCALATE through the existing approval rules |

The Azure cards distinguish planner, advisor, builder and builder-lite roles;
Terraform/container cards use the same format. A specialist is not required for
every related task. Do the bounded work you can confidently verify, and ask for
help when specific evidence or expertise is missing. Informational Azure and
identity guidance requires no login. The roster authorizes no Azure access.

## Bounded planning consultation

The existing research response accepts an optional array parallel to questions:

```json
{
  "status": "needs-research",
  "questions": [
    "Which scoped permission is needed for the operation described in this repository?",
    "Where is that operation called?"
  ],
  "advisors": ["sociotechnic-azure-advisor", null]
}
```

Only research-template identities in the run's frozen roster are eligible.
`null` retains the configured researcher. Explicit researcher assignments or
version choices lock that slot, so a conflicting advisor selection is rejected.
The engine resolves the exact recorded release and pins it on the dispatch;
retries keep that identity and configuration even if a newer release appears.
The default run assignments are unchanged. Auxiliary advisor releases receive
their own database foreign-key bindings and survive backup/restore.

There is still only one research round with 1–6 questions. Advisors return DONE
or BLOCKED to the original planner; they cannot open another consultation or
transfer the task. The planner reads their evidence and writes the plan, naming
unresolved decisions where needed. Existing deadlines, tool limits, dispatch and
retry bounds apply. Unknown names, non-research roles and malformed advisor
arrays follow the existing bounded malformed-plan retry path.

For a recommendation rather than a consultation, a full plan may include up to
six unique entries:

```json
{
  "agentRecommendations": [
    {
      "agent": "sociotechnic-azure-builder-lite",
      "reason": "Useful for a small scoped Azure configuration correction."
    }
  ]
}
```

This optional field accompanies the ordinary complete plan, is validated against
the frozen roster and participates in its digest. It is visible to the assigner;
it does not change the builder, tier, scope or human approval. Do not inflate a
tier merely to reach a particular expert. Existing builders can execute a sound
specialist plan.

## Orchestrator choices before a run

Use the compact live roster before choosing agents. The existing web/API role
assignments also have CLI equivalents:

```sh
sociotechnic/bin/sociotechnic roster
sociotechnic/bin/sociotechnic new /path/to/repo 'Explain the Azure configuration' \
  --agent-assignments '{"sociotechnic-planner":"sociotechnic-azure-planner","sociotechnic-builder-lite":"sociotechnic-azure-builder-lite"}'
```

Optional `--agent-versions` accepts a role-to-semantic-version JSON object.
Identity/version validation occurs before Git worktree creation. Explicit choices
remain frozen; the engine never guesses a specialist from free-form prose.
To change assignments after creation, start a new run rather than editing pins.

## Keep ownership

A useful help request names the expert, narrow question, attempted work, source
evidence and result required to proceed. Builders use their Blocker section;
reviewers/conformance use Findings; approvers use Escalation. These requests go
back to the assigner, and nested workers go to their coordinator. They cannot
spawn additional agents or clear a failing gate. Explicitly assigned comment
worker waves continue under their own existing contract.

The [implementation plan](agent-discovery-plan.md) records scope and verification.
Tests cover real catalog and prompt paths, future-agent discovery, advisor
identity/version preservation, assignment locks, rejected role expansion,
recommendation handling, blocked builders, nested workers and PostgreSQL restart.
