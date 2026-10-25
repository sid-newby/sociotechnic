# Follow-up brief: design chat

Status: documentation only, pending a separate implementation pass. This brief
records the owner's requested follow-up; it does not change the current chat,
agent instructions, model table, catalog releases or existing run pins. Finish
wave 4 and its verification before opening this slice. Wave 5 retains the
console finish review, final design documentation, screenshots and release
preparation unless its scope is explicitly amended.

## Requested outcome

Adapt the supplied shadcn chat composition to Sociotechnic's existing Anthropic
Agent SDK design conversation. The human talks to the design agent, sees real
progress, shares visual references, inspects mockups and working prototypes,
and returns documented results to the planner and builder. Keep the conversation
usable for follow-up critique and revisions after the result is returned.

Use the existing designer agent Markdown definition with Impeccable available
and invoked from the beginning. The owner requests `opus-5-5` at `high` effort
for this work. Resolve that requested model to an exact supported provider/SDK
identifier before enabling it; the current checkout does not establish support
for that name. Preserve the established console tokens, local Geist, role/status
cues, 16px body text, 13px utility floor and 24px section padding.

## Supplied reference

[The exact supplied source](../references/design-chat-shadcn.tsx.txt) is a
verbatim copy of the owner's `Pasted text.txt` attachment, including its TSX,
Markdown explanations and installation examples. It is reference material, not
runtime code, an installation script or proof of production behavior.

- Bytes: 19,483.
- SHA-256: `28367bf3d32d34bd811ee899d94cdbb847f202183edc3e2f948887fb0b568d23`.
- The attachment names the shadcn radix Chat composition, Message Scroller,
  Message, Bubble, Input Group and optional Trace/Code Block components.
- Its transcript, `createChat` transport, sleeps, canned tool output and fallback
  are demonstrations. Its `@ai-sdk/react`, `ai`, `motion/react`, Next.js examples
  and `npx shadcn@latest` commands do not define this application's stack.

Keep the useful composition: an anchored conversation, clear person/agent
messages, a composer at the thread's edge, a return-to-latest action, readable
Markdown and disclosed tool activity. Adapt it to the existing SDK/event/API
contracts rather than introducing a second chat transport or scripted data.

## Existing owners to reuse

Paths below are relative to the repository root.

| Capability | Current owner and behavior |
| --- | --- |
| Design entry | New run's Design conversation and the planner's `needs-design` assignment enter the existing run/session workflow. `ui/web/src/App.tsx` renders `components/design.tsx` for interactive design. |
| Agent instructions | `sociotechnic/global/agents/sociotechnic-designer.md`; the runner resolves `SOCIOTECHNIC_DESIGN_AGENT`, then the installed global agent file, then this bundled file. The actual source and its digest are recorded as `design/agent.md` and `design/agent-source.json`; resumed conversations use the recorded prompt. |
| Provider execution | `sociotechnic/ui/design-session-runner.ts` already uses `@anthropic-ai/claude-agent-sdk` (`0.3.310` in `sociotechnic/package.json`), native Claude Code tools, partial text events and a persistent session ID. |
| Model and budgets | The run's `agentConfigurations["sociotechnic-designer"]` supplies SDK `model`, `effort`, `maxTurns`, tools and timeout. Editing agent-file model/effort frontmatter alone does not change those options: only its body is appended to the SDK system prompt. |
| Impeccable | `sociotechnic/ui/impeccable.ts` locates the installed skill and links it into the session workspace's native `.claude/skills/impeccable` discovery. The initial prompt invokes `/impeccable`; SDK initialization must register the command before assistant work. No Impeccable MCP replacement is needed. |
| Durable session | `sociotechnic/src/design-session.ts`, the runner and the database store own messages, input IDs, answers, opaque SDK transcript entries, usage and session/artifact metadata. Persistence failures abort inference visibly. |
| Questions and continuation | Native `AskUserQuestion` reaches the existing question UI. Replies, interruption and explicit resume retain the same session; human waits do not consume agent work. Driver ownership applies to these operations. |
| Images | `components/design-images.tsx`, `src/design-session.ts` and existing image routes support attach/paste/drop, native image blocks, retained bytes, deduplicated sends and assistant image references. Limits remain eight images under 5 MB each per user message. |
| Previews and artifacts | Impeccable opens its own native loopback previews; Open previews links to a reported safe URL. The existing bounded artifact snapshot and `design-artifacts` route retain samples, prototypes and Markdown. |
| Returning work | The designer already prepares `HANDOFF.md`. Return work calls the existing handoff route with an expected fingerprint; `approveInteractiveDesign` records the document, artifact snapshot, skill/starter provenance and human action. |
| Downstream use | `approvedDesignBrief` in `sociotechnic/src/engine.ts` sends the work product, returned artifact paths and required `plan.designDigest` to planning and builder prompts. Missing/changed approval parks the pipeline; the normal plan-review hold remains. |
| Current UI primitives | `ui/web/src/components/ui/` already contains Button, Input Group, Dropdown Menu, Tooltip, Sheet and the other console primitives. Message Scroller, Message, Bubble, Trace and Code Block wrappers from the supplied reference are not currently installed. Inspect before adding them. |
| Existing proof | `sociotechnic/tests/design.test.ts`, `scripts/verify-interactive-design.mjs` and `docs/design-ceremony.md`; fixture/native-command evidence is separate from live provider proof. |

The current designer Markdown frontmatter and committed native designer v1.2.0
release select `claude-fable-5-1` / `xhigh`. The local `CLAUDE_MODELS` table in
`sociotechnic/src/agent-models.ts` accepts `claude-fable-5-1`, `fable`, `opus`,
`sonnet` and `haiku`; it does not accept the literal `opus-5-5`. `high` is an
accepted Claude effort. These are checkout facts, not evidence of provider
availability, account entitlement or a currently running installation's catalog.

## Remaining work

### Chat composition and scroll behavior

Replace the current bounded message list and separate composer arrangement in
`components/design.tsx` with the supplied thread composition, preserving its
real data and actions. A sent human message anchors the new turn; streaming
continues below it. Follow the reply while the human remains at the live edge;
reading an older message must not be interrupted by auto-scroll. Provide an
accessible return-to-latest action and preserve position through incremental
updates, image loading and reconnects. The thread owns its scrolling; the app
shell, existing run evidence and open dialogs keep their established scroll
behavior. Fit the available space instead of copying the demo's fixed `h-200`.

Retain Markdown, code, image viewing, native questions, draft/attachment recovery,
Send message, Interrupt response, Resume session, Open previews, artifacts and
Return work. Keep the composer reachable at 390px and while the sidebar changes
size. Preserve Enter to send, Shift+Enter for a line break and IME composition
safety. Use reduced-motion behavior without adding decorative message motion.

Treat the reference's context menu as an affordance pattern. Render only actions
backed by the existing implementation. There are image attachments today, not
generic file upload, a Deep Research switch or a Web Search toggle. The demo's
Reset conversation action must not erase durable run history. New product
capabilities require their own contract and implementation before a control.

### Real activity and state

The current application saves assistant text and partial text, while SDK activity
also flows through driver activity/log handling. The supplied `reasoning` and
`tool-runCommand` message parts are a different demo schema. Do not fabricate
those parts or label buffered logs as durable structured tool history.

Reuse public progress/tool summaries already emitted by the SDK where useful.
If the design needs persisted, structured tool rows, first define a bounded
projection, redaction/display rules and database-owned event contract; then map
real supported SDK events and test restart recovery. Show public tool activity
and agent-authored summaries, not private chain-of-thought. Render pending,
working, waiting-for-human, interrupted, failed and returned states distinctly.
Neither a stopped stream nor an unreported tool result is a successful operation.

### Designer configuration and Impeccable preload

Before runtime edits, verify the requested `opus-5-5` identifier and `high`
effort against current official Anthropic/Agent SDK documentation and account
capability evidence. Record the exact identifier and supported effort. Do not
silently substitute the moving `opus` alias or relabel the current model. If
verification cannot establish the request, leave it unresolved and report the
specific missing evidence; the visual work can proceed against fixture events.

When verified, extend the owning model/effort validation, compatible model
choices, tests and immutable designer release through the established catalog
workflow. Align the normal agent-file declaration for use by other Claude
teammates, while keeping SDK execution tied to run pins. Publish a new release;
never rewrite old catalog releases, run pins, recorded prompts or conversations.
The local database catalog must be inspected during implementation rather than
inferred from committed bundles.

Define preload as real native skill availability and explicit initial invocation,
not a badge or an unverified frontmatter field. Reuse native skill discovery,
`Skill`/`Bash` tools, the `/impeccable` startup prompt, initialization guard and
recorded skill provenance. Prove the skill's actual command is used in the
intended session. Preserve normal Impeccable interviews, previews and human
choices; do not impose another packet workflow. Follow-up turns resume the
recorded session and instructions.

### Mockups, prototypes and handoff

Keep `HANDOFF.md` as the assignment-shaped Markdown work product. For this
workflow it should document the design decisions the human confirmed, the
mockups/prototypes produced, how to open or run them, relevant responsive and
interaction behavior, validation performed and unresolved work. Link actual
returned artifact paths; describe anything unverified as unverified. A prototype
is evidence for implementation, not an automatic declaration that production
code is complete.

Reuse the existing artifact snapshot, fingerprint and explicit Return work action.
The planner must receive the returned document and artifacts, assess them,
produce an implementation plan with `designDigest`, and hold for normal plan
review. The builder must receive that same approved work product and use its
mockups/prototypes within the plan. A changed artifact requires a fresh handoff;
missing or stale bytes must block use rather than falling back to chat prose.
A later design critique can continue the same conversation without automatically
starting agents in the implementation pipeline.

## Implementation sequence and scope

1. Re-read the current contracts, design/session references and supplied source.
   Trace native SDK events, scrolling, stored artifacts and the planner/builder
   consumer. Write the exact component/data mapping and update contracts before
   adding structured activity or changing startup configuration.
2. Adapt the chat presentation using installed primitives and selectively add
   only the missing wrappers needed. Verify current upstream APIs, versions,
   licenses and local Radix conventions before pinning dependencies. Keep the
   existing Node server, Vite/React, Anthropic SDK and canonical record viewer.
3. Complete model verification and the new immutable designer configuration as
   a separate reviewable slice. Prove actual SDK options and native skill startup.
4. Prove the full design-to-planner-to-builder handoff with fake SDK events and
   real artifacts, then perform the batched browser pass. Update affected docs
   and the feature map with actual results and any remaining gaps.

Expected implementation owners are `sociotechnic/ui/web/src/components/design.tsx`,
`design-images.tsx`, narrowly required shared UI wrappers, the web model/API
boundary if needed, `sociotechnic/ui/design-session-runner.ts`, `ui/impeccable.ts`,
`src/design-session.ts`, `src/agent-models.ts`, established agent-release
publication/migration support, the bundled designer Markdown, and focused tests
and verification scripts. Change engine/brief handoff code only if a demonstrated
gap needs it. Do not replace existing chat persistence, handoff or provider owners.

`docsImpact`: update `sociotechnic/CONTRACTS.md` first for changed behavior;
update `docs/design-ceremony.md`, `docs/cli-reference.md`,
`docs/engine-reference.md`, `docs/development.md` and README with the actual
workflow. Amend the console plan/handoff if sequencing changes. Final `DESIGN.md`,
`console-ui.md`, refreshed screenshot set and release preparation remain with
the agreed finish wave. No schema migration is assumed; justify one before
broadening this scope.

## Acceptance and evidence

- A real Anthropic Agent SDK design session drives the new composition. No demo
  transcript, fake totals, fallback response or second AI SDK transport ships.
- Fixture tests prove streamed message order, duplicate-send safety, failed-send
  draft/images, interrupt/resume, native questions, transcript persistence failure,
  restart/reconnect recovery and external-owner refusal remain intact.
- New-session model/effort assertions match the verified request; existing runs
  retain their original options and recorded `design/agent.md`.
- Skill tests prove actual native registration/invocation and explicit failure
  before inference when Impeccable is missing. Mock registration alone does not
  establish a working native command.
- A fixture conversation produces a mockup or prototype plus a useful
  `HANDOFF.md`; returned bytes survive staging loss, reach planner and builder
  prompts at the same digest, and fail closed when changed. Plan review remains
  held and follow-up chat does not start implementation implicitly.
- A built browser journey covers anchored scroll, reading older messages,
  return-to-latest, streaming, long Markdown/code, image loading, questions,
  attachments and retry, previews, artifact reading and Return work. Verify
  keyboard focus, Escape/return focus, IME, reduced motion, light/dark, 1440px
  and 390px, sidebar resizing and open dialogs without page overflow.
- Run `task checks` and `task test:pg`, extending the existing design and browser
  suites. Record commands, results and proof locations. Keep fake SDK, real native
  Impeccable and live provider evidence separate; any live model run needs its
  own agreed budget and verification scope.

This brief and the preserved reference are the only deliverables of this pass.
Implementation, dependency installation, catalog publication and live inference
remain pending follow-up work.
