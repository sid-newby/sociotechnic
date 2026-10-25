# Sociotechnic

<!-- impeccable:product-schema 1 -->

Product record for Impeccable design work. Facts marked **owner-confirmed** were
stated by the owner during initialization on October 24 and reconfirmed or
restated on October 25, 2026. Facts marked **repository** come from the current
checkout and are hypotheses until the owner says otherwise. Facts marked
**open** were asked and not answered; future work records them, it does not
decide them.

## Platform

web

## Users

**Owner-confirmed.** The primary user is the owner: an individual developer
supervising coding agents across local Git repositories on their own machine.
Sociotechnic is built for that person first. Everything else serves that.

**Owner-confirmed.** A secondary audience exists and is welcome: curious
developers who find the public repository, try it, and give feedback, and
potential contributors. The owner wants help with the application, wants
feedback, and wants to learn what working on a successful open source project
is like. This audience shapes the README, documentation, releases and
contribution surface. It does not change whose workflow the console is designed
around.

## Product Purpose

**Owner-confirmed.** Sociotechnic is a place where coding agents can do their
best work, with the right tools at the right time. The owner's words: "a kick
ass place where agents can do their best work with the right tools at the right
time."

**Owner-confirmed.** It is a local web console and CLI that runs tiered coding
agents through a deterministic software workflow. It helps the developer
understand progress, inspect evidence, and make informed continue, rework, or
accept decisions.

Success means two things hold at once:

- Agents receive the role, model, effort, tools, context and scope their task
  needs, and nothing they do not.
- The developer can tell what a run is doing, why it has stopped, what evidence
  supports its result, and which decision is needed next.

## Positioning

**Owner-confirmed.** The engine determines transitions and gates; drivers
execute its instructions. Fresh agents have specific roles and model tiers.
Their work produces files and structured records, with bounded retries and
human acceptance before publishing. Agent chat alone is not evidence of
completion.

**Repository.** The mechanism a neighboring tool could not truthfully copy is
the combination of:

- A deterministic engine that owns every transition, gate and bound, so the
  model is never the orchestrator.
- An agent library of semantically versioned, immutable releases stored in
  PostgreSQL, where each release pins model, effort, tools, limits and explicit
  skill access. Operator-installed skills are never granted implicitly. This is
  where "the right tools at the right time" is enforced.
- Evidence bound to commits: plans are pinned, checks and reviews refer to the
  commit they examined, missing checks and missing usage stay visible, and a
  malformed or stale record never becomes a pass.
- Human gates that are distinct actions with distinct meanings: accept, rework,
  override, stop, reopen, push, merge locally, merge on GitHub.

## Operating Context

**Owner-confirmed baseline.**

- The developer starts a job against a local Git repository with a feature
  prompt. Work happens on a job branch in a separate worktree.
- Explicit comment-cleanup runs take a literal file or directory scope and
  generate an inventory and pinned plan without a planning agent; the user
  reviews it before continuing. General feature requests retain the planner.
- The console holds after planning so the developer can inspect the pinned plan
  before continuing.
- A run progresses through building, repository checks, review, conformance and
  a computed gate. The developer inspects progress, records, blockers, agent
  activity and reported usage.
- The developer tests the branch locally before accepting it. Publishing and
  merging remain explicit human actions.
- The Claude Code skill and the console's SDK driver use the same engine. Only
  one driver may run a given job at a time.

**Repository.** Current surfaces and rituals, as documented in `README.md` and
implemented in `sociotechnic/ui/web/src/`:

- **New run** takes a repository path (with a folder browser that remembers a
  start point), an optional base branch, a change description, and agent and
  version assignments. Run types: ordinary feature, **New repository** (starter
  commit and private GitHub publication before planning), **Comment cleanup**,
  and **Design ceremony**. Execution is **Local** by default or **Docker
  Sandbox** (experimental), with CPU, memory and concurrency settings the
  browser remembers.
- The workflow strip shows Plan, Build, Checks, Review, Gate, Approve and Human
  for the current round as recorded milestones, not a percentage.
- Views: **Overview** (plan, checks, review exceptions, gate evidence, next
  decision), **Activity** (live driver output, dispatch history, elapsed time,
  deadlines), **Analysis** (per-round build, checks, findings, conformance,
  timing, token usage split into uncached input, output, cache read and cache
  write), **Agents** (roles, models, effort, tools, history in the selected run).
- **Agent library** browses the whole team across projects and runs: search,
  inspect, **Add agent**, **Manage versions** with patch, minor and major
  releases, and deployment history including errors and feedback. Each role has
  a distinct icon and color that follow it through run evidence.
- **Sandboxes** lists retained sandboxes to stop or remove without losing
  history.
- Run statuses and the decision each asks for: Your design decision, Planned,
  Ready, Needs your attention, Merged locally, Accepted, Stopped. The console
  exposes only the actions legal in the current status.
- Publishing after acceptance: **Push and open PR**, then separately **Merge PR
  on GitHub**, or **Merge locally**, or finish the run locally.
- When another console owns a run, the current console shows that and links to
  the owner instead of offering a local resume that cannot succeed.
- Run records render Markdown, JSON and diffs; Raw view preserves the original.
  Filters, search and archiving organize the run list.
- Environments: the built console is served at `http://127.0.0.1:4747/` by
  `task ui`; `task dev` runs Vite on 5173 against a development API on 4748;
  the original HTML console remains at `/legacy`. PostgreSQL 17 on
  `localhost:5433` is the default store. Codex CLI logged in with ChatGPT is
  required for code review and research roles.

## Capabilities and Constraints

**Owner-confirmed.**

- New runs can opt into experimental Docker Sandbox execution. Agents and checks
  share one local VM per run; the console, database and human gates stay on the
  host. Committed work returns to a host review worktree through Git bundles.
  Local execution is the default.

**Repository.** `sociotechnic/CONTRACTS.md` is the authority for behavior.

- PostgreSQL owns jobs, records, design sessions, archive state and immutable
  agent releases. Local files only stage agent inputs and outputs. Job and
  catalog operations require the database and fail explicitly when it is
  unavailable; there is no file fallback. Committed migration bundles in
  `sociotechnic/seeds/agent-releases/` carry the complete release history.
- Plans are pinned. Reviews and checks must refer to the relevant commit. A
  lens whose path rules match no changed files reads SKIPPED. Missing checks and
  missing usage stay visible and are never a pass or a zero.
- Loop bounds constrain rounds, dispatches and retries. A parked job exposes
  the reason and returns the decision to the developer.
- Acceptance, rework, overrides, stop and reopen have distinct meanings.
  Preserve engine status names. Acceptance does not publish.
- Providers: Claude through the Claude Agent SDK; OpenAI Codex CLI for
  compatible reader and ordinary builder roles. Design and Agent-worker
  templates require Claude. Reviewers never gain shell access through
  publishing; write guards hold.
- The console is React 19, TypeScript, Vite 8, Tailwind 4, Radix UI,
  lucide-react and Geist Variable from a local package. Node serves the built
  assets and the API. Fonts and assets are local; nothing loads from a CDN.
- The server binds to loopback and sends a self-only Content Security Policy.
  A dev-only allowance for `http://localhost:8400` (the Impeccable live picker)
  is guarded by `NODE_ENV === "development"` in `sociotechnic/ui/server.ts`.
  Design tooling must not silently widen this boundary.
- Accessibility practice already in the code: labelled controls, `status` and
  `alert` live regions, `aria-busy` on loading surfaces, `focus-visible` styles,
  screen-reader-only text, `prefers-reduced-motion` handling, light and dark
  color schemes, and browser verification at a 390px viewport.
- Terminology to preserve: run (job), round, dispatch, lens, gate, bound,
  pinned plan, release (agent version), driver, owning console, worktree, job
  branch, sandbox slot.

**Open.** Asked on October 25, 2026 and not answered; record, do not decide:

- Whether desktop is the primary surface with narrow viewports as a usability
  floor, or whether narrow parity is required.
- Whether a formal accessibility standard (such as WCAG 2.2 AA) is a stated
  requirement, or current practice stands without one.
- Whether distribution stays local-only or a hosted or multi-user deployment is
  ever planned. Today the server binds to loopback.

## Brand Commitments

**Owner-confirmed.** The product name is Sociotechnic, written `sociotechnic`
in commands and the console title.

**Repository.** The README defines the term through sociotechnical theory:
people and machines designed together, not technology optimized alone. It
carries two taglines, "Speak like a human. Ship like a machine." and "Be
Sociotechnic.", and one banner, `assets/sociotechnic-banner-v4.png` with a
transparent variant. Earlier banner versions and their prompts were removed from
the working tree on October 25, 2026.

**Owner-confirmed, October 25, 2026.** Dark color schemes are strongly
preferred; light remains supported. The v4 banner and its transparent variant
are offered for use in the console; using them is a design choice, not a
requirement.

**Open.** Whether the README voice is binding for design work was asked and
not answered. Treat it as present evidence, not a commitment, until the owner
says so.

Upstream reference material (`source/`, gitignored and absent from this
checkout; `notes/`) is lineage, not a product being designed here.

## Evidence on Hand

- `README.md`: the web console user guide, with console screenshots at
  `assets/console/` (eight 1600 × 1000 dark captures of the built console on
  committed demo data, refreshed October 24, 2026), run-wizard captures at
  `assets/run-wizard/` and `assets/sandbox-recovery/`.
- `sociotechnic/docs/`: CLI and driver reference, engine and state reference,
  development guide with the feature-to-code map, design ceremony, comment
  cleanup, Docker sandboxes, browser verification, Azure SME, releasing.
- `sociotechnic/CONTRACTS.md` and `sociotechnic/AGENTS.md`: behavioral
  contracts and the driver contract.
- `sociotechnic/ui/web/src/`: the React console. `sociotechnic/ui/index.html`:
  the legacy console.
- `sociotechnic/ui/seed/demo-job/`: a snapshot of the first live job used by
  tests, screenshots and demonstrations. Paths contain placeholders; referenced
  repositories are not present. Never present it as a running job.
- `sociotechnic/tests/`: `node:test` suites with fake agents, plus optional
  PostgreSQL integration (`task test:pg`). Browser verification scripts in
  `sociotechnic/scripts/` and the recorded run at
  `sociotechnic/docs/evidence/interactive-design.md`. Their presence is not a
  claim that they passed in this session.
- `CHANGELOG.md` and GitHub Releases from v0.1.1 through v0.4.2, with
  unreleased work on resumable Impeccable design sessions.

Absences future work must not fill in: no customer testimonials, adoption
figures, external user counts, pricing, performance guarantees or production
reliability claims exist. Automated tests use fake agents; passing them does
not establish live model quality.

## Product Principles

1. Give agents their best working conditions: the right role, model, effort,
   tools, context and scope at the right moment, and nothing they do not need.
2. Make progress, blocking reasons and the next human decision understandable
   at a glance.
3. Ground every completion claim in records and checks bound to the actual
   commit; keep absences visible.
4. Keep orchestration deterministic and loops bounded; the developer owns
   acceptance, publishing and merging.
5. Build for the owner first and keep the door honestly open: documentation,
   releases and contribution paths tell a curious developer the truth about
   what works and what is experimental.

## Interactive design workflow

**Repository.** Design before implementation is a product feature. A Design
ceremony run hosts a Claude conversation using the installed Impeccable skill.
The console carries messages and native questions; **Open previews** opens the
skill's decision page in a separate window. Saved artifacts require explicit
approval before implementation planning, and the final plan is held for review.
The React + NestJS house starter is offered as a read-only reference for new
UI work; the chosen stack belongs in the resulting DESIGN.md. Docker design
sessions are refused; live provider verification awaits an agreed token budget.
