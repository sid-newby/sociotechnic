# Sociotechnic

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the project owner, working as an individual developer
supervising coding agents across local Git repositories. Shared team oversight
is not an established requirement.

## Product Purpose

Sociotechnic is a local web console and CLI for running tiered coding agents through
a deterministic software workflow. It helps the developer understand progress,
inspect evidence, and make informed continue, rework, or accept decisions.

Success means the developer can tell what a run is doing, why it has stopped,
what evidence supports its result, and which decision is needed next.

## Positioning

The engine determines transitions and gates; drivers execute its instructions.
Fresh agents have specific roles and model tiers. Their work produces files
and structured records, with bounded retries and human acceptance before
publishing. Agent chat alone is not evidence of completion.

## Operating Context

- The developer starts a job against a local Git repository with a feature
  prompt. Work happens on a job branch in a separate worktree.
- Explicit comment-cleanup runs take a literal file/directory scope and generate
  an inventory and pinned plan without a planning agent; the user reviews it
  before continuing. General feature requests retain the planner.
- The console can hold after planning so the developer can inspect the pinned
  plan before continuing.
- A run progresses through building, repository checks, review, conformance,
  and a computed gate. The developer inspects progress, records, blockers,
  agent activity, and reported usage.
- The developer tests the branch locally before accepting it. Publishing and
  merging remain explicit human actions.
- The Claude Code skill and the console's SDK driver use the same engine.
  Only one driver may run a given job at a time.
- The existing console is served locally at `http://127.0.0.1:4747/` by default.
  `task ui` builds the React frontend and ensures a background server.
  `task dev` runs Vite on 5173 with its development API on 4748.

## Capabilities and Constraints

- New runs can opt into experimental Docker Sandbox execution. A published v3
  shell workload and provider mixins share one local VM per run; the console,
  database and human gates stay on the host. Host review worktrees receive
  committed work through Git bundles. Local execution is the initial default;
  the console remembers the owner's environment choice and valid sandbox
  resources in this browser for future runs.

The product baseline above was confirmed by the owner during initialization.
Implementation details below come from the current repository;
`sociotechnic/CONTRACTS.md` remains the authority for behavior and changes to it.

- PostgreSQL owns jobs, records, archive state and immutable agent releases.
  Local files only stage assigned agent inputs/outputs. Job operations require
  the database and fail explicitly when it is unavailable; there is no file
  fallback. Committed migration bundles preserve every semantic agent version.
- Plans are pinned. Reviews and checks must refer to the relevant commit.
  A malformed or stale record must not silently become a passing result.
- Loop bounds constrain rounds, dispatches, and retries. A parked job exposes
  the reason and returns the decision to the developer.
- Acceptance, rework, overrides, stop, and reopen have distinct meanings.
  Preserve engine status names and expose only actions legal in that state.
- Acceptance does not itself publish. Pushing and opening a pull request
  require an explicit action after acceptance; local merge is also explicit.
- The primary console uses React, TypeScript, Vite, Tailwind and Radix,
  adapted from the owner's bay01 scaffold. Node serves its built assets and
  the existing API; the engine remains TypeScript run directly by Node.
  Fonts and assets are local. The original HTML console remains at `/legacy`
  and is the default before the frontend is built.
- The server binds to loopback and defaults to a self-only Content Security
  Policy. An owner-approved allowance for the Impeccable picker at
  `http://localhost:8400` applies only with `NODE_ENV=development`, for scripts
  and connections. Design tooling must not silently expand this boundary.
- Desktop versus mobile usage priorities, additional accessibility needs,
  and distribution beyond the owner's local use remain open decisions.

## Brand Commitments

The product name is Sociotechnic, written as `sociotechnic` in commands and the existing
console. Swamp is the repository's upstream lineage, not a separate product
being designed here. No additional brand or voice commitments were established
during initialization.

## Evidence on Hand

- `README.md` and `sociotechnic/docs/`: the app guide, technical references, and reported
  dry runs. Those reports do not establish broader reliability or performance.
- `sociotechnic/CONTRACTS.md` and `sociotechnic/AGENTS.md`: behavioral contracts and human gates.
- `sociotechnic/ui/web/src/`: the React console; `sociotechnic/ui/index.html`: the legacy UI.
- `sociotechnic/ui/seed/demo-job/`: a snapshot of the first live job for tests and
  demonstrations. Paths contain placeholders; referenced repositories and
  worktrees are not present. Do not present it as a currently running job.
- `sociotechnic/tests/`: automated verification assets. Their presence is not a claim
  that they have passed in this initialization session.

No customer testimonials, adoption figures, pricing, or performance guarantees
were established. Future design work must not invent them.

## Product Principles

1. Make progress, blocking reasons, and the next human decision understandable.
2. Ground completion claims in records and checks tied to the actual work.
3. Keep orchestration deterministic and agent loops bounded.
4. Preserve the developer's control over acceptance, publishing, and merging.
5. Keep the console and CLI consistent with the engine's state and contracts.

## Interactive design workflow

Local design work is a conversation with Claude using the actual Impeccable
skill. The console hosts messages and native questions; previews open separately
in the skill's decision page. Explicit approval of saved artifacts precedes
implementation planning. Docker design and live-provider verification remain
unavailable or pending as documented in the design guide.
