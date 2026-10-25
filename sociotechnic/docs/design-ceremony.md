# Fable design ceremony

The design ceremony precedes implementation planning for substantial UI work.
Fable owns product discovery, design strategy, direction exploration and three
composition previews. The human makes the choices; the engine records them.

## Start and continue

Choose **Design ceremony** in **New run** and describe the product or UI change.
For an ordinary feature run, the planner can also request the ceremony when it
finds a new interface, replacement identity, substantial layout or interaction
change, or multi-screen design work. Small local fixes and comment cleanup keep
their existing workflow. The explicit run type guarantees the ceremony rather
than relying on the planner's classification.

1. Fable reads existing product, design and surface context, then asks up to
   three material questions. Confirm known facts rather than repeating an
   initialization interview. Missing PRODUCT.md triggers product discovery;
   missing DESIGN.md alone does not erase an incumbent interface.
2. Answer the interview and choose the existing stack, the bundled React/NestJS
   starter, or another stack. A custom stack includes a description and relevant
   deployment constraints. The starter is a foundation, not a visual direction.
3. Choose among three grounded directions. Fable explains the thesis, reasoning
   and tradeoff and provides a preview for each. Request another pass with a
   steering note when the set misses the brief.
4. Inspect three compositions within the selected direction. Preview images or
   self-contained HTML prototypes are labeled by format. **Inspect preview**
   opens a larger view; closing it does not approve anything.
5. Choose a composition, check the explicit approval box, and choose **Approve
   design and continue**. The final planner receives the design, confirmed
   product truth, stack and approval digest. The resulting plan is held for
   review before the ordinary build/check/review workflow.

Answers, choices and revision requests continue the same job automatically in
the console. There is no active model or dispatch deadline while waiting for a
human. A fresh dispatch reads the records when work resumes. Stop/reopen,
driver locks, retry limits and dispatch bounds continue to apply. Repeated
revisions can reach a bound; the existing human override lifts it explicitly.

Design approval permits implementation. Testing, acceptance, publication,
remote merge and cleanup retain their separate human gates.

When the bundled stack is selected, Fable and the approved implementation/review
handoff receive its portable `scaffold-ui` guide. It maps actual installed
components, token and typography sources, with pinned shadcn/Tailwind references
and primary Radix guidance. Those standards support the approved design; they
do not select its appearance or override an existing/custom stack. See
[scaffold UI standards](scaffolds.md#ui-standards-carried-by-the-starter).

## Impeccable installation and execution

The designer is pinned to `claude-fable-5-1` with `xhigh` effort, 120 turns and
a 40-minute dispatch deadline. Historical usage retains the actual models
returned by the SDK. There is no alternate-provider or model fallback.

Set `SOCIOTECHNIC_IMPECCABLE_SKILL` to a trusted installed skill directory when
explicit resolution is needed. It must contain `SKILL.md` and
`scripts/impeccable`. Otherwise resolution checks the project's Claude skill,
the user's Claude and Codex skill directories, then the installed Codex
Impeccable plugin cache. An invalid explicit path fails; it does not silently
select a different installation. Sociotechnic does not install or update the
skill for the user.

The SDK explicitly registers `mcp__design__impeccable`. It runs shell-free
commands in the current isolated design round and permits only:

- `context`, with no arguments;
- `concept-seed`, with scoped direction/surface exploration flags;
- `build-phase start`, for Impeccable's comp preparation;
- `generate-image`, with prompt and PNG output paths inside that round; reference images may
  also be read from the target worktree.

Fable reads the resolved skill and its init, shape, new-work and craft guidance.
The console replaces Impeccable's standalone question page and answer channel;
it preserves the interview, direction workshop and composition selection as
engine-validated packets. It does not launch a second decision server.

Image generation through the installed Impeccable tool requires
`OPENAI_API_KEY` in the console's environment. When available, the interview
resolves comp-first versus code-first work. Without it, the designer produces
labeled HTML prototypes. A harness-native image tool is not assumed to exist
inside a Claude SDK dispatch. Missing Impeccable context execution fails the
dispatch, even if the agent writes an otherwise valid packet.

## Records and integrity

Each fresh phase uses `design/round-N.json` and writes previews only beneath
`design/atelier/round-N/`. The packet is one of:

```json
{
  "phase": "interview",
  "title": "Understand the product",
  "strategy": "Grounded reading of the product and remaining uncertainties",
  "product": "",
  "questions": [{ "id": "audience", "prompt": "Who uses this, and for what task?" }]
}
```

```json
{
  "phase": "directions",
  "title": "Choose a direction",
  "strategy": "Product-specific design reasoning and interaction strategy",
  "product": "# Product\nConfirmed product facts...",
  "options": [
    {
      "id": "research-desk",
      "title": "Research desk",
      "thesis": "The organizing idea",
      "rationale": "Why it fits this product and task",
      "risk": "An honest tradeoff",
      "preview": "design/atelier/round-2/research-desk.html"
    }
  ]
}
```

The second example shows one option's shape; real direction and preview packets
require exactly three distinct options and preview files. The final composition
packet uses `phase: "previews"`. Product truth must be populated after interview.
The engine requires the expected phase and a successful context-tool receipt
bound to the current dispatch. It rejects missing, oversized, symlinked and
out-of-round preview files.

`job.design` stores the current phase and engine-recorded decisions. Every
decision names its packet and digest. Fingerprints cover validated packet
content and preview bytes; final approval also covers prior decisions and the
selected stack. The planner must include the exact approved `designDigest` in
its final plan. The engine rechecks approval before build dispatch and at the
review gate. Edited, missing or stale evidence cannot become a passing result.

`design/tool-N.json` is written by the scoped tool, not the designer. The
designer's Write/Edit hook allows only its current packet and preview directory;
application files, prior rounds, job state and tool receipts are outside scope.
There is no Bash or child-agent tool. Application code, PRODUCT.md, final
DESIGN.md/sidecar, tests and commits belong to builders after approval.

HTML previews run in sandboxed iframes under a response CSP that disables
scripts, connections, forms, remote assets and access to the parent console.
They are illustrative prototypes. The asset route serves only files referenced
by the current fingerprinted showcase. It never exposes a general file server.

PostgreSQL stores the exact packet, HTML/raster previews and scoped-tool receipt
as canonical records. The designer writes them in dispatch output staging; the
engine validates and ingests the declared set together. Approval digests read
committed bytes, so editing or deleting staging cannot change an approval. The
current preview route serves database bytes under the same path and digest
checks. Database backup/restore includes binary previews; Git branches and
worktree edits still need their own backup. Existing jobs without `design` state
remain compatible.

## Bundled scaffold

Selecting React/NestJS records the Sociotechnic revision and the maintained
starter's content digest. Runtime dependencies, build output and Git metadata
are excluded; environment secrets are rejected. A changed starter invalidates
the selection. The implementation brief requires the
[documented validation](scaffolds.md#validation-before-use) before copying source
into the job worktree. Needed source updates must return for renewed approval,
not silently replace the selected version.

## CLI and HTTP

```bash
sociotechnic new /path/to/repo 'Design the research workspace' --workflow design
sociotechnic run <job> --hold planned
sociotechnic design-respond <job> --digest sha256:... --response /path/to/response.json
sociotechnic run <job> --hold planned
```

The CLI response command records the human decision; `run` continues that same
job. The console's `POST /api/jobs/:id/design-response` performs both in order.
It takes `{ "digest": "sha256:...", "response": ... }` and rejects a running
driver or stale digest. Supported response shapes are:

```json
{"action":"answer","answers":{"audience":"Practitioners preparing an interview"},"stack":"existing"}
```

```json
{"action":"answer","answers":{"audience":"Practitioners preparing an interview"},"stack":"custom","customStack":"SvelteKit on the existing host"}
```

```json
{"action":"select","optionId":"research-desk"}
```

```json
{"action":"approve","optionId":"composition-one","confirmed":true}
```

```json
{"action":"revise","note":"Show a denser layout while keeping the selected direction"}
```

Use `stack: "react-nest"` to select the bundle. `select` is legal only for
directions; `approve` is legal only for composition previews with explicit
confirmation. A revision returns to the current phase with a fresh iteration.
If only the current preview bytes changed, revision can regenerate that
showcase. Changed earlier evidence or scaffold source remains a visible blocker.

`GET /api/jobs/:id/design-assets/<job-relative-path>?digest=<current-digest>`
serves the current showcase under the restrictive preview policy. Job detail,
dispatch activity, human history and the normal record routes retain the rest.

## Verification

`tests/design.test.ts` exercises the real engine, HTTP server and shared driver
with fake agents, disposable Git worktrees and actual preview files. It covers
same-run continuation, plan binding, approval confirmation, revisions,
stop/reopen, stale bytes, changed scaffolds, write guards and tool boundaries.
These tests do not establish live creative quality, provider entitlement or
configured image generation. Live smoke and browser results belong in
[design ceremony evidence](evidence/design-ceremony.md) with their actual scope and limitations.
