# Sociotechnic

![Sociotechnic: one request becomes a coordinated team of planning, building, review, security, and approval specialists.](assets/sociotechnic-banner-v4.png)

Sociotechnical (or sociotechnic) refers to the interlinked relationship between people (social systems) and machines, tools, or software (technical systems) within organizations and society. The theory states that an organization or system works best when its social and technical parts are designed together to fit each other, rather than optimizing technology alone.

Human behavior, culture, and values shape how technology is used, while technology simultaneously changes how people work and communicate. Speak like a human. Ship like a machine. 

We invite you to join us. Be Sociotechnic.

Sociotechnic turns a development task into a safe, isolated branch you can test, review and merge with confidence. Start a run in the web console, review its plan, and follow the work through building, checks and independent reviews. The engine coordinates fresh coding agents and stops when it needs your decision. 

The console is the intended main interface. The engine and semantically versioned agent definitions live in this repository. PostgreSQL stores job records across projects and versions. Full CLI parity exists for further automations or dev feats against itself. 

[Start a run](#start-a-run) · [Agent library](#agent-library) · [Follow the work](#follow-the-work) · [Review and decide](#review-and-decide) · [How it works](#how-it-works) · [Technical documentation](#technical-documentation)

![Run console overview with the run list, workflow stages, gate evidence and review summary.](assets/console/overview.png)

Console screenshots use demonstration data and a consistent 1600 × 1000ish apeture.

## Start a run

For a first-time installation, follow [local setup](sociotechnic/docs/development.md#local-setup). Once the console is running, open [the local console](http://127.0.0.1:4747).

1. Choose **New run**.
2. Enter a repository path or choose **Browse** to select a folder or create one with **New folder**. Browsing starts at `~/Prog` when available, otherwise your home folder. Enter a path and choose **Go** to save a different starting point for future sessions in this browser. Add an optional base branch and a description of the change. Say who it is for and how you will know it worked.
3. Choose **Start planning**. With **Initialize Git if needed** enabled, a new folder gets a `readme.md` containing `tbd`, a generic `.gitignore`, and an initial commit. Existing starter files are preserved; other files stay untracked. Sociotechnic then creates a job branch and a separate worktree in which agents make their changes.
4. Read the plan. The React console always pauses before building so you can check its scope and acceptance criteria.
5. Choose **Continue build** when the plan is right. To change the pinned plan, stop the run and start another with a revised request.

Choose **New repository** for a fresh project. It requires local Git tracking and
uses the same initial commit and planning flow. If UI work has no existing
scaffold, the design interview suggests our React + NestJS house special. You
can request another scaffold; you choose the stack before implementation.

New run also offers **Docker Sandbox — experimental**. The run's agents and
checks share an isolated local Linux environment with explicit CPU, memory and
concurrency settings. Your source checkout is not mounted. Committed work returns
to a local review worktree for the same testing, acceptance and merge decisions.
Local execution remains the default. [Setup, storage and cleanup](sociotechnic/docs/docker-sandboxes.md).

![Start a run dialog with repository path, optional base branch and change description.](assets/console/start-a-run.png)

For [comment and docblock cleanup](sociotechnic/docs/comment-cleanup.md), choose **Comment cleanup** and enter the files or directories to inspect. The engine prepares a scope inventory and plan for review, then a coordinator assigns fresh Sicko workers. The same checks, reviews and human decisions apply.

## Design before implementation

For a new interface or major UI change, choose **Design ceremony** in **New run**.
Fable reads the existing product and design context, interviews you about gaps,
and offers the bundled React/NestJS starter alongside your existing or preferred
stack. It then presents design directions and three composition previews.
Inspect them, request another pass when needed, and explicitly approve the
design to implement. Each decision continues the same run automatically.

The final implementation plan follows your approval and is held for review.
Ordinary feature runs can also enter the ceremony when the planner identifies
major UI work. Small fixes retain the normal planning path. Preview formats are
labeled; image compositions require configured image generation, while HTML
prototypes are available without it. [Design ceremony details](sociotechnic/docs/design-ceremony.md).

## Follow the work

The workflow strip shows Plan, Build, Checks, Review, Gate, Approve and Human for the current round. These are recorded milestones, not a percentage complete. Open a stage to see its meaning and available evidence.

| View | Use it to |
| --- | --- |
| **Overview** | Read the plan, check results and review exceptions, inspect gate evidence, and make the next decision |
| **Activity** | Follow live driver output, dispatch history, elapsed time and deadlines |
| **Analysis** | Inspect each round's build, checks, findings, conformance, timing and recorded token usage |
| **Agents** | See configured roles, models, effort, tools and each agent's history in the selected run |

![Activity view showing the demo run's completed dispatches, agent identities, verdicts and elapsed times.](assets/console/activity.png)

Filter runs by project or status, or search the run list. Use the archive button beside a run to hide it. Check **Show archived** above the list to see archived runs and restore them. Archiving keeps the run and its records, and active runs continue working. On desktop, the run list and selected run scroll independently; the run filters stay visible. Open the plan, diff, approval or complete record list for supporting detail. Run records format Markdown headings, lists, tables and fenced code, and highlight JSON and diffs. Code blocks use their language label or detect common languages when unlabeled. Raw view preserves the original text and layout; Formatted view returns to reading.

![Run records displaying the demo plan as formatted Markdown, with record navigation and a Raw view control.](assets/console/records.png)

Each round records the build commit, configured checks and review verdicts. A lens whose path rules match no changed files reads **SKIPPED**. Missing checks and missing usage remain visible; neither is treated as a passing result or a reported zero.

![Round evidence with build commit, checks, skipped lenses and passing review records.](assets/console/round.png)

Analysis separates uncached input, output, cache read and cache write, with per-role totals, dispatch counts and median durations. These are reported measurements for the selected run. Historical SDK dollar estimates do not establish subscription charges.

![Analysis view showing recorded token totals and unavailable category measurements from the demo fixtures.](assets/console/analysis-ov.png)

## Agent library

Choose **Agent library**, beside **New run**, to browse the whole team across
projects and runs. Each role has a distinct icon shared with run profiles,
activity and analysis. Search by role, model or description, then inspect when
it is called, its model and effort, allowed tools, limits and explicit skill
access. Operator-installed skills are not automatically granted to agents. 

![Agent library showing the planner, versioned specialist roster and deployment evidence from the committed demo fixture.](assets/console/agent-library.png)

History reads database runs, including archived runs, counting each deployment
once. Explicitly marked development cancellations remain in execution history
and are excluded from performance metrics. Completed calls, execution errors,
timeouts, malformed records and valid requests for changes stay separate. Feedback categories retain
re-asks, type checks, tests, lint, build checks, review findings and human rework
with their deployment, reporter and source. Check/review feedback identifies the
builder at the matching round and commit; it does not prove who caused a defect.
Nested comment workers are not independently counted by engine dispatch history.

Use **Longest running** or **Errors & feedback** to inspect recurring work before
turning it into tools or deterministic checks. Compare workflow, build tier, model,
effort and definition revision alongside timing and token coverage. New deployments
capture a definition fingerprint; older ones remain **Version unrecorded**.
All initial agents start at **v1.0.0**. Icons and names share meaningful colors
that adapt to light and dark backgrounds. New agents inherit their role's icon
and color, so the same identity follows them through run evidence..

To **add an agent**, open **Agent library → Add agent**. Give it a unique name,
purpose and role template. Write instructions, import a Markdown/text file, or
start from the template. Keep the template's required output format. Review the
agents already doing that job and explain the distinct responsibility. Exact
copies are rejected; use a new version when the responsibility is the same.
Review the model, tool subset and budgets, then create **v1.0.0**.
Compatible reader and ordinary builder templates offer both **Anthropic / Claude** and **OpenAI / Codex**
model groups. Codex uses your saved ChatGPT login and requires access to the
selected model. Creation makes
the agent available; it does not change any run. In **New run → Agents and
versions**, assign it to its matching role and choose latest or a legacy release.

The optional [Azure SME](sociotechnic/docs/azure-sme.md) uses **GPT 6.1 Sol / high**
and pinned Microsoft Azure skills. Search `azure` in
the library. Choose its planner for a plan another builder can execute, its
advisor for research and escalations, or **Azure Builder v1.1.0** for implementation
and small fixes. Select the same builder in both EASY and COMPLEX slots; each
tier retains its scope rules and execution budget. Assignments retain the
workflow's plan, check and human gates.

![Add agent form with a demonstration release-planning purpose, role template and adapted instructions.](assets/console/agent-creation.png)

To **modify an agent**, select it in the library and choose **Manage versions**.
Copy an existing release, edit its purpose, instructions, model, effort, tools or budgets,
and review then publish a higher version. Use a **patch** such as 1.0.1 for
corrections, a **minor** such as 1.1.0 for compatible capabilities, and a **major**
such as 2.0.0 for changed expectations. Releases are immutable and ordered
numerically. New runs pin latest unless overridden; existing runs keep their
exact assignments, versions, instructions and settings.

Permissions stay within the role's limits; publishing cannot grant reviewers
shell access or bypass write guards. Planning, research, review, conformance and
approval agents can switch between Claude and OpenAI models when creating an
agent or publishing a version. Codex uses high effort; readers have fixed read-only
tools, while ordinary builders can edit, run commands and commit in their assigned
worktree. Design and Agent-worker templates require Claude. Nested comment
workers retain v1.0.0 and are not editable independently yet. File imports supply
instructions only; imported hooks, tools and skill declarations are ignored.

**PostgreSQL is the agent catalog.** Releases and run bindings are backed up and
restored with the runs. There are no live agent Markdown files to edit in the
repository. Committed migration bundles carry the complete release history,
including older versions, instructions, tools, model choices and custom agents.

Catalog changes are exported and checked before committing; upgrading imports
missing releases without replacing an existing version. A database outage blocks
job and catalog operations. See the [catalog and recovery
guide](sociotechnic/docs/engine-reference.md#semantic-agent-releases) for migration
and backup details.

Agents also receive a concise capability roster, so they can recognize useful
specialists and ask for focused help. The planner can consult a registered advisor
within its bounded research round. Builders and validators keep ownership and
return concrete help requests to the assigner through existing records. New agents
appear automatically in new runs' rosters. [Agent discovery and help](sociotechnic/docs/agent-discovery.md).

Missing measurements stay unavailable. Definition fingerprints cover stored
instructions and role settings. Full release-content digests also bind bundled
skill snapshots. Neither proves how a provider alias resolved or captures every
generated dispatch brief.

Recorded feats currently recognize checked builds with build records, checks and
unflagged gates bound to the same commit. They link to run evidence. Human
acceptance is run context. These observations support future experiments; they
do not establish agent accuracy or automatically change models, prompts or
planner behavior. The screenshot uses the committed demonstration run.

## Review and decide

Agents commit changes on the job branch. You decide when to test, accept, publish and merge. The console offers actions appropriate to the run's current status.

| Run status | Your next decision |
| --- | --- |
| **Your design decision** | Answer the interview, choose a direction, approve a composition or request another pass |
| **Planned** | Read the pinned plan, then choose **Continue build**, or stop and start again with a revised request |
| **Ready** | Inspect the evidence. Choose **Merge locally** to test in your normal checkout, or test in the job worktree, then **Accept** or **Request rework** |
| **Needs your attention** | Read the reason, blockers and policy flags. Request rework, raise the named bound when appropriate, or test and accept after reviewing the evidence |
| **Merged locally** | Test in your checkout, then accept or request rework. The job branch and worktree are kept |
| **Accepted** | Choose **Push and open PR**, then separately **Merge PR on GitHub**; or finish the run locally |
| **Stopped** | Choose **Reopen run** to continue with existing changes, or remove the worktree |

Acceptance confirms that you tested the change. Publishing and GitHub merging have separate confirmation steps; a passing gate alone triggers neither. A remote merge checks the published PR identity and commit, follows GitHub's merge requirements, and records confirmed success.

**Merge locally** changes your base checkout. **Merge PR on GitHub** preserves it. After a GitHub merge, synchronize that checkout separately; local and remote merge histories can differ. [Publishing and merge details](sociotechnic/docs/cli-reference.md#publishing-after-accept) explain the underlying operations.

Rework records your feedback for a fresh build and another review round. Stopping preserves the plan, history, branch, worktree and uncommitted edits. Reopening retries the interrupted step within the remaining bounds.

## How it works

The engine decides what runs next; the console’s driver executes that decision through the Claude Agent SDK or Codex CLI, according to the run’s pinned agent settings. Only one driver can own a job at a time. Alternative session and automation entry points are documented in the [CLI and driver reference](sociotechnic/docs/cli-reference.md).

```mermaid
flowchart LR
  H["Human"] <--> UI["Web console"]
  UI <--> E["Deterministic engine"]
  E --> A["Fresh agents<br/>model and effort by role"]
  DB[("PostgreSQL<br/>jobs, records and agent releases")] <--> E
  E --> S["Dispatch input staging"]
  S --> A
  A --> O["Dispatch output staging"]
  O -- "validate and commit" --> DB
```

The planner selects the build tier. The bundled defaults use Opus for complex work, Sonnet for localized changes, Haiku for mechanical sweeps, or a Sonnet coordinator and Sonnet workers for comment cleanup. Agent assignments and versions can select other compatible models before a run starts. Separate reviewers examine code, security, UX, UI and plan conformance where their path rules apply.

```mermaid
flowchart TD
  P["Plan and optional research<br/>validate and pin plan.json"] --> B["Build in the job worktree<br/>tier picks the builder"]
  B --> C["Run repository checks<br/>write checks.json"]
  C --> G["Diff files and lens guards<br/>unmatched lenses become SKIPPED"]
  G --> R["Matching review lenses<br/>and conformance in parallel"]
  R --> GT{"Gate"}
  GT -->|blockers, within caps| B
  GT -->|blockers, past a cap| NH["needs-human"]
  GT -->|pass with flags| NH
  GT -->|pass, no flags| AP["Approver"]
  AP -->|APPROVE| RD["ready"]
  AP -->|ESCALATE| NH
```

The gate checks records, commits, repository checks, worktree cleanliness and the pinned plan. Blocking findings open another round while the limits allow it. Policy flags or exhausted limits require a human decision. A clean gate goes to the approver before the run becomes ready.

PostgreSQL owns jobs, records, design previews, archive state and immutable agent releases. Local agent files are disposable staging. Missing staging does not hide a run or change its evidence; a database outage reports an error instead of switching to files. Restoring a worktree still requires the target repository and its job branch; the database does not back up commits or uncommitted edits.

## Technical documentation

| Document | Read it for |
| --- | --- |
| [Local setup and development](sociotechnic/docs/development.md) | Installation, running the console, development mode, tasks, checks, dependency policy and historical demo evidence |
| [CLI and driver reference](sociotechnic/docs/cli-reference.md) | Session and engine commands, the global skill, console lifecycle, publishing, HTTP API and driver handoff |
| [Engine and state reference](sociotechnic/docs/engine-reference.md) | All roles and tiers, records, gate rules, bounds, configuration, database migration and recovery |
| [Comment cleanup](sociotechnic/docs/comment-cleanup.md) | Starting a cleanup run, worker scope, bounded waves, proof requirements and limitations |
| [Behavioral contracts](sociotechnic/CONTRACTS.md) | The engine, agents, console and state-store specification |
| [Driver contract](sociotechnic/AGENTS.md) | How drivers execute engine decisions and observe human gates |

Agents adding capabilities should read the behavioral and driver contracts, then the relevant reference. The command and API documentation remains available for automation and CLI use.

Sociotechnic is an experiment under active development. Automated tests use fake agents; passing them does not establish live model quality or production reliability. [Historical runs](sociotechnic/docs/development.md#status-and-historical-runs) distinguish recorded evidence from reported outcomes.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) to report a bug, propose a feature or open a
pull request. Follow the [code of conduct](CODE_OF_CONDUCT.md) and use the
[security policy](SECURITY.md) for vulnerability reports.

Sociotechnic is licensed under [MIT](LICENSE). Bundled upstream material retains
its own [licenses and notices](THIRD_PARTY_NOTICES.md). See the
[changelog](CHANGELOG.md) for releases.
